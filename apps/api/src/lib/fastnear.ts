/**
 * Reads from FastNEAR's transactions API (tx.main.fastnear.com): account age, activity and
 * transfers for the payee check, and Svalin's own NEAR payments for Pro.
 *
 * Without a key, every caller on Cloudflare's network shares one small FastNEAR limit. On
 * 26 Nov 2026 about half of the single reads made from a Worker were refused at once with 429,
 * however far apart they were. A FastNEAR key has a limit of its own (the free trial allows 1,000
 * calls a minute), so FASTNEAR_API_KEY is sent when it is set. A refused or failed read is tried
 * again after a short wait, and a key FastNEAR turns down (unknown, or out of credits) falls back
 * to a read without it. Failures are logged with their reason, never with the key or the account.
 */
import { callFetch } from "./fetch.js";

type FetchLike = typeof fetch;

export type FastNearTxOptions = {
  /** For example https://tx.main.fastnear.com */
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** The wait before each retry, one retry per entry. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
};

/** A read's answer, or why there is none. */
export type FastNearTxResult<T> = { ok: true; body: T } | { ok: false; reason: string };

/** The waits before the second and third tries. FastNEAR's 429 says `Retry-After: 0`. */
export const TX_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000];
/** Answers to a key that is unknown, out of credits or not allowed for this request. */
const KEY_REFUSED = new Set([401, 402, 403]);
const MAX_RETRY_AFTER_MS = 5_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fastNearTx<T>(options: FastNearTxOptions, path: string, body: object): Promise<FastNearTxResult<T>> {
  const fetchImpl = options.fetchImpl ?? callFetch;
  const delays = options.retryDelaysMs ?? TX_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  let keyed = Boolean(options.apiKey);
  let retries = 0;
  let pause = 0;
  for (let attempt = 0; ; attempt += 1) {
    if (pause > 0) await sleep(pause);
    pause = 0;
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(keyed ? { Authorization: `Bearer ${options.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "network error";
      logFailure(path, attempt, keyed, { error: reason });
      // A read that timed out already waited the whole time, so another try would only double it.
      if (reason === "TimeoutError" || reason === "AbortError" || retries >= delays.length) return { ok: false, reason };
      pause = delays[retries++] ?? 0;
      continue;
    }
    if (response.ok) {
      try {
        return { ok: true, body: (await response.json()) as T };
      } catch {
        logFailure(path, attempt, keyed, { error: "unreadable answer" });
        return { ok: false, reason: "unreadable answer" };
      }
    }
    const status = response.status;
    const retryAfter = retryAfterMs(response.headers.get("retry-after"));
    // Free the connection: a Worker can hold only a few open at once.
    await response.body?.cancel().catch(() => undefined);
    logFailure(path, attempt, keyed, { status });
    if (keyed && KEY_REFUSED.has(status)) {
      keyed = false;
      continue;
    }
    if ((status !== 429 && status < 500) || retries >= delays.length) return { ok: false, reason: `HTTP ${status}` };
    pause = Math.max(delays[retries++] ?? 0, retryAfter);
  }
}

function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : 0;
}

function logFailure(path: string, attempt: number, keyed: boolean, detail: { status?: number; error?: string }) {
  console.warn(JSON.stringify({ level: "warn", msg: "fastnear_tx_failed", path, attempt, keyed, ...detail }));
}
