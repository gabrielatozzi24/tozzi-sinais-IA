import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeComparisons, type SignalRecord } from "./signalHistory.js";

function row(id: string, asset: string, optionMode: string | undefined, result: SignalRecord["result"], opts: Partial<SignalRecord>={}): SignalRecord {
  return {
    id, key:id, timestamp:"2026-11-23T18:00:00Z", updatedAt:"2026-11-23T18:00:00Z",
    asset, optionMode, timeframe:"M1", expiration:"1min", decision:"POSSÍVEL COMPRA",
    status:"CLOSED", tradeAction:"TAKEN", guardPassed:true,
    guardReason:"Reconfirmado", reason:"Reconfirmado", latencyMs:500, result, ...opts
  };
}
test("mercado normal e OTC são classificados pelo nome do ativo, não pelo modo de opção",()=>{
  const s=summarizeComparisons([
    row("a","EUR/USD OTC","BINARIA","WIN"),
    row("b","EUR/JPY OTC","DIGITAL","LOSS"),
    row("c","GBP/USD","DIGITAL","WIN"),
    row("d","EUR/USD","BINARIA","LOSS")
  ]);
  assert.deepEqual(s.markets.map(x=>[x.key,x.wins,x.losses,x.rated,x.winRate]),
    [["OTC",1,1,2,50],["REGULAR",1,1,2,50]]);
  assert.deepEqual(s.modes.slice(0,2).map(x=>[x.key,x.wins,x.losses,x.rated]),
    [["BINARIA",1,1,2],["DIGITAL",1,1,2]]);
  assert.deepEqual(s.combinations.slice(0,4).map(x=>[x.key,x.wins,x.losses]),
    [["OTC_BINARIA",1,0],["OTC_DIGITAL",0,1],["REGULAR_BINARIA",0,1],["REGULAR_DIGITAL",1,0]]);
});
test("sinais ignorados ou sem confirmação não contam, inclusive com WIN manual",()=>{
  const s=summarizeComparisons([
    row("a","EUR/USD OTC","BINARIA","WIN",{tradeAction:"IGNORED"}),
    row("b","EUR/USD OTC","DIGITAL","LOSS",{status:"UNVERIFIED"}),
    row("c","GBP/USD OTC","BINARIA","PENDENTE"),
    row("d","GBP/USD OTC","BINARIA","WIN")
  ]);
  assert.equal(s.operations,1);
  assert.equal(s.markets[0].wins,1);
  assert.equal(s.markets[0].losses,0);
});
test("dados antigos com WIN/LOSS continuam contabilizados sem tradeAction",()=>{
  const s=summarizeComparisons([
    row("a","GBP/USD OTC",undefined,"WIN",{tradeAction:undefined}),
    row("b","GBP/USD","OUTRO","LOSS",{tradeAction:undefined})
  ]);
  assert.equal(s.operations,2);
  assert.equal(s.modes[2].rated,2);
  assert.equal(s.modes[0].rated,0);
  assert.equal(s.combinations[4].rated,2);
});
test("grupos sem operações exibem taxa nula, nunca 0% como se houvesse LOSS",()=>{
  const s=summarizeComparisons([row("a","EUR/USD OTC","DIGITAL","WIN")]);
  assert.equal(s.markets[1].winRate,null);
  assert.equal(s.modes[0].winRate,null);
  assert.equal(s.combinations[0].winRate,null);
  assert.equal(s.combinations[1].winRate,100);
});
