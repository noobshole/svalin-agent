/**
 * Builds the Svalin Index for NEAR tokens: grades from Ref Finance's prices and pools, plus market
 * cap, top-10 holder share and holder count for tokens with real backing. Runs hourly
 * (.github/workflows/near-index.yml) and locally:
 *
 *   pnpm --filter @svalin-agent/api run index:near [data-dir]
 *
 * Supply and holder data barely move, and the public NEAR APIs rate limit bursts, so they are kept
 * in data-dir/near-token-stats.json and each token is refreshed about once a day, a few per run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { nearTokenIndexSchema, tokenGradeFor } from "@svalin-agent/shared";

import { sealEdition, sha256Hex } from "../src/ratings/edition.js";
import { marketCapUsd, rateNearTokens, top10Share, type TokenStats } from "../src/ratings/near-tokens.js";
import { parseRefPools, poolDepth, type NearPriceList } from "../src/sources/near-source.js";

const PRICES_URL = process.env.NEAR_PRICE_API_URL ?? "https://indexer.ref.finance/list-token-price";
const POOLS_URL = process.env.NEAR_POOLS_API_URL ?? "https://indexer.ref.finance/list-top-pools";
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";
const FASTNEAR_URL = process.env.FASTNEAR_API_URL ?? "https://api.fastnear.com";
const NEARBLOCKS_URL = process.env.NEARBLOCKS_API_URL ?? "https://api.nearblocks.io";
const DATA_DIR = resolve(process.argv[2] ?? "index-out");
const STATS_FILE = resolve(DATA_DIR, "near-token-stats.json");

const DAY_MS = 24 * 60 * 60 * 1000;
/** Zero-backing tokens with the highest quoted prices also get a market cap: the loudest claims. */
const LOUDEST_CLAIMS = 25;
/** Lookups per run. A full refresh of ~500 tokens spreads over the day's 24 runs. */
const BUDGET = {
  supply: Number(process.env.INDEX_SUPPLY_BUDGET ?? 60),
  topHolders: Number(process.env.INDEX_TOP_HOLDERS_BUDGET ?? 60),
  holderCount: Number(process.env.INDEX_HOLDER_COUNT_BUDGET ?? 8),
};

/** What is remembered between runs for each token, with when it was last fetched. */
type CachedStats = {
  supply?: string;
  supplyAt?: number;
  top10Pct?: number | null;
  top10At?: number;
  holders?: number | null;
  holdersAt?: number;
};

async function get(url: string, init?: RequestInit, attempt = 1): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (response.status === 429 && attempt < 4) {
    await sleep(2_000 * 2 ** (attempt - 1));
    return get(url, init, attempt + 1);
  }
  if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`);
  return response;
}

function sleep(ms: number) {
  return new Promise((done) => setTimeout(done, ms));
}

async function totalSupply(contract: string): Promise<string> {
  const response = await get(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "svalin-index",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: "ft_total_supply", args_base64: "e30=" },
    }),
  });
  const body = (await response.json()) as { result?: { result?: number[] } };
  if (!body.result?.result) throw new Error("no ft_total_supply");
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as string;
}

async function topHolders(contract: string) {
  const response = await get(`${FASTNEAR_URL}/v1/ft/${encodeURIComponent(contract)}/top`);
  const body = (await response.json()) as { accounts?: { account_id: string; balance: string }[] };
  return body.accounts ?? [];
}

async function holderCount(contract: string): Promise<number | null> {
  const response = await get(`${NEARBLOCKS_URL}/v1/fts/${encodeURIComponent(contract)}/holders/count`);
  const body = (await response.json()) as { holders?: { count?: string }[] };
  const count = Number(body.holders?.[0]?.count);
  return Number.isInteger(count) ? count : null;
}

/** The `budget` entries whose `at` timestamp is missing or oldest, among those older than a day. */
function stalest(contracts: string[], at: (contract: string) => number | undefined, budget: number, now: number) {
  return contracts
    .filter((contract) => now - (at(contract) ?? 0) >= DAY_MS)
    .sort((left, right) => (at(left) ?? 0) - (at(right) ?? 0))
    .slice(0, budget);
}

const failures = new Map<string, number>();
function noteFailure(stage: string, error: unknown) {
  const reason = `${stage}: ${String(error).slice(0, 80)}`;
  failures.set(reason, (failures.get(reason) ?? 0) + 1);
}

const now = Date.now();
const [pricesText, poolsText] = await Promise.all([get(PRICES_URL).then((r) => r.text()), get(POOLS_URL).then((r) => r.text())]);
const prices = JSON.parse(pricesText) as NearPriceList;
const depth = poolDepth(parseRefPools(poolsText), prices);
const graded = rateNearTokens(prices, depth);

const backed = graded.rows.filter((row) => row[3] > 0).map((row) => row[0]);
const loudest = graded.rows
  .filter((row) => row[3] === 0)
  .sort((left, right) => right[2] - left[2])
  .slice(0, LOUDEST_CLAIMS)
  .map((row) => row[0]);
const gradedAtLeastD = backed.filter((contract) => tokenGradeFor(Math.round(depth.get(contract) ?? 0)) !== "F");

const previous: Record<string, CachedStats> = existsSync(STATS_FILE) ? JSON.parse(readFileSync(STATS_FILE, "utf8")) : {};
const cache = new Map<string, CachedStats>([...backed, ...loudest].map((contract) => [contract, previous[contract] ?? {}]));
const entry = (contract: string) => cache.get(contract) as CachedStats;

// One lookup at a time: the public endpoints answer 429 to bursts.
for (const contract of stalest([...backed, ...loudest], (c) => entry(c).supplyAt, BUDGET.supply, now)) {
  try {
    Object.assign(entry(contract), { supply: await totalSupply(contract), supplyAt: now });
  } catch (error) {
    noteFailure("supply", error);
  }
}
for (const contract of stalest(backed, (c) => entry(c).top10At, BUDGET.topHolders, now)) {
  const { supply } = entry(contract);
  if (!supply) continue;
  try {
    Object.assign(entry(contract), { top10Pct: top10Share(contract, await topHolders(contract), supply), top10At: now });
  } catch (error) {
    noteFailure("top holders", error);
  }
}
for (const contract of stalest(gradedAtLeastD, (c) => entry(c).holdersAt, BUDGET.holderCount, now)) {
  try {
    Object.assign(entry(contract), { holders: await holderCount(contract), holdersAt: now });
  } catch (error) {
    noteFailure("holder count", error);
  }
  await sleep(1_500);
}

const stats = new Map<string, TokenStats>();
for (const [contract, cached] of cache) {
  const price = prices[contract];
  stats.set(contract, {
    fdvUsd: cached.supply && price ? marketCapUsd(cached.supply, price.decimal, Number(price.price)) : null,
    top10Pct: cached.top10Pct ?? null,
    holders: cached.holders ?? null,
  });
}

// Seal the edition: archive the exact Ref Finance responses and record their hashes and the code
// commit, so anyone can recompute every grade (scripts/verify-index.ts).
const code = { repository: "https://github.com/noobshole/svalin-agent", commit: process.env.SVALIN_COMMIT ?? "local" };
const index = nearTokenIndexSchema.parse({
  ...rateNearTokens(prices, depth, stats),
  provenance: { code, inputs: { pricesSha256: sha256Hex(pricesText), poolsSha256: sha256Hex(poolsText) } },
});
const indexText = JSON.stringify(index);
mkdirSync(resolve(DATA_DIR, "inputs"), { recursive: true });
writeFileSync(resolve(DATA_DIR, "inputs/prices.json.gz"), gzipSync(pricesText));
writeFileSync(resolve(DATA_DIR, "inputs/pools.json.gz"), gzipSync(poolsText));
writeFileSync(resolve(DATA_DIR, "near-token-index.json"), indexText);
const edition = sealEdition({
  generatedAt: index.generatedAt,
  methodology: index.methodology,
  code,
  files: {
    prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(pricesText) },
    pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(poolsText) },
    index: { path: "near-token-index.json", sha256: sha256Hex(indexText) },
  },
});
writeFileSync(resolve(DATA_DIR, "edition.json"), `${JSON.stringify(edition, null, 2)}\n`);
writeFileSync(STATS_FILE, JSON.stringify(Object.fromEntries(cache)));
console.log(
  JSON.stringify({
    msg: "near_index_built",
    tokens: index.rows.length,
    counts: index.counts,
    withMarketCap: index.rows.filter((row) => row[5] !== null).length,
    withTop10: index.rows.filter((row) => row[6] !== null).length,
    withHolders: index.rows.filter((row) => row[7] !== null).length,
    fingerprint: edition.fingerprint,
    seconds: Math.round((Date.now() - now) / 1000),
    failures: Object.fromEntries(failures),
  }),
);
