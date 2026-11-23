import express from "express";
import { timingSafeEqual } from "node:crypto";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { timingBot, trendBot } from "./bots.js";
import { confirmationQuality } from "./confirmationQuality.js";
import { finalCandleRiskGate } from "./finalCandleRiskGate.js";
import { precisionCandleBot, reversalWatchBot } from "./advisoryCandleBots.js";
import { candleBot } from "./candleBot.js";
import { checkAsset, checkTimeframe } from "./marketIdentity.js";
import { ApiUsageGate, classifyGeminiError } from "./apiUsage.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "25mb" }));

// Keep credentials and multimodal inference strictly on the backend.
const primaryGroqModel = () => process.env.GROQ_PRIMARY_MODEL || "qwen/qwen3.8-27b";
const fallbackGroqModel = () => process.env.GROQ_FALLBACK_MODEL || primaryGroqModel();
type GroqRequest = { systemPrompt?: string; prompt: string; imageBase64?: string };
async function groqGenerate(model: string, input: GroqRequest): Promise<{ text: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw Object.assign(new Error("GROQ_API_KEY not configured"), { status: 401 });
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  if (input.imageBase64) content.push({ type: "image_url", image_url: { url: input.imageBase64 } });
  const messages = [
    ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
    { role: "user", content }
  ];
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0, response_format: { type: "json_object" }, max_completion_tokens: 900 }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) {
    // Do not include provider error bodies: they can contain sensitive request details.
    const retry = Number(response.headers.get("retry-after"));
    throw Object.assign(new Error(`Groq request failed with HTTP ${response.status}`), {
      status: response.status,
      retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : undefined
    });
  }
  const data: any = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Groq returned empty content");
  return { text };
}

const PORT = Number(process.env.PORT) || 3000;

// Server-wide limit includes all connected browsers and model requests.
const usageGate = new ApiUsageGate(8);
// Conservative global server-side allowance for the vision model's free tier.
// Each image requires ~2048 input tokens plus a variable prompt and completion.
const FREE_GROQ_MAX_REQUESTS_PER_MINUTE = 2;
const FREE_GROQ_MAX_DAILY_REQUESTS = 40;
const groqMinuteRequests: number[] = [];
let groqDailyCount = 0;
let groqDailyDate = "";
function groqBudget(now = Date.now()) {
  const today = new Date(now).toISOString().slice(0,10);
  if (groqDailyDate !== today) { groqDailyDate = today; groqDailyCount = 0; }
  while (groqMinuteRequests.length && now - groqMinuteRequests[0] >= 60_000) groqMinuteRequests.shift();
  if (groqDailyCount >= FREE_GROQ_MAX_DAILY_REQUESTS) {
    return { allowed:false, retryAfterSeconds:Math.max(1,Math.ceil((Date.parse(today+"T00:00:00Z")+86400000-now)/1000)), reason:"daily" };
  }
  if (groqMinuteRequests.length >= FREE_GROQ_MAX_REQUESTS_PER_MINUTE)
    return { allowed:false, retryAfterSeconds:Math.max(1, Math.ceil((groqMinuteRequests[0]+60_000-now)/1000)), reason:"minute" };
  return { allowed:true, retryAfterSeconds:0, reason:"ok" };
}
function countGroqRequest(now = Date.now()) {
  groqDailyCount++;
  groqMinuteRequests.push(now);
}
let groqOverloadStreak = 0;
let groqQuotaStreak = 0;
// Keep an overloaded primary on a cooldown rather than retrying it each candle.
let primaryOverloadedUntil = 0;


async function startServer() {
  // Vite dev server integration
  // Connected WebSocket clients for real-time mobile alerts
  const clients = new Set<WebSocket>();
  const getAccessCode = () => process.env.TOZZI_ACCESS_CODE || "";
  // Explicit login confirmation; server remains the authority for every API request.
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  app.post("/api/login", (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    let entry = loginAttempts.get(ip);
    if (!entry || now >= entry.resetAt) entry = { count: 0, resetAt: now + 60_000 };
    entry.count++;
    loginAttempts.set(ip, entry);
    if (entry.count > 10) return res.status(429).json({ error: "Muitas tentativas de acesso. Aguarde um minuto." });
    const expected = getAccessCode();
    if (!expected) return res.status(503).json({ error: "Configure TOZZI_ACCESS_CODE no Render." });
    const supplied = req.body?.code;
    if (typeof supplied !== "string" || supplied.length < 8 || supplied.length > 64)
      return res.status(401).json({ error: "Código inválido." });
    const received = Buffer.from(supplied);
    const stored = Buffer.from(expected);
    const valid = received.length === stored.length && timingSafeEqual(received, stored);
    if (!valid) return res.status(401).json({ error: "Senha incorreta. Confira o código definido no Render." });
    loginAttempts.delete(ip);
    return res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    const expected = getAccessCode();
    if (!expected) return res.status(503).json({ error: "Configure TOZZI_ACCESS_CODE no Render para proteger a API." });
    if (req.header("X-Tozzi-Access") !== expected) return res.status(401).json({ error: "Código de acesso não autorizado." });
    next();
  });

  // Authenticated, explicitly user-triggered lightweight service diagnostic.
  // Does not use market data or create trading signals. Never returns API keys.
  let lastAiCheckAt = 0;
  app.post("/api/ai-diagnostic", async (_req, res) => {
    const now = Date.now();
    if (now - lastAiCheckAt < 120_000) {
      return res.status(429).json({ error: "Aguarde 2 minutos antes de repetir o diagnóstico.", retryAfterSeconds: Math.ceil((120_000-(now-lastAiCheckAt))/1000) });
    }
    lastAiCheckAt = now;
    const main = primaryGroqModel();
    const backup = fallbackGroqModel();
    const configuredByRender = { primary: Boolean(process.env.GROQ_PRIMARY_MODEL), backup: Boolean(process.env.GROQ_FALLBACK_MODEL) };
    const models = [...new Set([main,backup])];
    const results: { model:string; ok:boolean; status:number|null; kind:string; elapsedMs:number }[] = [];
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ configuredByRender, models, keyConfigured:false, results, error:"GROQ_API_KEY ausente no servidor." });
    }
    const budget = groqBudget();
    if (!budget.allowed) return res.status(429).set("Retry-After",String(budget.retryAfterSeconds)).json({
      configuredByRender, models, keyConfigured:true, results,
      error:"Economia de API: aguarde para realizar novo diagnóstico.",
      type:"API_RATE_LIMIT", retryAfterSeconds:budget.retryAfterSeconds
    });
    const admission = usageGate.acquire();
    if (!admission.allowed) return res.status(429).json({
      configuredByRender, models, keyConfigured:true,
      error:"API em pausa ou ocupada. O diagnóstico não iniciou chamadas extras.",
      retryAfterSeconds:admission.retryAfterSeconds
    });
    try {
      for (const model of models) {
        if (results.length) break; // Do not spend a second free-tier call just for diagnostic.
        const started=Date.now();
        try {
          countGroqRequest();
          await groqGenerate(model, { prompt: "Retorne um objeto JSON com a chave ok e valor true." });
          results.push({model,ok:true,status:200,kind:"OK",elapsedMs:Date.now()-started});
        } catch(err:any) {
          const parsed=Number(err?.status||err?.code);
          results.push({model,ok:false,status:Number.isFinite(parsed)&&parsed>0?parsed:null,
            kind:classifyGeminiError(err),elapsedMs:Date.now()-started});
        }
      }
    } finally {usageGate.release();}
    return res.json({
      configuredByRender,models,keyConfigured:true,results,
      note:"Teste de texto simples; imagem, JSON estruturado e capacidade em produção precisam de verificação separada."
    });
  });

  // API endpoint for Tozzi Vision Bot & Signal Guard chart analysis
  app.post("/api/analyze-chart", async (req, res) => {
    const requestStartedAt = Date.now();
    try {
      const { imageBase64, selectedAsset, selectedTimeframe, selectedExpiration, phase, targetEpoch, priorDirection, captureTimestamp, optionMode } = req.body;
      const marketMode = optionMode === "DIGITAL" ? "DIGITAL" : "BINARIA";
      const chartMarket = /\bOTC\b/i.test(String(selectedAsset || "")) ? "OTC" : "REGULAR";
      const stage = phase === "CONFIRM" ? "CONFIRM" : "PREPARE";
      const target = Number(targetEpoch);
      const remainingBefore = target - Date.now();
      const candleMs = selectedTimeframe === "M5" ? 300000 : 60000;
      // Only the beginning of a real M1/M5 candle is a valid target.
      if (!Number.isFinite(target) || target % candleMs !== 0 ||
        remainingBefore < (stage === "PREPARE" ? 30000 : 4000) ||
        remainingBefore > (stage === "PREPARE" ? 60000 : 45000)) {
        return res.status(400).json({ error: "Janela de alerta expirou ou horário de entrada inválido." });
      }
      if (!["M1", "M5"].includes(selectedTimeframe) || !["1min", "5min"].includes(selectedExpiration)) {
        return res.status(400).json({ error: "Período ou expiração inválidos." });
      }

      if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: "Configure GROQ_API_KEY no Render." });
      if (typeof imageBase64 !== "string" || !imageBase64.startsWith("data:image/")) {
        return res.status(400).json({ error: "Imagem de captura inválida." });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: "Nenhuma imagem de gráfico fornecida." });
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      const systemPrompt = `
Você é o "Tozzi Vision Bot" e o "Tozzi Signal Guard", verificadores de análise visual de gráficos de opções binárias/digitais (Safirion), podendo ser mercado OTC ou mercado normal. Não presuma que um gráfico regular é OTC.
O usuário selecionou o ativo: "${selectedAsset || "EUR/USD OTC"}", mercado "${chartMarket === "OTC" ? "OTC" : "NORMAL (não OTC)"}", tipo de opção "${marketMode === "DIGITAL" ? "Digital" : "Binária"}", no período: "${selectedTimeframe || "M1"}" com expiração de: "${selectedExpiration || "1min"}". A seleção é manual e NÃO garante que esse mercado esteja aberto ou que o tipo de opção seja verificável na captura.

Analise minuciosamente a imagem fornecida do gráfico:
1. Identifique o ativo exibido, se corresponde ao mercado OTC ou normal selecionado, e se o período visível corresponde a M1 ou M5. Se a identidade do mercado for ilegível, não invente.
2. Identifique a tendência aparente, posição das velas recentes, EMA 21 (se visível), suportes e resistências, rejeições, rompimentos e zonas de indecisão.
3. Aplique o rigor do Signal Guard: bloqueie sinais (retornando AGUARDAR) se a imagem estiver borrada, incompleta, ativo divergente, período indefinido, sinais contraditórios ou contexto insuficiente.
4. NUNCA invente indicadores não visíveis nem preveja com certeza absoluta o próximo candle. Seja estritamente educativo e analítico.
5. Avalie a ESTRUTURA de mercado, e não apenas a cor isolada das velas: compra com estrutura de alta, venda com estrutura de baixa. Uma vela corretiva pequena contra a tendência NÃO bloqueia automaticamente a hipótese, desde que o movimento principal esteja claro e a correção seja visivelmente fraca.
6. Classifique a vela atual e a última vela fechada conforme a captura em ALTA, BAIXA ou INDEFINIDA. Determine também se a estrutura suporta o lado proposto (trendSupportsDirection), e se a vela atual contrária representa claramente uma correção pequena sem força (minorCountertrendPullback). Não marque esses campos como true se não houver evidência visível.\n6a. Para diagnósticos EM OBSERVAÇÃO apenas, avalie especificamente: força do corpo da vela atual (candleBodyStrength: FORTE, MODERADO, FRACO ou INDEFINIDO), pressão de pavios contra a direção proposta (opposingWickPressure: FORTE, MODERADA, FRACA ou INDEFINIDA), evidência de reversão (reversalEvidence: FORTE, MODERADA, AUSENTE ou INDEFINIDA), continuação da estrutura (structureContinuation: SIM, NAO ou INDEFINIDA). Não invente medições nem confunda uma vela aberta com fechada; quando invisível, marque INDEFINIDO ou INDEFINIDA. Estes diagnósticos NÃO aprovam nem bloqueiam operações.
7. Se houver reversão convincente, pressão oposta forte, mercado lateral sem direção ou conflito relevante entre tendência, velas e resistência/suporte, marque contradictory=true, passed=false, AGUARDAR. NÃO inverta automaticamente COMPRA para VENDA por uma única vela vermelha, nem VENDA para COMPRA por uma única vela verde.
8. Esta é uma hipótese educacional para uma futura entrada, não uma previsão confiável nem recomendação definitiva. Não há garantia de acerto.
9. Retorne estritamente um JSON com a estrutura solicitada.
`;

      const prompt = `Analise a captura de gráfico ${chartMarket === "OTC" ? "OTC" : "de mercado normal (não OTC)"}. Ativo: ${selectedAsset}. Tipo: ${marketMode}. Período: ${selectedTimeframe}. Expiração: ${selectedExpiration}. Etapa: ${stage}. Horário previsto de entrada (UTC epoch ms): ${target}. ${stage === "CONFIRM" ? "Confirme SOMENTE se a mesma direção " + priorDirection + " continuar forte; caso contrário AGUARDAR." : "Verifique se existe uma hipótese preliminar suficientemente clara."} Retorne JSON; se ambiguidade, AGUARDAR.`;

      const budget = groqBudget();
      if (!budget.allowed) return res.status(429).set("Retry-After", String(budget.retryAfterSeconds)).json({
        error: budget.reason === "daily" ? "Limite preventivo diário de análises gratuitas atingido." :
          "Economia da API Groq: aguardando intervalo seguro entre análises.",
        type:"API_RATE_LIMIT", retryAfterSeconds:budget.retryAfterSeconds, attempts:[]
      });
      const admission = usageGate.acquire();
      if (!admission.allowed) {
        const quota = admission.reason === "LIMIT" || admission.reason === "PAUSE";
        return res.status(quota ? 429 : 503).set("Retry-After", String(admission.retryAfterSeconds)).json({
          error: quota ? "Economia de API ativa: aguarde antes da próxima análise."
            : "Outra imagem já está sendo analisada. Aguarde a resposta.",
          type: quota ? "API_RATE_LIMIT" : "ANALYSIS_BUSY",
          retryAfterSeconds: admission.retryAfterSeconds,
          usage: usageGate.stats()
        });
      }
      // Groq multimodal request; existing guard validations below remain unchanged.
      const primaryModel = primaryGroqModel();
      const backupModel = fallbackGroqModel();
      const generationRequest = { systemPrompt, prompt, imageBase64 };
      let response;
      let activeModel = primaryModel;
      // Only send attempts once per model, never loop or retry a possibly processed request.
      const modelAttempts: {model:string;status:number|null;kind:string;elapsedMs:number}[] = [];
      const generate = async (model:string) => {
        const started = Date.now();
        try {
          countGroqRequest();
           const result = await groqGenerate(model, generationRequest);
          modelAttempts.push({model,status:200,kind:"OK",elapsedMs:Date.now()-started});
          return result;
        } catch(error:any) {
          const status = Number(error?.status || error?.code);
          const safeStatus = Number.isFinite(status) && status >= 400 && status <= 599 ? status : null;
          modelAttempts.push({model,status:safeStatus,kind:classifyGeminiError(error),elapsedMs:Date.now()-started});
          console.warn("Groq multimodal request failed", {model,status:safeStatus,kind:classifyGeminiError(error),elapsedMs:Date.now()-started});
          throw error;
        }
      };
      try {
        const cooldownActive = Date.now() < primaryOverloadedUntil &&
          backupModel && backupModel !== primaryModel;
        activeModel = cooldownActive ? backupModel : primaryModel;
        try {
          response = await generate(activeModel);
          if (activeModel === primaryModel) primaryOverloadedUntil = 0;
        } catch (primaryError: any) {
          const kind = classifyGeminiError(primaryError);
          if (kind === "OVERLOAD" && activeModel === primaryModel)
            primaryOverloadedUntil = Date.now() + 15 * 60_000;
          if (kind !== "OVERLOAD" || activeModel !== primaryModel ||
              !backupModel || backupModel === primaryModel) throw primaryError;
          const fallbackPermission = usageGate.consumeFallback();
          if (!fallbackPermission.allowed) {
            // Preserve the original 503 instead of disguising it as quota 429.
            throw primaryError;
          }
          activeModel = backupModel;
          response = await generate(backupModel);
        }
      } catch(error:any) {
        // Send only sanitized model diagnostics. Never return provider error body or key.
        error.tozziAttempts = modelAttempts;
        throw error;
      } finally {
        usageGate.release();
      }
      groqOverloadStreak = 0;
      groqQuotaStreak = 0;
      console.log("Chart analysis succeeded with model:", activeModel);

      const jsonText = response.text || "{}";
      let analysisData;
      try {
        analysisData = JSON.parse(jsonText);
      } catch (err) {
        analysisData = {
          visionResult: {
            assetDetected: selectedAsset,
            isOtc: true,
            timeframeDetected: selectedTimeframe,
            trend: "Lateral / Indefinida",
            decision: "AGUARDAR",
            reason: "Erro ao parsear resposta da IA. Aguardando próxima captura."
          },
          guardResult: {
            passed: false,
            checks: { blurry: false, incomplete: true, assetMatch: true, timeframeMatch: true, contradictory: false, contextOk: false },
            finalDecision: "AGUARDAR",
            guardReason: "Falha de processamento estruturado. Sinal bloqueado por segurança."
          }
        };
      }

      // The model alone cannot approve a trade. Apply deterministic direction/time safeguards.
      const vision = analysisData.visionResult || {};
      const guard = analysisData.guardResult || {};
      const ch = guard.checks || {};
      const direction = guard.finalDecision;
      const expectedCandle = direction === "POSSÍVEL COMPRA" ? "ALTA" : direction === "POSSÍVEL VENDA" ? "BAIXA" : "";
      // Allow a clearly weak pullback instead of demanding two identical-color candles.
      // An opposing candle without explicit structural confirmation remains blocked.
      const mainCandleAligned = expectedCandle !== "" &&
        vision.lastClosedCandleDirection === expectedCandle;
      const latestCandleOk = vision.currentCandleDirection === expectedCandle ||
        (vision.minorCountertrendPullback === true && vision.trendSupportsDirection === true);
      const candleAligned = mainCandleAligned && latestCandleOk && vision.trendSupportsDirection === true;
      const previousAligned = stage !== "CONFIRM" || priorDirection === direction;
      const visionAgrees = vision.decision === direction;
      const timeframeCheck = checkTimeframe(selectedTimeframe, vision.timeframeDetected);
      const assetCheck = checkAsset(selectedAsset, vision.assetDetected);
      const timeframeAligned = timeframeCheck.passed;
      const assetAligned = assetCheck.passed;
      const remainingMs = target - Date.now();
      const withinWindow = stage === "PREPARE"
        ? remainingMs >= 30000 && remainingMs <= 60000
        : remainingMs >= 4000 && remainingMs <= 30000;
      const timing = timingBot({
        now: Date.now(), startedAt: requestStartedAt,
        captureTimestamp: Number(captureTimestamp), target,
        timeframe: selectedTimeframe, phase: stage
      });
      const trend = trendBot(vision, direction);
      const finalCandleQuality = confirmationQuality(stage, direction, vision);
      const finalCandleRisk = finalCandleRiskGate(stage,vision);
      // Advisory-only: no extra request, no modification to approval logic.
      const advisoryDirection = direction === "POSSÍVEL COMPRA" || direction === "POSSÍVEL VENDA" ? direction : vision.decision;
      const precisionCandle = precisionCandleBot(vision, advisoryDirection);
      const reversalWatch = reversalWatchBot(vision, advisoryDirection);
      // The Guard may decline by setting finalDecision=AGUARDAR. In that case,
      // reviewing candles against AGUARDAR would produce a misleading generic
      // "no direction" message instead of exposing the actual rejection reason.
      // For diagnostics only, inspect the visual proposal. Never override Guard approval.
      const candleReviewDirection = direction === "POSSÍVEL COMPRA" || direction === "POSSÍVEL VENDA"
        ? direction : vision.decision;
      const candles = candleBot(vision, candleReviewDirection);
      const guardDeclined = guard.passed !== true ||
        (direction !== "POSSÍVEL COMPRA" && direction !== "POSSÍVEL VENDA");
      const approved = guard.passed === true && ch.blurry === false && ch.incomplete === false &&
        assetAligned && timeframeAligned && ch.contradictory === false && ch.contextOk === true &&
        candleAligned && previousAligned && visionAgrees && timeframeAligned && assetAligned && withinWindow &&
        trend.passed && candles.passed && finalCandleQuality.passed && finalCandleRisk.passed &&
        timing.passed && Date.now() - requestStartedAt <= 15000;
      if (!approved) {
        analysisData.guardResult = {
          ...guard, passed: false, finalDecision: "AGUARDAR",
          guardReason: !timing.passed ? "Timing Bot: " + timing.reason
            : guardDeclined ? "Signal Guard: " + (guard.guardReason || vision.reason || "Análise visual sem direção segura; aguardando nova captura.")
            : !finalCandleRisk.passed ? "Proteção da vela final: " + finalCandleRisk.reason
            : !finalCandleQuality.passed ? "Reconfirmação de velas: " + finalCandleQuality.reason
            : !candles.passed ? "Candle Bot: " + candles.reason
            : !trend.passed ? "Trend Bot: " + trend.reason
            : !candleAligned ? "Tendência, última vela fechada ou correção atual sem confirmação suficiente. Aguardando estrutura clara."
            : !previousAligned || !visionAgrees ? "Vision Bot e Signal Guard divergem ou a direção mudou. Sinal cancelado."
            : !withinWindow ? "Sinal expirado fora da janela programada."
            : !assetAligned ? "Identificação do ativo: " + assetCheck.reason + " Selecionado: " + assetCheck.expected + "; detectado: " + (assetCheck.detected || "ilegível") + "."
            : !timeframeAligned ? "Identificação do período: " + timeframeCheck.reason + " Selecionado: " + timeframeCheck.expected + "; detectado: " + (timeframeCheck.detected || "ilegível") + "."
            : guard.guardReason || "Condições insuficientes para entrada."
        };
      }
      // An inconclusive second image is NOT evidence that the direction reversed.
      // Reserve "CANCELLED" for an explicitly visible, material opposite move.
      const oppositeCandle = expectedCandle === "ALTA" ? "BAIXA" : "ALTA";
      const clearReversal = !approved && expectedCandle !== "" &&
        ch.contradictory === true &&
        vision.currentCandleDirection === oppositeCandle &&
        vision.trendSupportsDirection === false &&
        vision.minorCountertrendPullback === false;
      const phaseEvent = stage === "PREPARE" ? "PRE_ALERT" :
        approved ? "CONFIRMED" : clearReversal ? "CANCELLED" : "UNVERIFIED";
      if (!approved && stage === "CONFIRM") {
        analysisData.guardResult = {
          ...analysisData.guardResult,
          guardReason: clearReversal
            ? "Conflito confirmado: estrutura contrária e pressão oposta na vela atual. Pré-alerta cancelado."
            : "Reconfirmação inconclusiva. Pré-alerta NÃO confirmado: " +
              (analysisData.guardResult?.guardReason || "condições não verificadas.")
        };
      }
      // Never release an entry if the guard fails. Relay the actual failure reason.
      if (approved || stage === "CONFIRM") {
        const broadcastPayload = JSON.stringify({
          type: phaseEvent,
          timestamp: new Date().toISOString(),
          targetEpoch: target,
          asset: selectedAsset, timeframe: selectedTimeframe, expiration: selectedExpiration, optionMode: marketMode,
          latencyMs: Date.now() - requestStartedAt,
          bots: {
            timing: { ...timing, name: "Tozzi Timing Bot" },
            trend: { ...trend, name: "Tozzi Trend Bot" },
            candles,
            finalCandleQuality,
            finalCandleRisk,
            precisionCandle,
            reversalWatch
          },
          ...analysisData
        });
        for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(broadcastPayload);
      }
      analysisData.bots = {
        timing: { ...timing, name: "Tozzi Timing Bot" },
        trend: { ...trend, name: "Tozzi Trend Bot" },
        candles,
        finalCandleQuality,
        finalCandleRisk,
        precisionCandle,
        reversalWatch,
        vision: { name: "Tozzi Vision Bot", decision: vision.decision },
        guard: { name: "Tozzi Signal Guard", passed: approved, decision: approved ? direction : "AGUARDAR" }
      };
      analysisData.apiUsage = usageGate.stats();
      analysisData.providerModel = activeModel;
      analysisData.identity = { asset: assetCheck, timeframe: timeframeCheck };
      analysisData.optionMode = marketMode;
      analysisData.phase = stage;
      analysisData.phaseEvent = phaseEvent;
      analysisData.targetEpoch = target;
      analysisData.serverNow = Date.now();

      res.json(analysisData);
    } catch (error: any) {
      // Always release the gate, even if parsing or downstream validation fails.
      usageGate.release();
      const kind = classifyGeminiError(error);
      if (kind === "QUOTA" || kind === "OVERLOAD") {
        if (kind === "OVERLOAD") groqOverloadStreak += 1;
        if (kind === "QUOTA") groqQuotaStreak += 1;
        const retryAfterSeconds = Math.max(Number(error?.retryAfterSeconds) || 0, kind === "QUOTA"
          ? Math.min(900, 120 * (2 ** Math.min(4, groqQuotaStreak - 1)))
          : Math.min(300, 60 * (2 ** Math.min(3, groqOverloadStreak - 1))));
        usageGate.pause(retryAfterSeconds);
        console.warn("Groq API paused due to", kind, "for", retryAfterSeconds, "seconds.", "models:",
          primaryGroqModel(), fallbackGroqModel());
        return res.status(kind === "QUOTA" ? 429 : 503)
          .set("Retry-After", String(retryAfterSeconds)).json({
            error: kind === "QUOTA"
              ? "Limite de consultas da Groq atingido (429). Aguardando liberação da cota."
              : "Groq temporariamente sobrecarregada (503). Pausa automática ativada.",
            type: kind === "QUOTA" ? "GROQ_QUOTA" : "GROQ_UNAVAILABLE",
            attempts: Array.isArray(error?.tozziAttempts) ? error.tozziAttempts : [],
            retryAfterSeconds
          });
      }
      console.error("Error analyzing chart:", error);
      res.status(kind === "AUTH" ? 503 : 500).json({
        error: kind === "AUTH" ? "Acesso à API Groq não autorizado. Verifique a configuração da chave."
          : "Falha técnica ao processar análise; nenhum sinal foi validado.",
        type: kind === "AUTH" ? "GROQ_AUTH" : "ANALYSIS_ERROR",
        attempts: Array.isArray(error?.tozziAttempts) ? error.tozziAttempts : []
      });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const path = await import("node:path");
    app.use(express.static(path.resolve("dist")));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.resolve("dist/index.html")));
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Tozzi Sinais IA running on http://0.0.0.0:${PORT}`);
  });

  // Attach WebSocket server for real-time mobile updates
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const expected = getAccessCode();
    const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map(v => v.trim());
    if (!expected || protocols[1] !== expected) {
      ws.close(1008, "Acesso não autorizado");
      return;
    }
    clients.add(ws);
    ws.send(JSON.stringify({ type: "WELCOME", message: "Conectado ao Tozzi Sinais IA (Modo Tempo Real)" }));
    ws.on("close", () => {
      clients.delete(ws);
    });
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
