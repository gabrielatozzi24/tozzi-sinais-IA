import express from "express";
import { timingSafeEqual } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
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

// Initialize Gemini client server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

const PORT = Number(process.env.PORT) || 3000;

// Server-wide limit includes all connected browsers and model requests.
const usageGate = new ApiUsageGate(8);
let geminiOverloadStreak = 0;
let geminiQuotaStreak = 0;
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

      if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Configure GEMINI_API_KEY no Render." });
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
      // Default to a separate lighter model first; configured Render variables still take priority.
      const primaryModel = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
      const backupModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
      const generationRequest = {
        contents: [
          {
            inlineData: {
              mimeType: imageBase64.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
              data: cleanBase64,
            },
          },
          { text: prompt },
        ],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              visionResult: {
                type: Type.OBJECT,
                properties: {
                  assetDetected: { type: Type.STRING },
                  isOtc: { type: Type.BOOLEAN },
                  timeframeDetected: { type: Type.STRING },
                  trend: { type: Type.STRING },
                  ema21Status: { type: Type.STRING },
                  supportResistance: { type: Type.STRING },
                  candlesSummary: { type: Type.STRING },
                  decision: { type: Type.STRING, description: "POSSÍVEL COMPRA, POSSÍVEL VENDA ou AGUARDAR" },
                  currentCandleDirection: { type: Type.STRING, description: "ALTA, BAIXA ou INDEFINIDA" },
                  lastClosedCandleDirection: { type: Type.STRING, description: "ALTA, BAIXA ou INDEFINIDA" },
                  trendSupportsDirection: { type: Type.BOOLEAN, description: "Estrutura de tendência confirmada sustenta a direção proposta" },
                  minorCountertrendPullback: { type: Type.BOOLEAN, description: "Vela atual contrária é apenas correção pequena e fraca, com evidência visual" },
                  candleBodyStrength: { type: Type.STRING, enum: ["FORTE","MODERADO","FRACO","INDEFINIDO"], description: "Força do corpo da vela atual visível; INDEFINIDO se não há evidência" },
                  opposingWickPressure: { type: Type.STRING, enum: ["FORTE","MODERADA","FRACA","INDEFINIDA"], description: "Pressão de pavios CONTRÁRIOS à direção proposta; INDEFINIDA se não verificável" },
                  reversalEvidence: { type: Type.STRING, enum: ["FORTE","MODERADA","AUSENTE","INDEFINIDA"], description: "Evidência visual de reversão, não certeza preditiva" },
                  structureContinuation: { type: Type.STRING, enum: ["SIM","NAO","INDEFINIDA"], description: "Estrutura favorece continuação da direção proposta segundo a captura" },
                  reason: { type: Type.STRING }
                },
                required: ["assetDetected", "isOtc", "timeframeDetected", "trend", "decision", "reason", "currentCandleDirection", "lastClosedCandleDirection", "trendSupportsDirection", "minorCountertrendPullback"]
              },
              guardResult: {
                type: Type.OBJECT,
                properties: {
                  passed: { type: Type.BOOLEAN },
                  checks: {
                    type: Type.OBJECT,
                    properties: {
                      blurry: { type: Type.BOOLEAN },
                      incomplete: { type: Type.BOOLEAN },
                      assetMatch: { type: Type.BOOLEAN },
                      timeframeMatch: { type: Type.BOOLEAN },
                      contradictory: { type: Type.BOOLEAN },
                      contextOk: { type: Type.BOOLEAN }
                    },
                    required: ["blurry", "incomplete", "assetMatch", "timeframeMatch", "contradictory", "contextOk"]
                  },
                  finalDecision: { type: Type.STRING, description: "POSSÍVEL COMPRA, POSSÍVEL VENDA ou AGUARDAR" },
                  guardReason: { type: Type.STRING }
                },
                required: ["passed", "checks", "finalDecision", "guardReason"]
              }
            },
            required: ["visionResult", "guardResult"]
          }
        }
      };
      let response;
      let activeModel = primaryModel;
      try {
        const cooldownActive = Date.now() < primaryOverloadedUntil &&
          backupModel && backupModel !== primaryModel;
        // After a genuine 503, briefly prefer the backup instead of repeatedly
        // hitting a known-overloaded model and wasting two calls per candle.
        activeModel = cooldownActive ? backupModel : primaryModel;
        try {
          response = await ai.models.generateContent({ model: activeModel, ...generationRequest });
          if (activeModel === primaryModel) primaryOverloadedUntil = 0;
        } catch (primaryError: any) {
          const kind = classifyGeminiError(primaryError);
          if (kind === "OVERLOAD" && activeModel === primaryModel)
            primaryOverloadedUntil = Date.now() + 15 * 60_000;
          // Never fail over on 429 quotas, auth failures, or while already using backup.
          if (kind !== "OVERLOAD" || activeModel !== primaryModel ||
              !backupModel || backupModel === primaryModel) throw primaryError;
          const fallbackPermission = usageGate.consumeFallback();
          if (!fallbackPermission.allowed) {
            throw { status: 429, message: "Limite local: fallback não iniciado para preservar cota." };
          }
          activeModel = backupModel;
          response = await ai.models.generateContent({ model: backupModel, ...generationRequest });
        }
      } finally {
        usageGate.release();
      }
      geminiOverloadStreak = 0;
      geminiQuotaStreak = 0;
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
        if (kind === "OVERLOAD") geminiOverloadStreak += 1;
        if (kind === "QUOTA") geminiQuotaStreak += 1;
        const retryAfterSeconds = kind === "QUOTA"
          ? Math.min(900, 120 * (2 ** Math.min(4, geminiQuotaStreak - 1)))
          : Math.min(300, 60 * (2 ** Math.min(3, geminiOverloadStreak - 1)));
        usageGate.pause(retryAfterSeconds);
        console.warn("Gemini API paused due to", kind, "for", retryAfterSeconds, "seconds.", "models:",
          process.env.GEMINI_MODEL || "gemini-3.1-flash-lite", process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite");
        return res.status(kind === "QUOTA" ? 429 : 503)
          .set("Retry-After", String(retryAfterSeconds)).json({
            error: kind === "QUOTA"
              ? "Limite de consultas do Gemini atingido (429). Aguardando liberação da cota."
              : "Gemini temporariamente sobrecarregado (503). Pausa automática ativada.",
            type: kind === "QUOTA" ? "GEMINI_QUOTA" : "GEMINI_UNAVAILABLE",
            retryAfterSeconds
          });
      }
      console.error("Error analyzing chart:", error);
      res.status(kind === "AUTH" ? 503 : 500).json({
        error: kind === "AUTH" ? "Acesso à API Gemini não autorizado. Verifique a configuração da chave."
          : "Falha técnica ao processar análise; nenhum sinal foi validado.",
        type: kind === "AUTH" ? "GEMINI_AUTH" : "ANALYSIS_ERROR"
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
