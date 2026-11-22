export type SignalStatus = "PRE_ALERT" | "CONFIRMED" | "UNVERIFIED" | "CANCELLED" | "EXPIRED" | "CLOSED" | "AGUARDAR";
export type SignalDirection = "POSSÍVEL COMPRA" | "POSSÍVEL VENDA" | "AGUARDAR";
export type SignalOutcome = "WIN" | "LOSS" | "PENDENTE";
export type SignalAction = "TAKEN" | "IGNORED";

export interface SignalRecord {
  id: string;
  key: string;
  timestamp: string; // ISO first observed
  updatedAt: string; // ISO latest status
  targetEpoch?: number;
  asset: string;
  timeframe: string;
  expiration: string;
  optionMode?: string;
  decision: SignalDirection;
  reason: string;
  guardPassed: boolean;
  guardReason: string;
  latencyMs: number;
  status: SignalStatus;
  result?: SignalOutcome;
  tradeAction?: SignalAction; // undefined = ainda não classificado; WIN/LOSS antigos implicam operação registrada
  confirmedReason?: string; // conserva o motivo real ao encerrar a janela
  stages?: { status: SignalStatus; at: string; reason: string }[];
}

export function signalKey(input: Pick<SignalRecord, "targetEpoch" | "asset" | "timeframe" | "expiration" | "optionMode">): string {
  const value = Number(input.targetEpoch);
  return [
    Number.isFinite(value) && value > 0 ? String(value) : "sem-horario",
    input.asset.trim().toUpperCase(),
    input.timeframe,
    input.expiration,
    input.optionMode || "BINARIA"
  ].join("|");
}

export function upsertSignal(history: SignalRecord[], incoming: SignalRecord, max = 1500): SignalRecord[] {
  const index = history.findIndex(r => r.key === incoming.key);
  if (index < 0) return [incoming, ...history].slice(0, max);
  const old = history[index];
  const sameStage = old.status === incoming.status && old.reason === incoming.reason;
  const stages = sameStage ? (old.stages || []) :
    [...(old.stages || []), { status: incoming.status, at: incoming.updatedAt, reason: incoming.reason }].slice(-12);
  const updated: SignalRecord = {
    ...old, ...incoming, id: old.id, timestamp: old.timestamp,
    result: old.result === "WIN" || old.result === "LOSS" ? old.result : incoming.result,
    tradeAction: old.tradeAction ?? incoming.tradeAction,
    confirmedReason: incoming.status === "CONFIRMED" ? incoming.reason : old.confirmedReason,
    stages,
    // A confirmed signal must not become "unconfirmed" merely due to an old message.
    status: old.status === "CLOSED" && incoming.status === "PRE_ALERT" ? old.status : incoming.status
  };
  return [updated, ...history.filter((_, i) => i !== index)].slice(0, max);
}

export function isConfirmed(s: SignalRecord): boolean {
  return s.status === "CONFIRMED" || s.status === "CLOSED";
}

export type HistoryGroup = "CONFIRMED" | "UNCONFIRMED";
export function historyGroup(s: SignalRecord): HistoryGroup {
  return isConfirmed(s) ? "CONFIRMED" : "UNCONFIRMED";
}
export function wasTaken(s: SignalRecord): boolean {
  return isConfirmed(s) && s.tradeAction !== "IGNORED" &&
    (s.tradeAction === "TAKEN" || s.result === "WIN" || s.result === "LOSS");
}
export function canRecordOutcome(s: SignalRecord): boolean {
  return isConfirmed(s) && s.decision !== "AGUARDAR" && wasTaken(s);
}

export function summarizeSignals(items: SignalRecord[]) {
  const confirmed = items.filter(isConfirmed);
  const unconfirmed = items.filter(s => ["UNVERIFIED", "EXPIRED", "AGUARDAR"].includes(s.status));
  const cancelled = items.filter(s => s.status === "CANCELLED");
  const rated = confirmed.filter(s => canRecordOutcome(s) && (s.result === "WIN" || s.result === "LOSS"));
  const wins = rated.filter(s => s.result === "WIN").length;
  return {
    total: items.length,
    confirmed: confirmed.length,
    unconfirmed: unconfirmed.length,
    cancelled: cancelled.length,
    taken: confirmed.filter(wasTaken).length,
    ignored: confirmed.filter(s => s.tradeAction === "IGNORED").length,
    awaitingChoice: confirmed.filter(s => !wasTaken(s) && s.tradeAction !== "IGNORED").length,
    rated: rated.length,
    wins,
    losses: rated.length - wins,
    winRate: rated.length ? (wins / rated.length * 100).toFixed(1) : null
  };
}
