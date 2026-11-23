import { useEffect, useRef, useState } from "react";
import {
  BalanceType, BinaryOptionsDirection, ClientSdk, DigitalOptionsDirection, OAuthMethod
} from "@quadcode-tech/client-sdk-js";
import { canSendDemoOrder, exactExpiry, expirationMs, sameAsset, validateDemoStake, type DemoCandidate } from "../demoAutoTrade.js";

// OAuth public identifiers. Client secret NEVER belongs in the browser or GitHub.
const API_BASE_URL="https://api.trade.safirion.com";
const WEBSOCKET_URL="wss://ws.trade.safirion.com/echo/websocket";
const CLIENT_ID=488658177257762;
const PLATFORM_ID=691;
const PKCE_KEY="tozzi_safirion_pkce_v1";
type Status="IDLE"|"CONNECTING"|"CONNECTED"|"ERROR";
type Props={
  candidate:DemoCandidate|null;
  selectedAsset:string;
  optionMode:"BINARIA"|"DIGITAL";
  isMonitoring:boolean;
  currentTradeAction?:"TAKEN"|"IGNORED";
  onDemoOrder:(targetEpoch:number,asset:string)=>void;
};
function makeOAuth() {
  return new OAuthMethod({
    apiBaseUrl:API_BASE_URL,clientId:CLIENT_ID,
    redirectUri:window.location.origin+"/",scope:"full"
  });
}
function localDay(){return new Date().toLocaleDateString("en-CA");}

export default function SafirionConnection({candidate,selectedAsset,optionMode,isMonitoring,currentTradeAction,onDemoOrder}:Props) {
  const [status,setStatus]=useState<Status>("IDLE");
  const [details,setDetails]=useState("Autorize sua conta para testar conexão com a API da Safirion.");
  const [activeCount,setActiveCount]=useState<number|null>(null);
  const [demoCurrency,setDemoCurrency]=useState<string|null>(null);
  const [autoEnabled,setAutoEnabled]=useState(false);
  const [stake,setStake]=useState(1);
  const [dailyLimit,setDailyLimit]=useState(3);
  const [sentCount,setSentCount]=useState(0);
  const [sessionDay,setSessionDay]=useState(localDay());
  const sdkRef=useRef<ClientSdk|null>(null);
  const processingRef=useRef(false);
  const busyRef=useRef(false);
  const attemptsRef=useRef(new Set<string>());
  const sentRef=useRef(0);
  const armedRef=useRef(false);
  const connectionRef=useRef(false);
  const lastReportRef=useRef("");

  const stopAutomation=(message?:string)=>{
    armedRef.current=false;
    setAutoEnabled(false);
    if(message)setDetails(message);
  };
  const disconnect=async()=>{
    stopAutomation();
    connectionRef.current=false;
    const sdk=sdkRef.current;
    sdkRef.current=null;
    if(sdk)try{await sdk.shutdown();}catch{/* already disconnected */}
    setDemoCurrency(null);
    setActiveCount(null);
    setStatus("IDLE");
    setDetails("Conexão encerrada. Automação DEMO desligada.");
  };

  const startConnection=async()=>{
    if(status==="CONNECTING")return;
    stopAutomation();
    setStatus("CONNECTING");
    setDetails("Abrindo autorização OAuth da Safirion...");
    try{
      const oauth=makeOAuth();
      const {url,codeVerifier}=await oauth.createAuthorizationUrl();
      sessionStorage.setItem(PKCE_KEY,codeVerifier);
      window.location.assign(url);
    }catch(err){
      setStatus("ERROR");
      setDetails("Erro ao abrir autorização: "+(err instanceof Error?err.message:String(err)));
    }
  };

  useEffect(()=>{
    if(processingRef.current)return;
    const url=new URL(window.location.href);
    const code=url.searchParams.get("code");
    const error=url.searchParams.get("error");
    if(!code&&!error)return;
    processingRef.current=true;
    const verifier=sessionStorage.getItem(PKCE_KEY);
    url.searchParams.delete("code");url.searchParams.delete("state");
    url.searchParams.delete("error");url.searchParams.delete("error_description");
    window.history.replaceState(null,"",url.pathname+url.search+url.hash);
    sessionStorage.removeItem(PKCE_KEY);
    if(error||!code||!verifier){
      setStatus("ERROR");
      setDetails(error?"Autorização recusada: "+error:"Dados PKCE ausentes; tente novamente.");
      return;
    }
    let cancelled=false;
    (async()=>{
      setStatus("CONNECTING");
      try{
        const oauth=makeOAuth();
        await oauth.issueAccessTokenWithAuthCode(code,verifier);
        const sdk=await ClientSdk.create(WEBSOCKET_URL,PLATFORM_ID,oauth);
        if(cancelled){await sdk.shutdown();return;}
        sdkRef.current=sdk;
        // Abort before enabling automation unless an explicit, non-margin Demo balance exists.
        const balances=await sdk.balances();
        const demo=balances.getBalances().find(b=>b.type===BalanceType.Demo&&!b.isMargin);
        if(!demo){
          setStatus("ERROR");
          setDetails("A API não retornou saldo DEMO de opções. Execução bloqueada. Conta REAL nunca será utilizada.");
          await sdk.shutdown();sdkRef.current=null;return;
        }
        setDemoCurrency(demo.currency);
        let count=0;
        try{count=(await sdk.binaryOptions()).getActives().length;}catch{/* account may not expose binaries */}
        try{count+=(await sdk.digitalOptions()).getUnderlyingsAvailableForTradingAt(sdk.currentTime()).length;}catch{/* unavailable */}
        if(cancelled){await sdk.shutdown();sdkRef.current=null;return;}
        setActiveCount(count);
        connectionRef.current=true;
        setStatus("CONNECTED");
        setDetails("OAuth e WebSocket conectados. Conta DEMO identificada. Automação continua DESLIGADA até você ativar.");
      }catch(err){
        connectionRef.current=false;
        setStatus("ERROR");
        setDetails("Conexão não concluída: "+(err instanceof Error?err.message:String(err))+
          ". O redirecionamento do aplicativo deve estar autorizado na Safirion.");
      }
    })();
    return ()=>{cancelled=true;};
  },[]);

  useEffect(()=>()=>{armedRef.current=false;void sdkRef.current?.shutdown();},[]);

  useEffect(()=>{
    armedRef.current=autoEnabled&&status==="CONNECTED";
  },[autoEnabled,status]);

  useEffect(()=>{
    // Changing the monitored asset, option type or stopping the capture must disarm.
    stopAutomation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedAsset,optionMode,isMonitoring]);

  useEffect(()=>{
    const ticker=setInterval(()=>{
      if(!armedRef.current||!connectionRef.current||busyRef.current)return;
      const sdk=sdkRef.current;
      if(!sdk)return;
      const today=localDay();
      if(today!==sessionDay){
        // No automatic daily reset while armed; require explicit reactivation.
        stopAutomation("Dia de negociação alterado. Reative manualmente se quiser continuar.");
        setSessionDay(today);setSentCount(0);sentRef.current=0;return;
      }
      if(sentRef.current>=dailyLimit){
        stopAutomation("Limite diário de operações DEMO alcançado. Automação desligada.");return;
      }
      const now=Date.now();
      const rejected=canSendDemoOrder(candidate,now,optionMode,selectedAsset,true);
      if(rejected)return;
      if(!candidate)return;
      // A manual choice takes precedence: never trade a signal the user took or ignored.
      if(currentTradeAction==="TAKEN"||currentTradeAction==="IGNORED")return;
      const key=`${candidate.asset}|${candidate.targetEpoch}|${candidate.optionMode}`;
      if(attemptsRef.current.has(key))return;
      // Lock BEFORE any asynchronous SDK call; never retry an ambiguous order.
      attemptsRef.current.add(key);
      busyRef.current=true;
      const signal={...candidate};
      void (async()=>{
        try{
          if(!armedRef.current||!connectionRef.current)throw Error("Automação desativada.");
          const balances=await sdk.balances();
          const demo=balances.getBalances().find(b=>b.type===BalanceType.Demo&&!b.isMargin);
          if(!demo)throw Error("Saldo DEMO não identificado. Ordem bloqueada.");
          if(!validateDemoStake(stake,demo.availableForOptionsAmount(),10))
            throw Error("Valor inválido, superior ao limite de 10 por ordem ou ao saldo DEMO disponível.");
          if(Math.abs(sdk.currentTime().getTime()-Date.now())>3000)
            throw Error("Relógio da API e do dispositivo desencontrados. Ordem bloqueada.");
          const exp=expirationMs(signal.expiration);
          if(!exp)throw Error("Expiração inválida.");
          const expiresAt=signal.targetEpoch+exp;
          const buy=signal.decision==="POSSÍVEL COMPRA";
          if(signal.optionMode==="BINARIA"){
            const facade=await sdk.binaryOptions();
            const matches=facade.getActives().filter(a=>sameAsset(signal.asset,a.ticker)&&a.canBeBoughtAt(sdk.currentTime()));
            if(matches.length!==1)throw Error("Ativo binário não encontrado de forma inequívoca na API.");
            const available=(await matches[0].instruments()).getAvailableForBuyAt(sdk.currentTime());
            const instrument=exactExpiry(available,expiresAt,x=>x.expiredAt.getTime());
            if(!instrument)throw Error("Contrato binário com expiração exata não disponível.");
            if(canSendDemoOrder(signal,Date.now(),optionMode,selectedAsset,armedRef.current))
              throw Error("Horário expirado durante verificação. Ordem NÃO enviada.");
            if(!connectionRef.current||demo.type!==BalanceType.Demo)
              throw Error("Conta DEMO desconectada. Ordem bloqueada.");
            await facade.buy(instrument,buy?BinaryOptionsDirection.Call:BinaryOptionsDirection.Put,stake,demo);
          }else if(signal.optionMode==="DIGITAL"){
            const facade=await sdk.digitalOptions();
            const available=facade.getUnderlyingsAvailableForTradingAt(sdk.currentTime());
            const matches=available.filter(a=>sameAsset(signal.asset,a.name));
            if(matches.length!==1)throw Error("Ativo digital não identificado de forma inequívoca na API.");
            const instruments=(await matches[0].instruments()).getAvailableForBuyAt(sdk.currentTime());
            const instrument=exactExpiry(instruments,expiresAt,x=>x.expiration.getTime());
            if(!instrument)throw Error("Contrato digital com expiração exata não disponível.");
            if(canSendDemoOrder(signal,Date.now(),optionMode,selectedAsset,armedRef.current))
              throw Error("Horário expirado durante verificação. Ordem NÃO enviada.");
            if(!connectionRef.current||demo.type!==BalanceType.Demo)
              throw Error("Conta DEMO desconectada. Ordem bloqueada.");
            await facade.buySpotStrike(instrument,buy?DigitalOptionsDirection.Call:DigitalOptionsDirection.Put,stake,demo);
          }else throw Error("Modalidade não suportada.");
          sentRef.current+=1;
          setSentCount(sentRef.current);
          onDemoOrder(signal.targetEpoch,signal.asset);
          setDetails(`Ordem DEMO enviada: ${signal.asset} · ${buy?"COMPRA":"VENDA"} · ${stake} ${demo.currency}. WIN/LOSS ainda precisa ser confirmado.`);
          if(sentRef.current>=dailyLimit)stopAutomation("Limite diário de DEMO alcançado. Última ordem enviada; automação desligada.");
        }catch(err){
          const message=err instanceof Error?err.message:String(err);
          lastReportRef.current=message;
          // Do not retry automatically: timeout may mean the provider processed an order.
          stopAutomation("Automação pausada: "+message+" Confira posições na Safirion antes de reativar.");
        }finally{busyRef.current=false;}
      })();
    },200);
    return()=>clearInterval(ticker);
  },[candidate,selectedAsset,optionMode,stake,dailyLimit,sessionDay,currentTradeAction,onDemoOrder]);

  return (
    <section className="rounded-2xl border border-purple-500/30 bg-[#131729] p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div>
          <h3 className="text-sm font-bold text-purple-200">Safirion • Conexão e automação DEMO</h3>
          <p className="text-[11px] text-slate-400">OAuth + WebSocket • ordens apenas no saldo Demo</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status==="CONNECTED"?"bg-green-500/20 text-green-300":status==="ERROR"?"bg-red-500/20 text-red-300":status==="CONNECTING"?"bg-amber-500/20 text-amber-300":"bg-slate-700 text-slate-300"}`}>
          {status==="CONNECTED"?"Conectado à DEMO":status==="ERROR"?"Falha na conexão":status==="CONNECTING"?"Conectando":"Desconectado"}
        </span>
      </div>
      <p role="status" className="text-xs text-slate-300 break-words">{details}</p>
      {activeCount!==null&&<p className="text-xs text-green-300">{activeCount} ativos consultados na API · saldo DEMO em {demoCurrency}</p>}
      {status==="CONNECTED"?(
        <button type="button" onClick={()=>{void disconnect();}}
          className="rounded-xl border border-slate-500 px-4 py-2 text-sm font-bold text-white">Desconectar API</button>
      ):(
        <button type="button" onClick={()=>{void startConnection();}} disabled={status==="CONNECTING"}
          className="rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 px-4 py-2 text-sm font-bold text-white">
          {status==="CONNECTING"?"Conectando...":"Conectar minha conta Safirion"}
        </button>
      )}
      <div className="rounded-xl border border-orange-500/30 bg-[#1a1b2b] p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm text-orange-200">Compra / Venda automática • SOMENTE DEMO</strong>
          <span className={`text-xs font-bold ${autoEnabled?"text-green-300":"text-amber-300"}`}>
            {autoEnabled?"ATIVADO":"DESLIGADO"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-300">Valor por operação ({demoCurrency||"moeda da conta"})
            <input type="number" min={1} max={10} step={1} value={stake}
              disabled={autoEnabled} onChange={e=>setStake(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-[#101522] px-3 py-2 text-white"/>
          </label>
          <label className="text-xs text-slate-300">Limite de ordens por dia
            <select value={dailyLimit} disabled={autoEnabled}
              onChange={e=>setDailyLimit(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-[#101522] px-3 py-2 text-white">
              {[1,2,3,4,5].map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-300">Ordens DEMO enviadas nesta sessão: {sentCount}/{dailyLimit}. Somente CONFIRMADO no horário exato, no mesmo ativo e expiração. Cada sinal é tentado uma única vez.</p>
        {autoEnabled?(
          <button type="button" onClick={()=>stopAutomation("Automação DEMO desligada por você.")}
            className="w-full rounded-xl bg-red-700 px-4 py-3 font-extrabold text-white">PARAR AUTOMÁTICO AGORA</button>
        ):(
          <button type="button" disabled={status!=="CONNECTED"||!isMonitoring||sentCount>=dailyLimit||!validateDemoStake(stake,10,10)}
            onClick={()=>{
              if(status!=="CONNECTED"||!sdkRef.current||!connectionRef.current||!isMonitoring)return;
              if(!validateDemoStake(stake,10,10))return;
              // Do not trade a confirmation that already existed before the arm click.
              if(candidate?.status==="CONFIRMED")
                attemptsRef.current.add(`${candidate.asset}|${candidate.targetEpoch}|${candidate.optionMode}`);
              setAutoEnabled(true);armedRef.current=true;
              setDetails("Automação DEMO ativada. Aguardando um NOVO sinal confirmado; nenhuma operação na conta real.");
            }}
            className="w-full rounded-xl bg-green-700 disabled:opacity-50 px-4 py-3 font-extrabold text-white">
            ATIVAR AUTOMÁTICO NA DEMO
          </button>
        )}
        <p className="text-[11px] text-amber-200/90">
          A automação não altera os 7 robôs nem promete taxa de acerto. Qualquer falha de correspondência,
          demora ou dúvida sobre a conta bloqueia o envio. Use apenas uma aba do aplicativo;
          o modo automático desliga ao desconectar ou sair da tela.
        </p>
      </div>
    </section>
  );
}
