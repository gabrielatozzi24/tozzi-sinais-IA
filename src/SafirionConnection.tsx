import { useEffect, useRef, useState } from "react";
import { ClientSdk, OAuthMethod } from "@quadcode-tech/client-sdk-js";

// Public OAuth identifiers from the provider's email. NEVER place clientSecret here.
// Authentication uses OAuth Authorization Code + PKCE (user grants access).
const API_BASE_URL = "https://api.trade.safirion.com";
const WEBSOCKET_URL = "wss://ws.trade.safirion.com/echo/websocket";
const CLIENT_ID = 488658177257762;
const PLATFORM_ID = 691;
const PKCE_STORAGE_KEY = "tozzi_safirion_pkce_v1";
const OAUTH_STATE_KEY = "tozzi_safirion_state_v1";
type ConnectStatus = "IDLE" | "CONNECTING" | "CONNECTED" | "ERROR";

function makeOAuth() {
  return new OAuthMethod({
    apiBaseUrl: API_BASE_URL,
    clientId: CLIENT_ID,
    redirectUri: window.location.origin + "/",
    scope: "full"
  });
}

export default function SafirionConnection() {
  const [status, setStatus] = useState<ConnectStatus>("IDLE");
  const [details, setDetails] = useState("Conecte sua conta Safirion para conferir acesso a dados de mercado.");
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const sdkRef = useRef<ClientSdk | null>(null);
  const processingRef = useRef(false);

  const disconnect = async () => {
    const sdk = sdkRef.current;
    sdkRef.current = null;
    if (sdk) {
      try { await sdk.shutdown(); } catch { /* closed or already disconnected */ }
    }
    setActiveCount(null);
    setStatus("IDLE");
    setDetails("Conexão encerrada. Nenhuma ordem foi enviada.");
  };

  const startConnection = async () => {
    if (status === "CONNECTING") return;
    setStatus("CONNECTING");
    setDetails("Preparando autorização protegida da Safirion...");
    try {
      const oauth = makeOAuth();
      const {url,codeVerifier} = await oauth.createAuthorizationUrl();
      sessionStorage.setItem(PKCE_STORAGE_KEY, codeVerifier);
      // For PKCE, the state is generated and handled by the provider / SDK.
      sessionStorage.setItem(OAUTH_STATE_KEY, "pending");
      window.location.assign(url);
    } catch (err) {
      setStatus("ERROR");
      setDetails("Não foi possível abrir a autorização: " + (err instanceof Error ? err.message : "erro desconhecido"));
    }
  };

  useEffect(() => {
    // The app may show a login screen before this component mounts.
    // Auth callback is processed only once, after Tozzi private login.
    if (processingRef.current) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const authorizationError = url.searchParams.get("error");
    if (!code && !authorizationError) return;
    processingRef.current = true;
    const verifier = sessionStorage.getItem(PKCE_STORAGE_KEY);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    sessionStorage.removeItem(PKCE_STORAGE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    if (authorizationError) {
      setStatus("ERROR");
      setDetails("Autorização não concluída: " + authorizationError + ". Confira a configuração de redirecionamento OAuth.");
      return;
    }
    if (!code || !verifier) {
      setStatus("ERROR");
      setDetails("Código ou verificador PKCE ausente. Tente conectar novamente.");
      return;
    }
    let cancelled=false;
    (async () => {
      setStatus("CONNECTING");
      setDetails("Validando autorização e abrindo conexão de leitura...");
      try {
        const oauth = makeOAuth();
        await oauth.issueAccessTokenWithAuthCode(code, verifier);
        const sdk = await ClientSdk.create(WEBSOCKET_URL, PLATFORM_ID, oauth);
        if (cancelled) { await sdk.shutdown(); return; }
        sdkRef.current = sdk;
        // Read-only capability check: enumerate available option assets.
        const actives = (await sdk.blitzOptions()).getActives();
        if (cancelled) { await sdk.shutdown(); return; }
        setActiveCount(actives.length);
        setStatus("CONNECTED");
        setDetails("OAuth autorizado e WebSocket conectado. Consulta de ativos disponível; nenhuma operação enviada.");
      } catch (err) {
        setStatus("ERROR");
        setDetails("A conexão não foi concluída: " + (err instanceof Error ? err.message : "erro desconhecido") + ". Verifique se o endereço de retorno do aplicativo está permitido no OAuth.");
      }
    })();
    return () => { cancelled=true; };
  }, []);

  useEffect(() => () => { void sdkRef.current?.shutdown(); }, []);

  return (
    <section className="rounded-2xl border border-purple-500/30 bg-[#131729] p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div>
          <h3 className="text-sm font-bold text-purple-200">Conexão Safirion • API oficial</h3>
          <p className="text-[11px] text-slate-400">OAuth + WebSocket • consulta somente • sem envio de ordens</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status==="CONNECTED"?"bg-green-500/20 text-green-300":status==="ERROR"?"bg-red-500/20 text-red-300":status==="CONNECTING"?"bg-amber-500/20 text-amber-300":"bg-slate-700 text-slate-300"}`}>
          {status==="CONNECTED"?"Conectado":status==="ERROR"?"Falha na conexão":status==="CONNECTING"?"Conectando":"Desconectado"}
        </span>
      </div>
      <p role="status" className="text-xs text-slate-300 break-words">{details}</p>
      {activeCount!==null && <p className="text-xs text-green-300">Ativos consultados na API: {activeCount}</p>}
      {status==="CONNECTED" ? (
        <button type="button" onClick={() => { void disconnect(); }}
          className="rounded-xl border border-slate-500 px-4 py-2 text-sm font-bold text-white">Desconectar API</button>
      ) : (
        <button type="button" onClick={() => { void startConnection(); }} disabled={status==="CONNECTING"}
          className="rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 px-4 py-2 text-sm font-bold text-white">
          {status==="CONNECTING"?"Conectando...":"Conectar minha conta Safirion"}
        </button>
      )}
      <p className="text-[10px] text-amber-200/80">
        Os sinais continuam baseados na análise visual até a conexão e os dados serem validados.
        Autorizar a API não executa compras nem vendas.
      </p>
    </section>
  );
}
