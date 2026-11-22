export type ConfirmationQuality = {
  passed: boolean;
  reason: string;
  detail: "CONFIRM_STRONG" | "PRELIMINARY" | "NO_DIRECTION" | "NO_TREND" | "LAST_CANDLE_CONFLICT" | "CURRENT_CANDLE_CONFLICT" | "UNCLEAR_CANDLE";
};

/**
 * This rule is an experiment in risk reduction, not a verified accuracy improvement.
 * PREPARE may consider a small correction, but CONFIRM cannot approve an opposing
 * active candle even if the vision model calls it a "minor pullback".
 */
export function confirmationQuality(
  phase: "PREPARE" | "CONFIRM",
  decision: string,
  vision: {
    lastClosedCandleDirection?: string;
    currentCandleDirection?: string;
    trendSupportsDirection?: boolean;
    minorCountertrendPullback?: boolean;
  }
): ConfirmationQuality {
  if (!["POSSÍVEL COMPRA", "POSSÍVEL VENDA"].includes(decision)) {
    return { passed: false, detail: "NO_DIRECTION", reason: "Sem direção aprovada pelo Guard." };
  }
  const expected = decision === "POSSÍVEL COMPRA" ? "ALTA" : "BAIXA";
  if (vision.trendSupportsDirection !== true) {
    return { passed: false, detail: "NO_TREND", reason: "Estrutura visual não confirma a tendência." };
  }
  if (vision.lastClosedCandleDirection !== expected) {
    return { passed: false, detail: "LAST_CANDLE_CONFLICT", reason: "Última vela fechada não está alinhada com a direção proposta." };
  }
  if (vision.currentCandleDirection === expected) {
    return { passed: true, detail: phase === "CONFIRM" ? "CONFIRM_STRONG" : "PRELIMINARY", reason: "Vela fechada e vela atual alinhadas." };
  }
  if (phase === "PREPARE" &&
      vision.minorCountertrendPullback === true &&
      ["ALTA", "BAIXA"].includes(vision.currentCandleDirection || "")) {
    return { passed: true, detail: "PRELIMINARY", reason: "Correção pequena aceita apenas na fase preliminar; requer reconfirmação visual alinhada." };
  }
  if (vision.currentCandleDirection === "INDEFINIDA" || !vision.currentCandleDirection) {
    return { passed: false, detail: "UNCLEAR_CANDLE", reason: "A vela atual não está suficientemente legível para confirmação final." };
  }
  return {
    passed: false, detail: "CURRENT_CANDLE_CONFLICT",
    reason: phase === "CONFIRM"
      ? "Vela atual contrária à direção proposta. Correções não são aceitas na confirmação final."
      : "Vela atual contrária sem evidência de correção fraca."
  };
}
