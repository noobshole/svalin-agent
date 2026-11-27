import type { NearBlock } from "@svalin-agent/shared";

import type { RefDclPool } from "../sources/near-source.js";

/**
 * Rhea Finance's pools read straight from NEAR at one block (near-token-backing-v2), for the Index
 * scripts only (Node; the API never imports this). Every pool on the classic contract is kept, with
 * the fields the grades use, so anyone can read the same block from an archive node and get the
 * same file byte for byte (`index:verify --chain`).
 */

export const RHEA_CONTRACT = "v2.ref-finance.near";
export const RHEA_DCL_CONTRACT = "dclv2.ref-labs.near";

/** One classic pool as archived: its id on the contract and the fields `poolDepth` reads. */
export type ChainPool = { id: number; pool_kind: string; token_account_ids: string[]; amounts: string[] };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Pools per call. NEAR answered 1,000 classic pools (about 600 KB) and 500 DCL pools (about 1.1 MB)
 * per call on 27 November 2026, so a whole edition takes about 25 calls instead of about 100.
 */
const PAGE = 1_000;
const DCL_PAGE = 500;

/**
 * Free mainnet endpoints that served the same pinned block on 27 November 2026, after the default
 * FastNEAR one: an independent provider first, then FastNEAR's second address. Several others are
 * shut down or need a key.
 */
export const NEAR_RPC_FALLBACKS: readonly string[] = ["https://near.drpc.org", "https://free.rpc.fastnear.com"];

/** Tries on one endpoint before moving to the next. Waits double from `retryMs`: 2 and 4 seconds by default. */
const TRIES_PER_ENDPOINT = 3;

/** Errors a node gives while it is busy, or a block behind: worth asking again, there or elsewhere. */
const PASSING_ERRORS = new Set(["INTERNAL_ERROR", "UNKNOWN_BLOCK", "NO_SYNCED_BLOCKS", "NOT_SYNCED_YET", "TIMEOUT_ERROR"]);

type Outcome<T> = { ok: true; result: T } | { ok: false; error: string; next: "retry" | "endpoint" | "stop" };

/**
 * Calls NEAR's JSON-RPC, one call at a time and `spacingMs` apart, because public nodes answer 429
 * to bursts. A node that is busy, failing or a block behind is asked again; one that keeps failing,
 * or refuses outright (a key needed, shut down), is left for the next endpoint, and later calls
 * start from the endpoint that last answered. A call that is wrong in itself (a contract error, for
 * one) fails at once. Every call names its block, so all endpoints give the same answer.
 */
export class NearRpc {
  private readonly urls: string[];
  private current = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    urls: string | readonly string[],
    private readonly fetchImpl: FetchLike = fetch,
    private readonly retryMs = 2_000,
    private readonly spacingMs = 100,
  ) {
    this.urls = [...new Set(typeof urls === "string" ? [urls] : urls)];
    if (this.urls.length === 0) throw new Error("NearRpc needs at least one endpoint");
  }

  /** The endpoint calls go to now. */
  get endpoint(): string {
    return this.urls[this.current];
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    const turn = this.queue.then(() => this.send<T>(method, params));
    this.queue = turn.then(
      () => new Promise((done) => setTimeout(done, this.spacingMs)),
      () => undefined,
    );
    return turn;
  }

  private async send<T>(method: string, params: unknown): Promise<T> {
    const failures: string[] = [];
    for (let tried = 0; tried < this.urls.length; tried += 1) {
      const url = this.urls[this.current];
      for (let attempt = 1; attempt <= TRIES_PER_ENDPOINT; attempt += 1) {
        const outcome = await this.once<T>(url, method, params);
        if (outcome.ok) return outcome.result;
        failures.push(`${new URL(url).host}: ${outcome.error}`);
        if (outcome.next === "stop") throw new Error(`NEAR RPC ${method} failed: ${outcome.error}`);
        if (outcome.next === "endpoint") break;
        if (attempt < TRIES_PER_ENDPOINT) await new Promise((done) => setTimeout(done, this.retryMs * 2 ** (attempt - 1)));
      }
      this.current = (this.current + 1) % this.urls.length;
    }
    throw new Error(`NEAR RPC ${method} failed on every endpoint: ${failures.slice(-3).join("; ")}`);
  }

  private async once<T>(url: string, method: string, params: unknown): Promise<Outcome<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "svalin-index", method, params }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return { ok: false, error: String(error).slice(0, 80), next: "retry" };
    }
    if (response.status === 429 || response.status >= 500) return { ok: false, error: `returned ${response.status}`, next: "retry" };
    if (!response.ok) return { ok: false, error: `returned ${response.status}`, next: "endpoint" };
    let body: { result?: T; error?: { name?: string; cause?: { name?: string } } };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { ok: false, error: "answered with something that is not JSON", next: "retry" };
    }
    if (body.result !== undefined) return { ok: true, result: body.result };
    const passing = PASSING_ERRORS.has(body.error?.cause?.name ?? "") || PASSING_ERRORS.has(body.error?.name ?? "");
    return { ok: false, error: JSON.stringify(body.error ?? null).slice(0, 160), next: passing ? "retry" : "stop" };
  }

  /** The latest final block: the one every pool of an edition is read at. */
  async finalBlock(): Promise<NearBlock> {
    const block = await this.request<{ header: { height: number; hash: string } }>("block", { finality: "final" });
    return { height: block.header.height, hash: block.header.hash };
  }

  /** A contract view call at `height`. */
  async view<T>(contract: string, method: string, args: unknown, height: number): Promise<T> {
    const result = await this.request<{ result?: number[] }>("query", {
      request_type: "call_function",
      block_id: height,
      account_id: contract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    if (!result.result) throw new Error(`no result from ${contract}.${method}`);
    return JSON.parse(Buffer.from(result.result).toString("utf8")) as T;
  }
}

/** Every classic pool on Rhea's contract at `height`, in id order. */
export async function readChainPools(rpc: NearRpc, height: number, contract = RHEA_CONTRACT): Promise<ChainPool[]> {
  const count = await rpc.view<number>(contract, "get_number_of_pools", {}, height);
  const pools: ChainPool[] = [];
  for (let from = 0; from < count; from += PAGE) {
    const page = await rpc.view<Omit<ChainPool, "id">[]>(contract, "get_pools", { from_index: from, limit: PAGE }, height);
    page.forEach(({ pool_kind, token_account_ids, amounts }, offset) => pools.push({ id: from + offset, pool_kind, token_account_ids, amounts }));
    if (page.length < PAGE && pools.length < count) throw new Error(`${contract} returned ${pools.length} of ${count} pools`);
  }
  return pools;
}

/** Every concentrated-liquidity pool on Rhea's DCL contract at `height`, with the fields the grades use. */
export async function readChainDclPools(rpc: NearRpc, height: number, contract = RHEA_DCL_CONTRACT): Promise<RefDclPool[]> {
  const pools: RefDclPool[] = [];
  for (let from = 0; ; from += DCL_PAGE) {
    const page = await rpc.view<RefDclPool[]>(contract, "list_pools", { from_index: from, limit: DCL_PAGE }, height);
    for (const { token_x, token_y, total_x, total_y, state } of page) pools.push({ token_x, token_y, total_x, total_y, state });
    if (page.length < DCL_PAGE) return pools;
  }
}
