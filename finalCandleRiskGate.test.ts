import {test} from "node:test";
import assert from "node:assert/strict";
import {finalCandleRiskGate} from "./finalCandleRiskGate.js";
import {upsertSignal,type SignalRecord} from "./signalHistory.js";
test("Only final confirmation vetoes strong contrary observations",()=>{
  const v={reversalEvidence:"FORTE",opposingWickPressure:"FRACA",structureContinuation:"SIM"};
  assert.equal(finalCandleRiskGate("PREPARE",v).passed,true);
  assert.equal(finalCandleRiskGate("CONFIRM",v).code,"STRONG_REVERSAL");
  assert.equal(finalCandleRiskGate("CONFIRM",{reversalEvidence:"AUSENTE",opposingWickPressure:"FORTE"}).code,"STRONG_OPPOSING_WICK");
  assert.equal(finalCandleRiskGate("CONFIRM",{reversalEvidence:"AUSENTE",opposingWickPressure:"FRACA",structureContinuation:"NAO"}).code,"NO_CONTINUATION");
  assert.equal(finalCandleRiskGate("CONFIRM",{reversalEvidence:"INDEFINIDA",opposingWickPressure:"INDEFINIDA"}).passed,true);
});
test("Final candle diagnostics survive the transition to CLOSED",()=>{
  const base:SignalRecord={id:"a",key:"same",timestamp:"2026-11-23T20:00:00Z",
    updatedAt:"2026-11-23T20:00:00Z",targetEpoch:1800000000000,asset:"EUR/USD OTC",
    timeframe:"M1",expiration:"1min",optionMode:"DIGITAL",decision:"POSSÍVEL VENDA",
    status:"CONFIRMED",reason:"Validado",guardReason:"Validado",guardPassed:true,
    latencyMs:6500,tradeAction:"TAKEN",result:"LOSS",candleBodyStrength:"FORTE",
    opposingWickPressure:"FRACA",reversalEvidence:"AUSENTE",
    structureContinuation:"SIM",finalCandleRiskCode:"NO_STRONG_CONFLICT"};
  const closed=upsertSignal([base],{...base,status:"CLOSED",reason:"Fim de janela",
    latencyMs:0,candleBodyStrength:undefined,opposingWickPressure:undefined,
    reversalEvidence:undefined,structureContinuation:undefined,finalCandleRiskCode:undefined,result:"PENDENTE"})[0];
  assert.equal(closed.reversalEvidence,"AUSENTE");
  assert.equal(closed.finalCandleRiskCode,"NO_STRONG_CONFLICT");
  assert.equal(closed.result,"LOSS");
});
