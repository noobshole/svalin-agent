/**
 * Fixed-window rate limiter for the free demo endpoint: a per-key hourly limit plus a
 * global daily cap so the free tier can never burn through the Helius budget.
 * In-memory, single instance. Paid routes are never rate limited — payment is the limit.
 */
export class DemoRateLimiter {
  private readonly perKey = new Map<string, { count: number; windowStart: number }>();
  private global = { count: 0, windowStart: 0 };

  constructor(
    private readonly perHour: number,
    private readonly perDayGlobal: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns null when allowed, or the number of seconds until the caller may retry. */
  check(key: string): number | null {
    const now = this.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    if (now - this.global.windowStart >= day) {
      this.global = { count: 0, windowStart: now };
    }
    if (this.global.count >= this.perDayGlobal) {
      return Math.ceil((this.global.windowStart + day - now) / 1000);
    }

    const entry = this.perKey.get(key);
    if (!entry || now - entry.windowStart >= hour) {
      this.perKey.set(key, { count: 1, windowStart: now });
      this.global.count += 1;
      this.prune(now, hour);
      return null;
    }
    if (entry.count >= this.perHour) {
      return Math.ceil((entry.windowStart + hour - now) / 1000);
    }
    entry.count += 1;
    this.global.count += 1;
    return null;
  }

  private prune(now: number, hour: number) {
    if (this.perKey.size < 10_000) return;
    for (const [key, entry] of this.perKey) {
      if (now - entry.windowStart >= hour) this.perKey.delete(key);
    }
  }
}
