import { afterEach, describe, expect, it, vi } from "vitest";

import { fastNearTx } from "../src/lib/fastnear.js";

type Answer = Response | Error;

/** A fake FastNEAR that gives these answers in turn, recording each request's auth header. */
function fakeFastNear(answers: Answer[]) {
  const auth: (string | null)[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    auth.push(new Headers(init?.headers).get("authorization"));
    const answer = answers.shift();
    if (!answer) throw new Error("no answer left");
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { fetchImpl, auth };
}

const refused = (headers?: Record<string, string>) => Response.json({ error: { code: -429, message: "Rate limits exceeded." } }, { status: 429, headers });
const page = () => Response.json({ txs_count: 7 });

describe("FastNEAR transactions API reads", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  it("waits and tries again when FastNEAR refuses, then answers", async () => {
    const { fetchImpl } = fakeFastNear([refused({ "Retry-After": "0" }), refused(), page()]);
    const waits: number[] = [];
    const result = await fastNearTx({ baseUrl: "https://tx", fetchImpl, sleep: async (ms) => void waits.push(ms) }, "/v0/account", {});
    expect(result).toEqual({ ok: true, body: { txs_count: 7 } });
    expect(waits).toEqual([1_000, 2_000]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({ level: "warn", msg: "fastnear_tx_failed", path: "/v0/account", attempt: 0, keyed: false, status: 429 });
  });

  it("gives up after the last retry and says why", async () => {
    const { fetchImpl } = fakeFastNear([refused(), refused(), refused()]);
    const result = await fastNearTx({ baseUrl: "https://tx", fetchImpl, retryDelaysMs: [0, 0] }, "/v0/account", {});
    expect(result).toEqual({ ok: false, reason: "HTTP 429" });
  });

  it("waits as long as Retry-After asks, up to 5 seconds", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    await fastNearTx({ baseUrl: "https://tx", fetchImpl: fakeFastNear([refused({ "Retry-After": "3" }), page()]).fetchImpl, sleep }, "/v0/account", {});
    await fastNearTx({ baseUrl: "https://tx", fetchImpl: fakeFastNear([refused({ "Retry-After": "60" }), page()]).fetchImpl, sleep }, "/v0/account", {});
    expect(waits).toEqual([3_000, 5_000]);
  });

  it("retries a server error or a dropped connection, but not a bad request or a timeout", async () => {
    const server = fakeFastNear([new Response("busy", { status: 503 }), new TypeError("network connection lost"), page()]);
    expect((await fastNearTx({ baseUrl: "https://tx", fetchImpl: server.fetchImpl, retryDelaysMs: [0, 0] }, "/v0/account", {})).ok).toBe(true);
    const bad = fakeFastNear([new Response("no", { status: 400 }), page()]);
    expect(await fastNearTx({ baseUrl: "https://tx", fetchImpl: bad.fetchImpl, retryDelaysMs: [0, 0] }, "/v0/account", {})).toEqual({ ok: false, reason: "HTTP 400" });
    const slow = fakeFastNear([new DOMException("timed out", "TimeoutError"), page()]);
    expect(await fastNearTx({ baseUrl: "https://tx", fetchImpl: slow.fetchImpl, retryDelaysMs: [0, 0] }, "/v0/account", {})).toEqual({ ok: false, reason: "TimeoutError" });
  });

  it("sends the key, and reads without it at once when FastNEAR turns it down", async () => {
    const { fetchImpl, auth } = fakeFastNear([Response.json({ error: "quota_exceeded" }, { status: 402 }), page()]);
    const waits: number[] = [];
    const result = await fastNearTx(
      { baseUrl: "https://tx", apiKey: "fastnear-secret-value", fetchImpl, sleep: async (ms) => void waits.push(ms) },
      "/v0/account",
      {},
    );
    expect(result.ok).toBe(true);
    expect(auth).toEqual(["Bearer fastnear-secret-value", null]);
    expect(waits).toEqual([]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fastnear-secret-value");
  });

  it("keeps the key on a rate-limit refusal", async () => {
    const { fetchImpl, auth } = fakeFastNear([refused(), page()]);
    await fastNearTx({ baseUrl: "https://tx", apiKey: "k", fetchImpl, retryDelaysMs: [0] }, "/v0/account", {});
    expect(auth).toEqual(["Bearer k", "Bearer k"]);
  });
});
