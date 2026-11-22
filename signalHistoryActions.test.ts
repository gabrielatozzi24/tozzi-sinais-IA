import { test } from "node:test";
import assert from "node:assert/strict";
import { canRecordOutcome, historyGroup, summarizeSignals, upsertSignal, wasTaken, type SignalRecord } from "./signalHistory.js";

const base: SignalRecord = {
  id:"a",key:"key",timestamp:"2026-11-22T20:00:00Z",updatedAt:"2026-11-22T20:00:00Z",
  asset:"GBP/USD OTC",timeframe:"M1",expiration:"1min",decision:"POSSÍVEL COMPRA",
  reason:"Confirmação forte",guardReason:"Confirmação forte",guardPassed:true,
  latencyMs:1200,status:"CLOSED",result:"PENDENTE"
};
test("Somente sinais confirmados contam como operações potencialmente executadas",()=>{
  assert.equal(historyGroup(base),"CONFIRMED");
  assert.equal(historyGroup({...base,status:"UNVERIFIED"}),"UNCONFIRMED");
  assert.equal(historyGroup({...base,status:"AGUARDAR",decision:"AGUARDAR"}),"UNCONFIRMED");
  assert.equal(canRecordOutcome(base),false);
});
test("PEGUEI permite resultado e IGNOREI não permite",()=>{
  assert.equal(wasTaken({...base,tradeAction:"TAKEN"}),true);
  assert.equal(canRecordOutcome({...base,tradeAction:"TAKEN"}),true);
  assert.equal(wasTaken({...base,tradeAction:"IGNORED"}),false);
  assert.equal(canRecordOutcome({...base,tradeAction:"IGNORED",result:"LOSS"}),false);
});
test("WIN/LOSS legado continua contando sem clique retroativo",()=>{
  assert.equal(wasTaken({...base,result:"WIN"}),true);
  assert.equal(summarizeSignals([{...base,result:"WIN"}]).wins,1);
  assert.equal(summarizeSignals([{...base,result:"LOSS"}]).losses,1);
});
test("Ignorado nunca entra na taxa de acerto",()=>{
  const data=[{...base,tradeAction:"TAKEN" as const,result:"WIN" as const},
    {...base,id:"b",key:"key2",tradeAction:"IGNORED" as const,result:"LOSS" as const}];
  const stats=summarizeSignals(data);
  assert.equal(stats.rated,1); assert.equal(stats.wins,1);assert.equal(stats.losses,0);
});
test("Atualização automática CLOSED mantém clique PEGUEI e motivo da confirmação",()=>{
  const confirmed={...base,status:"CONFIRMED" as const,tradeAction:"TAKEN" as const,
    reason:"Estrutura comprovada",confirmedReason:"Estrutura comprovada"};
  const closed={...base,status:"CLOSED" as const,reason:"Horário encerrado",tradeAction:undefined};
  const record=upsertSignal([confirmed],closed)[0];
  assert.equal(record.status,"CLOSED");assert.equal(record.tradeAction,"TAKEN");
  assert.equal(record.confirmedReason,"Estrutura comprovada");
});
