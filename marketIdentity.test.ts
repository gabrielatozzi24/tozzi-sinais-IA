import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAsset, normalizeTimeframe, checkAsset, checkTimeframe } from "./marketIdentity.js";

test("Same OTC pair with spacing/parentheses still matches", () => {
  assert.equal(normalizeAsset("GBP/JPY (OTC)"), "GBPJPY OTC");
  assert.equal(checkAsset("GBP/JPY OTC"," GBP/JPY (OTC) ").passed, true);
  assert.equal(checkAsset("EUR/USD OTC","EUR-USD OTC").passed, true);
});
test("Different pair or OTC vs regular always blocks", () => {
  assert.equal(checkAsset("GBP/JPY OTC","GBP/USD OTC").passed, false);
  assert.equal(checkAsset("GBP/JPY OTC","GBP/JPY").passed, false);
  assert.equal(checkAsset("GBP/JPY","GBP/JPY OTC").passed, false);
});
test("Unreadable asset never becomes a confirmed match", () => {
  assert.equal(checkAsset("GBP/JPY OTC","indefinido").passed, false);
  assert.equal(checkAsset("GBP/JPY OTC","").passed, false);
});
test("M1 and M5 tolerate formatting, never cross-match", () => {
  assert.equal(normalizeTimeframe("1 min"), "M1");
  assert.equal(normalizeTimeframe("5 Minutos"), "M5");
  assert.equal(checkTimeframe("M1", "1 min").passed, true);
  assert.equal(checkTimeframe("M5", "M 5").passed, true);
  assert.equal(checkTimeframe("M1", "M5").passed, false);
  assert.equal(checkTimeframe("M1", "indefinido").passed, false);
});
