import { test } from "node:test";
import assert from "node:assert/strict";
import { timingBot, trendBot } from "./bots.js";

const t = Date.UTC(2026, 10, 22, 13, 1, 0);
test("Timing Bot accepts a fresh M1 pre-alert for the next candle", () => {
  assert.equal(timingBot({now:t-45_000,startedAt:t-47_000,captureTimestamp:t-48_000,target:t,timeframe:"M1",phase:"PREPARE"}).passed,true);
});
test("Timing Bot rejects old images and mismatched time", () => {
  assert.equal(timingBot({now:t-35_000,startedAt:t-38_000,captureTimestamp:t-80_000,target:t,timeframe:"M1",phase:"PREPARE"}).detail,"STALE_CAPTURE");
});
test("Timing Bot prevents shifted entries outside candle boundary", () => {
  assert.equal(timingBot({now:t-45_000,startedAt:t-46_000,captureTimestamp:t-47_000,target:t+5000,timeframe:"M1",phase:"PREPARE"}).detail,"NOT_CANDLE_BOUNDARY");
});
test("Timing Bot checks M5 boundaries", () => {
  assert.equal(timingBot({now:t-45_000,startedAt:t-46_000,captureTimestamp:t-47_000,target:t,timeframe:"M5",phase:"PREPARE"}).passed,false);
});
test("Timing Bot accepts close-to-entry reconfirmation", () => {
  assert.equal(timingBot({now:t-20_000,startedAt:t-22_000,captureTimestamp:t-23_000,target:t,timeframe:"M1",phase:"CONFIRM"}).passed,true);
});
test("Timing Bot rejects expired confirmation", () => {
  assert.equal(timingBot({now:t+10_000,startedAt:t+8000,captureTimestamp:t+7000,target:t,timeframe:"M1",phase:"CONFIRM"}).passed,false);
});
test("Trend Bot approves clear buying structure", () => {
  assert.equal(trendBot({decision:"POSSÍVEL COMPRA",trendSupportsDirection:true,lastClosedCandleDirection:"ALTA",currentCandleDirection:"ALTA"},"POSSÍVEL COMPRA").passed,true);
});
test("Trend Bot accepts small opposing candle only with explicit correction flag", () => {
  assert.equal(trendBot({decision:"POSSÍVEL COMPRA",trendSupportsDirection:true,lastClosedCandleDirection:"ALTA",currentCandleDirection:"BAIXA",minorCountertrendPullback:true},"POSSÍVEL COMPRA").detail,"WEAK_PULLBACK");
});
test("Trend Bot blocks opposite-candle contradiction", () => {
  assert.equal(trendBot({decision:"POSSÍVEL COMPRA",trendSupportsDirection:true,lastClosedCandleDirection:"ALTA",currentCandleDirection:"BAIXA",minorCountertrendPullback:false},"POSSÍVEL COMPRA").passed,false);
});
test("Trend Bot blocks disagreement of the two AI results", () => {
  assert.equal(trendBot({decision:"POSSÍVEL VENDA",trendSupportsDirection:true,lastClosedCandleDirection:"BAIXA",currentCandleDirection:"BAIXA"},"POSSÍVEL COMPRA").detail,"BOT_DISAGREEMENT");
});
test("Trend Bot blocks undefined trend", () => {
  assert.equal(trendBot({decision:"POSSÍVEL VENDA",trendSupportsDirection:false,lastClosedCandleDirection:"BAIXA",currentCandleDirection:"BAIXA"},"POSSÍVEL VENDA").passed,false);
});
