import {test} from "node:test";
import assert from "node:assert/strict";
import {canSendDemoOrder,exactExpiry,expirationMs,sameAsset,validateDemoStake,type DemoCandidate} from "./demoAutoTrade.js";
const signal:DemoCandidate={targetEpoch:1800000000000,asset:"EUR/USD OTC",decision:"POSSÍVEL COMPRA",status:"CONFIRMED",expiration:"1min",optionMode:"BINARIA"};
test("só pode tentar entrada na janela confirmada",()=>{
  assert.equal(canSendDemoOrder(signal,signal.targetEpoch,"BINARIA",signal.asset,true),null);
  assert.equal(canSendDemoOrder(signal,signal.targetEpoch+1500,"BINARIA",signal.asset,true),null);
  assert.notEqual(canSendDemoOrder(signal,signal.targetEpoch-1,"BINARIA",signal.asset,true),null);
  assert.notEqual(canSendDemoOrder(signal,signal.targetEpoch+1501,"BINARIA",signal.asset,true),null);
  assert.notEqual(canSendDemoOrder({...signal,status:"PRE_ALERT"},signal.targetEpoch,"BINARIA",signal.asset,true),null);
  assert.notEqual(canSendDemoOrder(signal,signal.targetEpoch,"BINARIA",signal.asset,false),null);
  assert.notEqual(canSendDemoOrder({...signal,decision:"POSSÍVEL VENDA"},signal.targetEpoch,"DIGITAL",signal.asset,true),null);
  assert.notEqual(canSendDemoOrder(signal,signal.targetEpoch,"BINARIA","GBP/USD OTC",true),null);
});
test("ativos OTC e regulares não podem se confundir",()=>{
  assert.equal(sameAsset("EUR/USD OTC","EURUSD-OTC"),true);
  assert.equal(sameAsset("EUR/USD","EURUSD"),true);
  assert.equal(sameAsset("EUR/USD OTC","EURUSD"),false);
  assert.equal(sameAsset("EUR/USD","EURUSD-OTC"),false);
});
test("expiração precisa ser exata e sem ambiguidade",()=>{
  assert.equal(expirationMs("1min"),60000);
  assert.equal(expirationMs("5min"),300000);
  assert.equal(expirationMs("2min"),null);
  const contracts=[{expire:1000},{expire:2000}];
  assert.deepEqual(exactExpiry(contracts,2000,c=>c.expire),contracts[1]);
  assert.equal(exactExpiry([...contracts,{expire:2000}],2000,c=>c.expire),null);
  assert.equal(exactExpiry(contracts,3000,c=>c.expire),null);
});
test("valor de operação respeita saldo DEMO e limite por ordem",()=>{
  assert.equal(validateDemoStake(1,100,10),true);
  assert.equal(validateDemoStake(11,100,10),false);
  assert.equal(validateDemoStake(2,1,10),false);
  assert.equal(validateDemoStake(0,100,10),false);
  assert.equal(validateDemoStake(NaN,100,10),false);
});
