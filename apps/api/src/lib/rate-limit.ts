/**
 * Daily limits for the free demo routes: a per-visitor allowance plus a global cap, so the free
 * tier can never burn through the data budget. Days are UTC days, the same for everyone: free
 * calls come back at 00:00 UTC. Paid routes are never rate limited — payment is the limit.
 */
export type DemoWindow = { count: number; windowStart: number };

export type DemoLimitDecision = {
  /** null when allowed, or the number of seconds until the caller may retry. */
  retryAfter: number | null;
  /** Free calls the caller has left today, after this request. */
  remaining: number;
  /** The caller's window after this request (unchanged when refused). */
  entry: DemoWindow | undefined;
  global: DemoWindow;
  /** True when a new day began, so every per-visitor window can be dropped. */
  newDay: boolean;
};

const DAY = 24 * 60 * 60 * 1000;

/** The limit rule, shared by the in-memory limiter and the Cloudflare Durable Object. */
export function decideDemoLimit(
  entry: DemoWindow | undefined,
  global: DemoWindow,
  now: number,
  perDay: number,
  perDayGlobal: number,
): DemoLimitDecision {
  const today = Math.floor(now / DAY) * DAY;
  const untilTomorrow = Math.ceil((today + DAY - now) / 1000);
  let newDay = false;
  if (global.windowStart !== today) {
    global = { count: 0, windowStart: today };
    newDay = true;
  }
  const used = entry && entry.windowStart === today ? entry.count : 0;
  if (global.count >= perDayGlobal || used >= perDay) {
    return { retryAfter: untilTomorrow, remaining: Math.max(0, perDay - used), entry, global, newDay };
  }
  return {
    retryAfter: null,
    remaining: perDay - used - 1,
    entry: { count: used + 1, windowStart: today },
    global: { ...global, count: global.count + 1 },
    newDay,
  };
}

/** The answer for one free request: whether it may proceed, and what is left today. */
export type DemoCheck = { retryAfter: number | null; remaining: number };

/** Decides whether a free demo request may proceed. */
export interface DemoLimiter {
  check(key: string): DemoCheck | Promise<DemoCheck>;
}

/** In-memory limiter for a single Node instance. */
export class DemoRateLimiter implements DemoLimiter {
  private readonly perKey = new Map<string, DemoWindow>();
  private global: DemoWindow = { count: 0, windowStart: 0 };

  constructor(
    private readonly perDay: number,
    private readonly perDayGlobal: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): DemoCheck {
    const decision = decideDemoLimit(this.perKey.get(key), this.global, this.now(), this.perDay, this.perDayGlobal);
    this.global = decision.global;
    if (decision.newDay) this.perKey.clear();
    if (decision.retryAfter === null && decision.entry) this.perKey.set(key, decision.entry);
    return { retryAfter: decision.retryAfter, remaining: decision.remaining };
  }
}
