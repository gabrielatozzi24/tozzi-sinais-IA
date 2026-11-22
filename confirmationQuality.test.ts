import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmationQuality } from "./confirmationQuality.js";

const buy = { lastClosedCandleDirection: "ALTA", currentCandleDirection: "ALTA", trendSupportsDirection: true, minorCountertrendPullback: false };
const sell = { lastClosedCandleDirection: "BAIXA", currentCandleDirection: "BAIXA", trendSupportsDirection: true, minorCountertrendPullback: false };

test("Confirmation quality allows aligned M1 BUY final candle", () => {
  assert.equal(confirmationQuality("CONFIRM","POSSÍVEL COMPRA",buy).passed,true);
});
test("Confirmation quality allows aligned M1 SELL final candle", () => {
  assert.equal(confirmationQuality("CONFIRM","POSSÍVEL VENDA",sell).passed,true);
});
test("Pre-alert can observe a weak countertrend pullback", () => {
  assert.equal(confirmationQuality("PREPARE","POSSÍVEL COMPRA",{...buy,currentCandleDirection:"BAIXA",minorCountertrendPullback:true}).passed,true);
});
test("Final confirmation blocks weak countertrend pullback rather than silently approving", () => {
  const verdict=confirmationQuality("CONFIRM","POSSÍVEL COMPRA",{...buy,currentCandleDirection:"BAIXA",minorCountertrendPullback:true});
  assert.equal(verdict.passed,false);assert.equal(verdict.detail,"CURRENT_CANDLE_CONFLICT");
});
test("Final confirmation also blocks opposing SELL pullback", () => {
  assert.equal(confirmationQuality("CONFIRM","POSSÍVEL VENDA",{...sell,currentCandleDirection:"ALTA",minorCountertrendPullback:true}).passed,false);
});
test("Final confirmation rejects undefined current candle", () => {
  assert.equal(confirmationQuality("CONFIRM","POSSÍVEL COMPRA",{...buy,currentCandleDirection:"INDEFINIDA"}).passed,false);
});
test("Final confirmation rejects unclear trend", () => {
  assert.equal(confirmationQuality("CONFIRM","POSSÍVEL COMPRA",{...buy,trendSupportsDirection:false}).passed,false);
});
test("Final confirmation rejects previous closed candle pointing against entry", () => {
  assert.equal(confirmationQuality("CONFIRM","POSSÍVEL COMPRA",{...buy,lastClosedCandleDirection:"BAIXA"}).passed,false);
});
test("Final confirmation does not approve AGUARDAR", () => {
  assert.equal(confirmationQuality("CONFIRM","AGUARDAR",buy).passed,false);
});
