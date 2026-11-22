export type CandleDirection = "ALTA" | "BAIXA" | "INDEFINIDA";
export type CandleVerdict = { name: string; passed: boolean; status: "ALINHADO" | "CORRECAO" | "CONFLITO" | "INDEFINIDO"; reason: string };

// Additional deterministic review of the SAME visual model output (no extra API call).
// This cannot independently observe price data and must not be described as independent validation.
export function candleBot(vision: {
  decision?: string;
  currentCandleDirection?: string;
  lastClosedCandleDirection?: string;
  minorCountertrendPullback?: boolean;
  trendSupportsDirection?: boolean;
}, decision: string): CandleVerdict {
  const name = "Tozzi Candle Bot";
  if (!["POSSÍVEL COMPRA", "POSSÍVEL VENDA"].includes(decision))
    return { name, passed: false, status: "INDEFINIDO", reason: "Sem direção visual suficiente para avaliar as velas." };
  const expected: CandleDirection = decision === "POSSÍVEL COMPRA" ? "ALTA" : "BAIXA";
  const opposite: CandleDirection = expected === "ALTA" ? "BAIXA" : "ALTA";
  if (vision.decision !== decision || vision.trendSupportsDirection !== true)
    return { name, passed: false, status: "INDEFINIDO", reason: "Direção proposta e estrutura do gráfico não concordam." };
  if (vision.lastClosedCandleDirection === opposite && vision.currentCandleDirection === opposite)
    return { name, passed: false, status: "CONFLITO", reason: "Duas velas visíveis apontam na direção oposta." };
  if (vision.lastClosedCandleDirection !== expected)
    return { name, passed: false, status: "INDEFINIDO", reason: "Última vela fechada não apoia a direção proposta." };
  if (vision.currentCandleDirection === expected)
    return { name, passed: true, status: "ALINHADO", reason: "Vela atual e última fechada estão alinhadas." };
  if (vision.currentCandleDirection === opposite && vision.minorCountertrendPullback === true)
    return { name, passed: true, status: "CORRECAO", reason: "Pequena correção identificada; exige reconfirmação." };
  return { name, passed: false, status: "INDEFINIDO", reason: "Direção da vela atual não está suficientemente clara." };
}
