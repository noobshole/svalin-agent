/**
 * Fixed-window rate limiting for the free demo endpoint: a per-key hourly limit plus a
 * global daily cap so the free tier can never burn through the Helius budget.
 * Paid routes are never rate limited — payment is the limit.
 */
export type DemoWindow = { count: number; windowStart: number };

export type DemoLimitDecision = {
  /** null when allowed, or the number of seconds until the caller may retry. */
  retryAfter: number | null;
  /** The caller's window after this request (unchanged when refused). */
  entry: DemoWindow | undefined;
  global: DemoWindow;
  /** True when the daily window rolled over, so every per-key window can be dropped. */
  newDay: boolean;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The limit rule, shared by the in-memory limiter and the Cloudflare Durable Object. */
export function decideDemoLimit(
  entry: DemoWindow | undefined,
  global: DemoWindow,
  now: number,
  perHour: number,
  perDayGlobal: number,
): DemoLimitDecision {
  let newDay = false;
  if (now - global.windowStart >= DAY) {
    global = { count: 0, windowStart: now };
    newDay = true;
  }
  if (global.count >= perDayGlobal) {
    return { retryAfter: Math.ceil((global.windowStart + DAY - now) / 1000), entry, global, newDay };
  }
  if (!entry || now - entry.windowStart >= HOUR) {
    return { retryAfter: null, entry: { count: 1, windowStart: now }, global: { ...global, count: global.count + 1 }, newDay };
  }
  if (entry.count >= perHour) {
    return { retryAfter: Math.ceil((entry.windowStart + HOUR - now) / 1000), entry, global, newDay };
  }
  return {
    retryAfter: null,
    entry: { ...entry, count: entry.count + 1 },
    global: { ...global, count: global.count + 1 },
    newDay,
  };
}

/** Decides whether a free demo request may proceed. */
export interface DemoLimiter {
  /** Returns null when allowed, or the number of seconds until the caller may retry. */
  check(key: string): number | null | Promise<number | null>;
}

/** In-memory limiter for a single Node instance. */
export class DemoRateLimiter implements DemoLimiter {
  private readonly perKey = new Map<string, DemoWindow>();
  private global: DemoWindow = { count: 0, windowStart: 0 };

  constructor(
    private readonly perHour: number,
    private readonly perDayGlobal: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): number | null {
    const now = this.now();
    const decision = decideDemoLimit(this.perKey.get(key), this.global, now, this.perHour, this.perDayGlobal);
    this.global = decision.global;
    if (decision.newDay) this.perKey.clear();
    if (decision.retryAfter === null && decision.entry) {
      this.perKey.set(key, decision.entry);
      this.prune(now);
    }
    return decision.retryAfter;
  }

  private prune(now: number) {
    if (this.perKey.size < 10_000) return;
    for (const [key, entry] of this.perKey) {
      if (now - entry.windowStart >= HOUR) this.perKey.delete(key);
    }
  }
}
