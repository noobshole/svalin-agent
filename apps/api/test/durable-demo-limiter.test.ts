import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  DemoLimiterObject,
  DurableDemoLimiter,
  type DemoLimiterNamespace,
  type DemoLimiterStorage,
} from "../src/lib/durable-demo-limiter.js";
import { SOLANA_WALLET, testConfig } from "./helpers.js";

function memoryStorage(): DemoLimiterStorage & { size: () => number } {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return structuredClone(data.get(key)) as T | undefined;
    },
    async put(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    async deleteAll() {
      data.clear();
    },
    size: () => data.size,
  };
}

/** One Durable Object shared by every limiter client, as on Cloudflare. */
function sharedNamespace(now: () => number) {
  const storage = memoryStorage();
  const object = new DemoLimiterObject({ storage }, undefined, now);
  const namespace: DemoLimiterNamespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: (input, init) => object.fetch(new Request(input, init)) }),
  };
  return { namespace, storage };
}

describe("Durable Object demo limiter", () => {
  it("enforces one daily allowance across separate isolates, renewed at 00:00 UTC", async () => {
    let now = Date.UTC(2026, 9, 26, 22, 0);
    const { namespace } = sharedNamespace(() => now);
    const isolateA = new DurableDemoLimiter(namespace, 3, 100);
    const isolateB = new DurableDemoLimiter(namespace, 3, 100);

    expect(await isolateA.check("1.1.1.1")).toEqual({ retryAfter: null, remaining: 2 });
    expect(await isolateB.check("1.1.1.1")).toEqual({ retryAfter: null, remaining: 1 });
    expect(await isolateA.check("1.1.1.1")).toEqual({ retryAfter: null, remaining: 0 });
    expect(await isolateB.check("1.1.1.1")).toEqual({ retryAfter: 2 * 60 * 60, remaining: 0 });
    expect((await isolateA.check("2.2.2.2")).retryAfter).toBeNull();

    now = Date.UTC(2026, 9, 27, 0, 1);
    expect(await isolateB.check("1.1.1.1")).toEqual({ retryAfter: null, remaining: 2 });
  });

  it("enforces the global daily cap, then starts a fresh day with empty storage", async () => {
    let now = 5_000_000;
    const { namespace, storage } = sharedNamespace(() => now);
    const limiter = new DurableDemoLimiter(namespace, 10, 2);

    expect((await limiter.check("a")).retryAfter).toBeNull();
    expect((await limiter.check("b")).retryAfter).toBeNull();
    expect((await limiter.check("c")).retryAfter).toBeGreaterThan(0);

    now += 24 * 60 * 60 * 1000;
    expect((await limiter.check("c")).retryAfter).toBeNull();
    expect(storage.size()).toBe(2);
  });

  it("pauses the free demo when the limiter cannot be reached", async () => {
    const namespace: DemoLimiterNamespace = {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => {
          throw new Error("unreachable");
        },
      }),
    };
    expect(await new DurableDemoLimiter(namespace, 10, 100).check("1.1.1.1")).toEqual({ retryAfter: 60, remaining: 0 });
  });

  it("is used by the demo route", async () => {
    const { namespace } = sharedNamespace(() => 9_000_000);
    const app = createApp(testConfig(), {
      clientIp: () => "1.1.1.1",
      demoLimiter: new DurableDemoLimiter(namespace, 1, 100),
    });

    expect((await app.request(`/v1/demo/risk/${SOLANA_WALLET}`)).status).toBe(200);
    const limited = await app.request(`/v1/demo/risk/${SOLANA_WALLET}`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
