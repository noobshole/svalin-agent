/**
 * Builds the Svalin Index for NEAR tokens: grades from Ref Finance's prices, classic pools and
 * concentrated-liquidity (DCL) pools, plus market cap, top-10 holder share and holder count for
 * tokens with real backing. Runs on a schedule (.github/workflows/build.yml in the svalin-index
 * repository) and locally:
 *
 *   pnpm --filter @svalin-agent/api run index:near [data-dir]
 *
 * Supply and holder data barely move, and the public NEAR APIs rate limit bursts, so they are kept
 * in data-dir/near-token-stats.json and each token is refreshed about once a day, a few per run.
 * The backing history behind the 24-hour hold is read back from the previous edition's archive.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { nearTokenIndexSchema, tokenGradeFor, trackRecordSchema, type RatedTokenRow } from "@svalin-agent/shared";

import { editionAnomaly } from "../src/ratings/edition-guard.js";
import { sealEdition, sha256Hex } from "../src/ratings/edition.js";
import {
  heldDepth,
  marketCapUsd,
  rateNearTokens,
  recordBacking,
  top10Share,
  type BackingHistory,
  type TokenStats,
} from "../src/ratings/near-tokens.js";
import { gradeMigration } from "../src/ratings/track-record.js";
import { parseRefPools, poolDepth, type NearPriceList, type RefDclPool } from "../src/sources/near-source.js";

const PRICES_URL = process.env.NEAR_PRICE_API_URL ?? "https://indexer.ref.finance/list-token-price";
const POOLS_URL = process.env.NEAR_POOLS_API_URL ?? "https://indexer.ref.finance/list-top-pools";
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";
const FASTNEAR_URL = process.env.FASTNEAR_API_URL ?? "https://api.fastnear.com";
const NEARBLOCKS_URL = process.env.NEARBLOCKS_API_URL ?? "https://api.nearblocks.io";
const DCL_CONTRACT = process.env.NEAR_DCL_CONTRACT ?? "dclv2.ref-labs.near";
const DATA_DIR = resolve(process.argv[2] ?? "index-out");
const STATS_FILE = resolve(DATA_DIR, "near-token-stats.json");
const HISTORY_FILE = resolve(DATA_DIR, "inputs/history.json.gz");
/** Sealed daily editions, compared with this one for the track record. */
const SEALED_URL = process.env.NEAR_INDEX_SEALED_URL ?? "https://raw.githubusercontent.com/noobshole/svalin-index/main/editions";
const TRACK_WINDOWS = [1, 7, 30];

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

async function viewCall<T>(contract: string, method: string, args: unknown): Promise<T> {
  const response = await get(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "svalin-index",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = (await response.json()) as { result?: { result?: number[] } };
  if (!body.result?.result) throw new Error(`no result from ${contract}.${method}`);
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
}

async function totalSupply(contract: string): Promise<string> {
  return viewCall<string>(contract, "ft_total_supply", {});
}

/** Every DCL pool, paged from the contract, keeping only the fields the grades use. */
async function dclPools(): Promise<RefDclPool[]> {
  const pools: RefDclPool[] = [];
  for (let from = 0; ; from += 100) {
    const page = await viewCall<RefDclPool[]>(DCL_CONTRACT, "list_pools", { from_index: from, limit: 100 });
    for (const { token_x, token_y, total_x, total_y, state } of page) pools.push({ token_x, token_y, total_x, total_y, state });
    if (page.length < 100) return pools;
  }
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
const dcl = await dclPools();
const dclText = JSON.stringify(dcl);
const prices = JSON.parse(pricesText) as NearPriceList;
const current = poolDepth(parseRefPools(poolsText), prices, dcl);

// Grade only backing that has held for 24 hours (see heldDepth). The first v1 edition has no
// history yet: tokens that had backing in the previous edition count as established, and backing
// that is new in this one (for example from DCL pools only) waits its 24 hours like any other.
function seedHistory(): BackingHistory | null {
  const previousIndex = resolve(DATA_DIR, "near-token-index.json");
  if (!existsSync(previousIndex)) return null;
  const rows = (JSON.parse(readFileSync(previousIndex, "utf8")) as { rows?: RatedTokenRow[] }).rows ?? [];
  return Object.fromEntries(rows.filter((row) => row[3] > 0).map((row) => [row[0], { since: 0, points: [] }]));
}
const previousHistory = existsSync(HISTORY_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(HISTORY_FILE)).toString("utf8")) as BackingHistory)
  : seedHistory();
const history = recordBacking(previousHistory, current, now);
const historyText = JSON.stringify(history);
const depth = heldDepth(history, now);
const graded = rateNearTokens(prices, depth, new Map(), new Date(now));

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
  ...rateNearTokens(prices, depth, stats, new Date(now)),
  provenance: { code, inputs: { pricesSha256: sha256Hex(pricesText), poolsSha256: sha256Hex(poolsText) } },
});
// The circuit breaker (src/ratings/edition-guard.ts): an edition that looks broken is refused before
// anything is written, so the previous one stays published and the failed run alerts the owner.
// After checking the inputs by hand, NEAR_INDEX_ACCEPT_ANOMALY=1 publishes it anyway.
const previousIndexFile = resolve(DATA_DIR, "near-token-index.json");
if (existsSync(previousIndexFile) && process.env.NEAR_INDEX_ACCEPT_ANOMALY !== "1") {
  const anomaly = editionAnomaly(nearTokenIndexSchema.parse(JSON.parse(readFileSync(previousIndexFile, "utf8"))), index);
  if (anomaly) {
    console.error(JSON.stringify({ level: "error", msg: "edition_refused", anomaly }));
    process.exit(2);
  }
}

const indexText = JSON.stringify(index);
mkdirSync(resolve(DATA_DIR, "inputs"), { recursive: true });
writeFileSync(resolve(DATA_DIR, "inputs/prices.json.gz"), gzipSync(pricesText));
writeFileSync(resolve(DATA_DIR, "inputs/pools.json.gz"), gzipSync(poolsText));
writeFileSync(resolve(DATA_DIR, "inputs/dcl-pools.json.gz"), gzipSync(dclText));
writeFileSync(HISTORY_FILE, gzipSync(historyText));
writeFileSync(resolve(DATA_DIR, "near-token-index.json"), indexText);

// What the live API adds to the classic pools when valuing tokens: it cannot page the DCL contract
// inside a request, so it reads each token's DCL depth from here.
const dclDepth = Object.fromEntries(
  [...poolDepth([], prices, dcl)].map(([contract, usd]) => [contract, Math.round(usd)] as const).filter(([, usd]) => usd > 0),
);
writeFileSync(resolve(DATA_DIR, "near-dcl-depth.json"), JSON.stringify({ generatedAt: index.generatedAt, depth: dclDepth }));

const edition = sealEdition({
  generatedAt: index.generatedAt,
  methodology: index.methodology,
  code,
  files: {
    prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(pricesText) },
    pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(poolsText) },
    index: { path: "near-token-index.json", sha256: sha256Hex(indexText) },
    dclPools: { path: "inputs/dcl-pools.json.gz", sha256: sha256Hex(dclText) },
    history: { path: "inputs/history.json.gz", sha256: sha256Hex(historyText) },
  },
});
writeFileSync(resolve(DATA_DIR, "edition.json"), `${JSON.stringify(edition, null, 2)}\n`);
writeFileSync(STATS_FILE, JSON.stringify(Object.fromEntries(cache)));

// The track record: how grades moved since the editions sealed 1, 7 and 30 days ago. Only editions
// graded by the same methodology are compared, and a sealed edition that cannot be read skips its
// window rather than holding up this one.
const windows = [];
for (const days of TRACK_WINDOWS) {
  const sealedDay = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  try {
    const response = await fetch(`${SEALED_URL}/${sealedDay}/near-token-index.json`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) continue;
    const baseline = nearTokenIndexSchema.parse(await response.json());
    if (baseline.methodology === index.methodology) windows.push(gradeMigration(baseline, index, days, sealedDay));
  } catch {
    failures.set("track-record", (failures.get("track-record") ?? 0) + 1);
  }
}
const trackRecord = trackRecordSchema.parse({ generatedAt: index.generatedAt, methodology: index.methodology, windows });
writeFileSync(resolve(DATA_DIR, "near-track-record.json"), JSON.stringify(trackRecord));
console.log(
  JSON.stringify({
    msg: "near_index_built",
    tokens: index.rows.length,
    counts: index.counts,
    dclPools: dcl.length,
    holding: Object.values(history).filter(({ since }) => now - since < 24 * 60 * 60 * 1000).length,
    withMarketCap: index.rows.filter((row) => row[5] !== null).length,
    withTop10: index.rows.filter((row) => row[6] !== null).length,
    withHolders: index.rows.filter((row) => row[7] !== null).length,
    fingerprint: edition.fingerprint,
    trackRecordWindows: windows.map((window) => window.days),
    seconds: Math.round((Date.now() - now) / 1000),
    failures: Object.fromEntries(failures),
  }),
);
