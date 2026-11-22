import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiUsageGate, classifyGeminiError } from "./apiUsage.js";

test("Gemini quota 429 is different from capacity 503", () => {
  assert.equal(classifyGeminiError({ status: 429, message: "RESOURCE_EXHAUSTED" }), "QUOTA");
  assert.equal(classifyGeminiError({ status: 503, message: "high demand" }), "OVERLOAD");
  assert.equal(classifyGeminiError({ status: 403, message: "PERMISSION_DENIED" }), "AUTH");
  assert.equal(classifyGeminiError({ status: 500, message: "Internal error" }), "OTHER");
});
test("API calls cannot run concurrently", () => {
  const gate = new ApiUsageGate(3);
  assert.equal(gate.acquire(100_000).allowed, true);
  assert.equal(gate.acquire(100_001).reason, "BUSY");
  gate.release();
  assert.equal(gate.acquire(100_002).allowed, true);
});
test("Per-minute cap is shared across requests", () => {
  const gate = new ApiUsageGate(2);
  assert.equal(gate.acquire(100_000).allowed, true); gate.release();
  assert.equal(gate.acquire(100_010).allowed, true); gate.release();
  const third = gate.acquire(100_020);
  assert.equal(third.reason, "LIMIT");
  assert.ok(third.retryAfterSeconds > 0);
  assert.equal(gate.acquire(160_001).allowed, true);
});
test("Fallback counts as an additional request", () => {
  const gate = new ApiUsageGate(2);
  assert.equal(gate.acquire(100_000).allowed, true);
  assert.equal(gate.consumeFallback(100_005).allowed, true);
  assert.equal(gate.consumeFallback(100_010).allowed, false);
  gate.release();
  assert.equal(gate.acquire(100_020).reason, "LIMIT");
});
test("Backoff pauses automatically but is bounded", () => {
  const gate = new ApiUsageGate(8);
  gate.pause(120, 100_000);
  assert.equal(gate.acquire(100_001).reason, "PAUSE");
  assert.equal(gate.acquire(220_001).allowed, true);
  gate.release();
  gate.pause(999999, 220_001);
  assert.equal(gate.remainingPauseSeconds(220_001), 1800);
});
