export type Timeframe = "M1" | "M5";
export type Phase = "PREPARE" | "CONFIRM";
export type Direction = "POSSÍVEL COMPRA" | "POSSÍVEL VENDA" | "AGUARDAR";
export type BotVerdict = { passed: boolean; reason: string; detail: string };

// Timing Bot: deterministic clock and image-age checks. No extra model requests.
export function timingBot(input: {
  now: number; startedAt: number; captureTimestamp: number; target: number;
  timeframe: Timeframe; phase: Phase;
}): BotVerdict {
  const { now, startedAt, captureTimestamp, target, timeframe, phase } = input;
  const period = timeframe === "M5" ? 300_000 : 60_000;
  if (![now, startedAt, captureTimestamp, target].every(Number.isFinite))
    return { passed: false, reason: "Relógio ou captura inválida.", detail: "INVALID_CLOCK" };
  if (target % period !== 0)
    return { passed: false, reason: "A entrada não coincide com o início de uma vela.", detail: "NOT_CANDLE_BOUNDARY" };
  const captureAge = now - captureTimestamp;
  if (captureAge < -5000 || captureAge > 18_000 || startedAt < captureTimestamp - 1000)
    return { passed: false, reason: "Imagem antiga ou relógios desencontrados.", detail: "STALE_CAPTURE" };
  const remaining = target - now;
  const min = phase === "PREPARE" ? 30_000 : 4000;
  const max = phase === "PREPARE" ? 60_000 : 30_000;
  if (remaining < min || remaining > max)
    return { passed: false, reason: "Entrada fora da janela de confirmação.", detail: "INVALID_WINDOW" };
  return { passed: true, reason: "Horário, início da vela e imagem recente verificados.", detail: "ON_TIME" };
}

export function trendBot(vision: {
  decision?: string;
  trendSupportsDirection?: boolean;
  lastClosedCandleDirection?: string;
  currentCandleDirection?: string;
  minorCountertrendPullback?: boolean;
}, signal: Direction): BotVerdict {
  if (signal !== "POSSÍVEL COMPRA" && signal !== "POSSÍVEL VENDA")
    return { passed: false, reason: "Nenhuma direção proposta.", detail: "NO_DIRECTION" };
  if (vision.decision !== signal)
    return { passed: false, reason: "Vision Bot e Signal Guard discordam da direção.", detail: "BOT_DISAGREEMENT" };
  if (vision.trendSupportsDirection !== true)
    return { passed: false, reason: "Tendência não confirma a direção proposta.", detail: "TREND_UNCLEAR" };
  const expected = signal === "POSSÍVEL COMPRA" ? "ALTA" : "BAIXA";
  if (vision.lastClosedCandleDirection !== expected)
    return { passed: false, reason: "Última vela fechada não confirma a estrutura.", detail: "CANDLE_CONFLICT" };
  if (vision.currentCandleDirection === expected)
    return { passed: true, reason: "Tendência e velas alinhadas.", detail: "ALIGNED" };
  if (vision.minorCountertrendPullback === true &&
      (vision.currentCandleDirection === "ALTA" || vision.currentCandleDirection === "BAIXA"))
    return { passed: true, reason: "Correção pequena identificada; exige reconfirmação posterior.", detail: "WEAK_PULLBACK" };
  return { passed: false, reason: "Vela atual contradiz ou não confirma a tendência.", detail: "CURRENT_CANDLE_UNCLEAR" };
}
