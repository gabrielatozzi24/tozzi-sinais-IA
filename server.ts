import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";

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

async function startServer() {
  // Vite dev server integration
  // Connected WebSocket clients for real-time mobile alerts
  const clients = new Set<WebSocket>();
  const getAccessCode = () => process.env.TOZZI_ACCESS_CODE || "";
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
      const { imageBase64, selectedAsset, selectedTimeframe, selectedExpiration, phase, targetEpoch, priorDirection } = req.body;
      const stage = phase === "CONFIRM" ? "CONFIRM" : "PREPARE";
      const target = Number(targetEpoch);
      const remainingBefore = target - Date.now();
      if (!Number.isFinite(target) || remainingBefore < (stage === "PREPARE" ? 60000 : 4000) ||
        remainingBefore > (stage === "PREPARE" ? 420000 : 45000)) {
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
Você é o "Tozzi Vision Bot" e o "Tozzi Signal Guard", robôs especialistas em análise visual de gráficos OTC (opções binárias / Safirion).
O usuário selecionou o ativo: "${selectedAsset || "EUR/USD OTC"}" no período: "${selectedTimeframe || "M1"}" com expiração de: "${selectedExpiration || "1min"}".

Analise minuciosamente a imagem fornecida do gráfico:
1. Identifique o ativo exibido, se é OTC, se o período visível corresponde a M1 ou M5.
2. Identifique a tendência aparente, posição das velas recentes, EMA 21 (se visível), suportes e resistências, rejeições, rompimentos e zonas de indecisão.
3. Aplique o rigor do Signal Guard: bloqueie sinais (retornando AGUARDAR) se a imagem estiver borrada, incompleta, ativo divergente, período indefinido, sinais contraditórios ou contexto insuficiente.
4. NUNCA invente indicadores não visíveis nem preveja com certeza absoluta o próximo candle. Seja estritamente educativo e analítico.
5. Na avaliação de COMPRA, exija confirmação de pressão compradora nas velas recentes; em VENDA, pressão vendedora. Se as velas recentes ou a vela atual estiverem visivelmente contra a proposta, ou se a direção não puder ser verificada, escolha AGUARDAR.
6. Classifique a direção da vela atual e da última vela fechada EXCLUSIVAMENTE se estiverem nítidas na captura. Use ALTA, BAIXA ou INDEFINIDA.
7. Se houver divergência entre candle atual, tendência, suporte/resistência e sinal proposto, marque contradictory=true, passed=false e AGUARDAR.
8. Esta é uma hipótese educacional para uma futura entrada, não uma previsão confiável nem recomendação definitiva. Não há garantia de acerto.
9. Retorne estritamente um JSON com a estrutura solicitada.
`;

      const prompt = `Analise a captura OTC. Ativo: ${selectedAsset}. Período: ${selectedTimeframe}. Expiração: ${selectedExpiration}. Etapa: ${stage}. Horário previsto de entrada (UTC epoch ms): ${target}. ${stage === "CONFIRM" ? "Confirme SOMENTE se a mesma direção " + priorDirection + " continuar forte; caso contrário AGUARDAR." : "Verifique se existe uma hipótese preliminar suficientemente clara."} Retorne JSON; se ambiguidade, AGUARDAR.`;

      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
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
                  reason: { type: Type.STRING }
                },
                required: ["assetDetected", "isOtc", "timeframeDetected", "trend", "decision", "reason", "currentCandleDirection", "lastClosedCandleDirection"]
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
      });

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
      const candleAligned = expectedCandle !== "" &&
        vision.currentCandleDirection === expectedCandle &&
        vision.lastClosedCandleDirection === expectedCandle;
      const previousAligned = stage !== "CONFIRM" || priorDirection === direction;
      const visionAgrees = vision.decision === direction;
      const timeframeAligned = vision.timeframeDetected === selectedTimeframe;
      const assetAligned = String(vision.assetDetected || "").trim().toUpperCase() === String(selectedAsset || "").trim().toUpperCase();
      const remainingMs = target - Date.now();
      const withinWindow = stage === "PREPARE"
        ? remainingMs >= 60000 && remainingMs <= 420000
        : remainingMs >= 4000 && remainingMs <= 45000;
      const approved = guard.passed === true && ch.blurry === false && ch.incomplete === false &&
        ch.assetMatch === true && ch.timeframeMatch === true && ch.contradictory === false && ch.contextOk === true &&
        candleAligned && previousAligned && visionAgrees && timeframeAligned && assetAligned && withinWindow &&
        Date.now() - requestStartedAt <= 15000;
      if (!approved) {
        analysisData.guardResult = {
          ...guard, passed: false, finalDecision: "AGUARDAR",
          guardReason: !candleAligned ? "Direção da vela atual e da última vela fechada não confirma o mesmo movimento. Sinal bloqueado."
            : !previousAligned || !visionAgrees ? "Vision Bot e Signal Guard divergem ou a direção mudou. Sinal cancelado."
            : !withinWindow ? "Sinal expirado fora da janela programada."
            : !assetAligned || !timeframeAligned ? "Ativo ou período da captura não confirmado."
            : guard.guardReason || "Condições insuficientes para entrada."
        };
      }
      const phaseEvent = stage === "PREPARE" ? "PRE_ALERT" : approved ? "CONFIRMED" : "CANCELLED";
      // A cancellation is relayed only for the confirmation stage.
      if (approved || stage === "CONFIRM") {
        const broadcastPayload = JSON.stringify({
          type: phaseEvent,
          timestamp: new Date().toISOString(),
          targetEpoch: target,
          asset: selectedAsset, timeframe: selectedTimeframe, expiration: selectedExpiration,
          latencyMs: Date.now() - requestStartedAt,
          ...analysisData
        });
        for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(broadcastPayload);
      }
      analysisData.phase = stage;
      analysisData.targetEpoch = target;

      res.json(analysisData);
    } catch (error: any) {
      console.error("Error analyzing chart:", error);
      res.status(500).json({
        error: error.message || "Erro interno ao processar análise do gráfico.",
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
