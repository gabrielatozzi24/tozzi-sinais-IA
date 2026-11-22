import { test } from "node:test";
import assert from "node:assert/strict";
import { precisionCandleBot, reversalWatchBot } from "./advisoryCandleBots.js";

const bullish = {
  decision:"POSSÍVEL COMPRA",lastClosedCandleDirection:"ALTA",currentCandleDirection:"ALTA",
  trendSupportsDirection:true,minorCountertrendPullback:false,
  candleBodyStrength:"FORTE",opposingWickPressure:"FRACA",
  reversalEvidence:"AUSENTE",structureContinuation:"SIM"
};
const bearish = {
  decision:"POSSÍVEL VENDA",lastClosedCandleDirection:"BAIXA",currentCandleDirection:"BAIXA",
  trendSupportsDirection:true,minorCountertrendPullback:false,
  candleBodyStrength:"FORTE",opposingWickPressure:"FRACA",
  reversalEvidence:"AUSENTE",structureContinuation:"SIM"
};

test("Two advisory bots return observational, non-independent results",()=>{
  for (const bot of [precisionCandleBot,reversalWatchBot]) {
    const result=bot(bullish,"POSSÍVEL COMPRA");
    assert.equal(result.status,"FAVORAVEL");
    assert.equal(result.mode,"OBSERVACAO");
    assert.equal(result.independent,false);
    assert.equal("passed" in result,false);
  }
});
test("BUY and SELL valid direction both supported",()=>{
  assert.equal(precisionCandleBot(bearish,"POSSÍVEL VENDA").status,"FAVORAVEL");
  assert.equal(reversalWatchBot(bearish,"POSSÍVEL VENDA").status,"FAVORAVEL");
});
test("Strong opposing wick warns, without changing trade decisions",()=>{
  assert.equal(precisionCandleBot({...bullish,opposingWickPressure:"FORTE"},"POSSÍVEL COMPRA").status,"ATENCAO");
});
test("Weak body warns",()=>{
  assert.equal(precisionCandleBot({...bullish,candleBodyStrength:"FRACO"},"POSSÍVEL COMPRA").status,"ATENCAO");
});
test("Unobserved candle data remain inconclusive rather than hallucinated",()=>{
  assert.equal(precisionCandleBot({...bullish,candleBodyStrength:undefined},"POSSÍVEL COMPRA").status,"INDETERMINADO");
  assert.equal(reversalWatchBot({...bullish,structureContinuation:undefined},"POSSÍVEL COMPRA").status,"INDETERMINADO");
});
test("Reversal warns for conflicting structural evidence",()=>{
  assert.equal(reversalWatchBot({...bullish,reversalEvidence:"FORTE"},"POSSÍVEL COMPRA").status,"ATENCAO");
  assert.equal(reversalWatchBot({...bullish,trendSupportsDirection:false},"POSSÍVEL COMPRA").status,"ATENCAO");
  assert.equal(reversalWatchBot({...bullish,minorCountertrendPullback:true},"POSSÍVEL COMPRA").status,"ATENCAO");
});
test("AGUARDAR has no advisory direction to endorse",()=>{
  assert.equal(precisionCandleBot(bullish,"AGUARDAR").status,"INDETERMINADO");
  assert.equal(reversalWatchBot(bullish,"AGUARDAR").status,"INDETERMINADO");
});
