export type ApiErrorKind = "QUOTA" | "OVERLOAD" | "AUTH" | "OTHER";

export function classifyGeminiError(error: any): ApiErrorKind {
  const raw = String(error?.message || error || "");
  const status = Number(error?.status || error?.code || 0);
  if (status === 429 || /"code"\s*:\s*429|RESOURCE_EXHAUSTED|rate limit|quota exceeded|quota failure|too many requests/i.test(raw)) return "QUOTA";
  if (status === 503 || /"code"\s*:\s*503|high demand|UNAVAILABLE|overloaded|temporarily unavailable/i.test(raw)) return "OVERLOAD";
  if (status === 401 || status === 403 || /API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) return "AUTH";
  return "OTHER";
}

export class ApiUsageGate {
  private attempts: number[] = [];
  private busy = false;
  private waitUntil = 0;

  constructor(private readonly maxAttemptsPerMinute = 8) {}

  acquire(now = Date.now()): { allowed: boolean; reason?: "BUSY" | "LIMIT" | "PAUSE"; retryAfterSeconds: number } {
    this.attempts = this.attempts.filter(at => now - at < 60_000);
    if (now < this.waitUntil)
      return { allowed: false, reason: "PAUSE", retryAfterSeconds: Math.max(1, Math.ceil((this.waitUntil - now) / 1000)) };
    if (this.busy)
      return { allowed: false, reason: "BUSY", retryAfterSeconds: 5 };
    if (this.attempts.length >= this.maxAttemptsPerMinute) {
      const earliest = this.attempts[0];
      return { allowed: false, reason: "LIMIT", retryAfterSeconds: Math.max(1, Math.ceil((earliest + 60_000 - now) / 1000)) };
    }
    this.busy = true;
    this.attempts.push(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  release(): void { this.busy = false; }
  pause(seconds: number, now = Date.now()): void {
    const safeSeconds = Number.isFinite(seconds) ? Math.min(1800, Math.max(30, Math.ceil(seconds))) : 90;
    this.waitUntil = Math.max(this.waitUntil, now + safeSeconds * 1000);
  }
  remainingPauseSeconds(now = Date.now()): number {
    return Math.max(0, Math.ceil((this.waitUntil - now) / 1000));
  }
  stats(now = Date.now()): { attemptsLastMinute: number; limitPerMinute: number; pausedSeconds: number } {
    return {
      attemptsLastMinute: this.attempts.filter(at => now - at < 60_000).length,
      limitPerMinute: this.maxAttemptsPerMinute,
      pausedSeconds: this.remainingPauseSeconds(now)
    };
  }
}
