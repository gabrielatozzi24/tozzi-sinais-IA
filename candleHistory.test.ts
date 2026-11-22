import { test } from "node:test";
import assert from "node:assert/strict";
import { candleBot } from "./candleBot.js";
import { signalKey, upsertSignal, summarizeSignals, type SignalRecord } from "./signalHistory.js";

test("Candle Bot accepts two agreeing bullish candles", () => {
  const v = { decision:"POSSÍVEL COMPRA", trendSupportsDirection:true,
    lastClosedCandleDirection:"ALTA", currentCandleDirection:"ALTA" };
  assert.equal(candleBot(v,"POSSÍVEL COMPRA").status,"ALINHADO");
});
test("Candle Bot labels small opposing pullback without requiring a new model", () => {
  const v = { decision:"POSSÍVEL VENDA", trendSupportsDirection:true,
    lastClosedCandleDirection:"BAIXA", currentCandleDirection:"ALTA", minorCountertrendPullback:true };
  assert.equal(candleBot(v,"POSSÍVEL VENDA").status,"CORRECAO");
});
test("Candle Bot blocks clear opposite pressure", () => {
  const v = { decision:"POSSÍVEL COMPRA", trendSupportsDirection:true,
    lastClosedCandleDirection:"BAIXA", currentCandleDirection:"BAIXA" };
  assert.equal(candleBot(v,"POSSÍVEL COMPRA").status,"CONFLITO");
});
test("History upserts same candle rather than double-counting preliminary and confirmed events", () => {
  const base: SignalRecord = {
    id:"first",key:signalKey({targetEpoch:60000,asset:"EUR/USD OTC",timeframe:"M1",expiration:"1min",optionMode:"BINARIA"}),
    timestamp:"2026-11-22T10:00:00Z",updatedAt:"2026-11-22T10:00:00Z", targetEpoch:60000,
    asset:"EUR/USD OTC",timeframe:"M1",expiration:"1min",optionMode:"BINARIA",
    decision:"POSSÍVEL COMPRA",status:"PRE_ALERT",reason:"análise inicial",guardReason:"",
    guardPassed:false,latencyMs:1000,result:"PENDENTE"
  };
  const next = { ...base, id:"second",status:"CONFIRMED" as const,
    updatedAt:"2026-11-22T10:00:10Z", guardPassed:true,reason:"confirmado" };
  const result = upsertSignal(upsertSignal([],base),next);
  assert.equal(result.length,1);
  assert.equal(result[0].id,"first");
  assert.equal(result[0].status,"CONFIRMED");
  assert.equal(result[0].timestamp,base.timestamp);
});
test("Only manually marked confirmed operations count toward WIN rate", () => {
  const rows: SignalRecord[] = ["CONFIRMED","UNVERIFIED","CANCELLED"].map((status,i)=>({
    id:String(i),key:String(i),timestamp:"2026-11-22T10:00:00Z",updatedAt:"2026-11-22T10:00:00Z",
    asset:"EUR/USD OTC",timeframe:"M1",expiration:"1min",decision:"POSSÍVEL COMPRA",
    status:status as SignalRecord["status"],reason:"test",guardReason:"test",guardPassed:status==="CONFIRMED",
    latencyMs:0,result:i===0?"WIN":"PENDENTE"
  }));
  const stats = summarizeSignals(rows);
  assert.equal(stats.total,3);
  assert.equal(stats.confirmed,1);
  assert.equal(stats.unconfirmed,1);
  assert.equal(stats.cancelled,1);
  assert.equal(stats.winRate,"100.0");
});
