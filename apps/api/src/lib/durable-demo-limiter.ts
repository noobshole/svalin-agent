/**
 * Free demo limits on Cloudflare Workers. Workers run many isolates, each with its own memory,
 * so an in-memory counter never reaches its limit. One Durable Object holds every count instead,
 * persisted to its storage so a count survives the object being evicted when idle.
 */
import { decideDemoLimit, type DemoCheck, type DemoLimiter, type DemoWindow } from "./rate-limit.js";

/** The parts of the Durable Object state and namespace APIs this file uses. */
export type DemoLimiterStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  deleteAll(): Promise<void>;
};
export type DemoLimiterNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
};

type CheckRequest = { key: string; perDay: number; perDayGlobal: number };

/** Durable Object class (binding DEMO_LIMITER in wrangler.toml). */
export class DemoLimiterObject {
  constructor(
    private readonly state: { storage: DemoLimiterStorage },
    _env?: unknown,
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const { key, perDay, perDayGlobal } = (await request.json()) as CheckRequest;
    const storage = this.state.storage;
    const entryKey = `key:${key}`;
    const [entry, global] = await Promise.all([
      storage.get<DemoWindow>(entryKey),
      storage.get<DemoWindow>("global"),
    ]);

    const decision = decideDemoLimit(entry, global ?? { count: 0, windowStart: 0 }, this.now(), perDay, perDayGlobal);
    // A new day drops every per-key window, which also keeps storage from growing.
    if (decision.newDay) await storage.deleteAll();
    await storage.put(
      decision.retryAfter === null && decision.entry
        ? { global: decision.global, [entryKey]: decision.entry }
        : { global: decision.global },
    );
    return Response.json({ retryAfter: decision.retryAfter, remaining: decision.remaining } satisfies DemoCheck);
  }
}

/** Client used by the API: every isolate asks the same Durable Object. */
export class DurableDemoLimiter implements DemoLimiter {
  constructor(
    private readonly namespace: DemoLimiterNamespace,
    private readonly perDay: number,
    private readonly perDayGlobal: number,
  ) {}

  async check(key: string): Promise<DemoCheck> {
    try {
      const stub = this.namespace.get(this.namespace.idFromName("demo"));
      const response = await stub.fetch("https://demo-limiter/check", {
        method: "POST",
        body: JSON.stringify({ key, perDay: this.perDay, perDayGlobal: this.perDayGlobal } satisfies CheckRequest),
      });
      if (!response.ok) throw new Error(`demo limiter ${response.status}`);
      return (await response.json()) as DemoCheck;
    } catch (error) {
      // Fail closed: the free demo pauses rather than spending the data budget unmetered.
      console.error(JSON.stringify({ level: "error", msg: "demo_limiter_unavailable", error: String(error) }));
      return { retryAfter: 60, remaining: 0 };
    }
  }
}
