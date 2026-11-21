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

  // API endpoint for Tozzi Vision Bot & Signal Guard chart analysis
  app.post("/api/analyze-chart", async (req, res) => {
    try {
      const { imageBase64, selectedAsset, selectedTimeframe, selectedExpiration } = req.body;

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
5. Retorne estritamente um JSON com a estrutura solicitada.
`;

      const prompt = `Analise esta captura de tela do gráfico OTC. Ativo esperado: ${selectedAsset}. Período: ${selectedTimeframe}. Expiração: ${selectedExpiration}. Retorne o resultado em JSON.`;

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
                  reason: { type: Type.STRING }
                },
                required: ["assetDetected", "isOtc", "timeframeDetected", "trend", "decision", "reason"]
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

      // Broadcast alert to all connected WebSocket clients (mobile viewers)
      const broadcastPayload = JSON.stringify({
        type: "NEW_SIGNAL",
        timestamp: new Date().toISOString(),
        asset: selectedAsset,
        timeframe: selectedTimeframe,
        expiration: selectedExpiration,
        ...analysisData
      });

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastPayload);
        }
      }

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
  wss.on("connection", (ws) => {
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
