/**
 * Builds the Svalin Index for NEAR tokens: grades from Rhea Finance's prices, classic pools and
 * concentrated-liquidity (DCL) pools, plus market cap, top-10 holder share and holder count for
 * tokens with real backing, and the daily file behind the ratings page's small charts. Runs on a
 * schedule (.github/workflows/build.yml in the svalin-index repository) and locally:
 *
 *   pnpm --filter @svalin-agent/api run index:near [data-dir]
 *
 * Supply, holder and metadata lookups barely move, and the public NEAR APIs rate limit bursts, so
 * they are kept in data-dir/near-token-stats.json and refreshed a few per run: tokens graded D or
 * better first, so their figures are at most about a day old (holder counts, which NearBlocks
 * limits to a few calls a minute, about two days), then the ~3,000 others in rotation.
 * The backing history behind the 24-hour hold is read back from the previous edition's archive.
 *
 * NEAR_INDEX_METHODOLOGY=near-token-backing-v2 builds the v2 trial instead: every Rhea pool read from
 * NEAR at one final block (recorded in the edition), each grade change since the previous sealed
 * edition given a reason, and NEAR Intents' quotes written beside the grades. During the trial the
 * robot builds both, and v2 reuses v1's market data (its lookup budgets are set to 0).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { lookupToken } from "@svalin-agent/chain-config";
import {
  TOKEN_DAILY_DAYS,
  indexEditionSchema,
  nearTokenIndexSchema,
  tokenDailySchema,
  tokenGradeFor,
  trackRecordSchema,
  type GradeChanges,
  type NearBlock,
  type RatedTokenRow,
  type TokenDaily,
} from "@svalin-agent/shared";

import { recordDetail, type BackingDetail } from "../src/ratings/backing-detail.js";
import { NEAR_RPC_FALLBACKS, NearRpc, readChainDclPools, readChainPools } from "../src/ratings/chain-pools.js";
import { addToDaily } from "../src/ratings/daily.js";
import { editionAnomaly } from "../src/ratings/edition-guard.js";
import { sealEdition, sha256Hex } from "../src/ratings/edition.js";
import { gradeChanges, type ComparedEdition } from "../src/ratings/grade-changes.js";
import { intentsQuotes } from "../src/ratings/intents-quotes.js";
import { editionTree, treeBytes, treeRoot } from "../src/ratings/merkle.js";
import {
  NEAR_TOKEN_METHODOLOGIES,
  NEAR_TOKEN_METHODOLOGY,
  NEAR_TOKEN_METHODOLOGY_V2,
  heldDepth,
  holdersFromTop,
  marketCapUsd,
  mergeHolderCounts,
  nearBlocksHolderCount,
  rateNearTokens,
  recordBacking,
  top10Share,
  type BackingHistory,
  type TokenStats,
} from "../src/ratings/near-tokens.js";
import { gradeMigration } from "../src/ratings/track-record.js";
import { parseRefPools, poolBackingAmounts, poolDepth, type NearPriceList, type RefDclPool } from "../src/sources/near-source.js";

// Rhea Finance, formerly Ref Finance. Its old indexer.ref.finance host still answers, but its pool
// list stopped taking in new pools (2,465 against Rhea's 3,175 on 26 November 2026).
const PRICES_URL = process.env.NEAR_PRICE_API_URL ?? "https://api.rhea.finance/list-token-price";
const POOLS_URL = process.env.NEAR_POOLS_API_URL ?? "https://api.rhea.finance/list-top-pools";
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";
const FASTNEAR_URL = process.env.FASTNEAR_API_URL ?? "https://api.fastnear.com";
const NEARBLOCKS_URL = process.env.NEARBLOCKS_API_URL ?? "https://api.nearblocks.io";
const DCL_CONTRACT = process.env.NEAR_DCL_CONTRACT ?? "dclv2.ref-labs.near";
const DATA_DIR = resolve(process.argv[2] ?? "index-out");
const STATS_FILE = resolve(DATA_DIR, "near-token-stats.json");
const HISTORY_FILE = resolve(DATA_DIR, "inputs/history.json.gz");
/** v2: the trusted tokens behind every history point and each run's prices, for exact grade-change reasons. */
const DETAIL_FILE = resolve(DATA_DIR, "inputs/backing-detail.json.gz");
/** One point a day per token for the ratings page's charts; not part of the sealed edition. */
const DAILY_FILE = resolve(DATA_DIR, "near-token-daily.json");
/** Sealed daily editions: compared with this one for the track record, and the daily file's first fill. */
const SEALED_URL = process.env.NEAR_INDEX_SEALED_URL ?? "https://raw.githubusercontent.com/noobshole/svalin-index/main/editions";
const TRACK_WINDOWS = [1, 7, 30];

const METHODOLOGY = process.env.NEAR_INDEX_METHODOLOGY ?? NEAR_TOKEN_METHODOLOGY;
if (!NEAR_TOKEN_METHODOLOGIES.includes(METHODOLOGY)) throw new Error(`unknown methodology ${METHODOLOGY}`);
const V2 = METHODOLOGY === NEAR_TOKEN_METHODOLOGY_V2;
/** v2: sealed editions of the methodology before it, compared with when its own record has none yet. */
const PREVIOUS_METHOD_URL = process.env.NEAR_INDEX_PREVIOUS_METHOD_URL;
/** v2: the data directory of the methodology before it, whose backing history v2 starts from on its first run. */
const SEED_FROM = process.env.NEAR_INDEX_SEED_FROM;
/** How far back to look for the sealed edition a v2 edition's grade changes are measured from. */
const CHANGES_LOOKBACK_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Zero-backing tokens with the highest quoted prices also get a market cap: the loudest claims. */
const LOUDEST_CLAIMS = 25;
/**
 * Lookups per run. GitHub runs the hourly schedule only every few hours, so with ~3,000 backed
 * tokens a full rotation takes about ten days; the ~85 graded D or better go first every day.
 */
const BUDGET = {
  supply: Number(process.env.INDEX_SUPPLY_BUDGET ?? 60),
  topHolders: Number(process.env.INDEX_TOP_HOLDERS_BUDGET ?? 60),
  holderCount: Number(process.env.INDEX_HOLDER_COUNT_BUDGET ?? 12),
  metadata: Number(process.env.INDEX_METADATA_BUDGET ?? 60),
};
/** NearBlocks' free API answers 429 to more than a few calls a minute, so holder counts are spaced out. */
const NEARBLOCKS_SPACING_MS = 10_000;
/** Token metadata rarely changes: read again after a week. */
const METADATA_MAX_AGE_MS = 7 * DAY_MS;

/** What is remembered between runs for each token, with when it was last fetched. */
type CachedStats = {
  supply?: string;
  supplyAt?: number;
  top10Pct?: number | null;
  /** From the same FastNEAR list as the top-10 share: holders in it, a lower bound on all holders. */
  listedHolders?: number | null;
  top10At?: number;
  /** NearBlocks' count; null when it could not say (the token is not in its list, or counted 0). */
  holders?: number | null;
  /** NearBlocks capped the count ("10000+"), so it is a lower bound. */
  holdersCapped?: true;
  holdersAt?: number;
  symbol?: string | null;
  name?: string | null;
  metadataAt?: number;
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

/** The token's own symbol and name (NEP-148). Kept as plain strings; rateNearTokens cleans them. */
async function metadata(contract: string): Promise<{ symbol: string | null; name: string | null }> {
  const meta = await viewCall<{ symbol?: unknown; name?: unknown }>(contract, "ft_metadata", {});
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : null);
  return { symbol: text(meta?.symbol), name: text(meta?.name) };
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

/** NearBlocks' holder count, from its v3 token list (see nearBlocksHolderCount). */
async function nearBlocksHolders(contract: string) {
  const response = await get(`${NEARBLOCKS_URL}/v3/fts?search=${encodeURIComponent(contract)}&limit=25`);
  return nearBlocksHolderCount(await response.json(), contract);
}

/**
 * The `budget` entries due for a refresh (fetched longer than `maxAge` ago, or never): those in
 * `first` before the rest, and the oldest first within each.
 */
function stalest(
  contracts: string[],
  at: (contract: string) => number | undefined,
  budget: number,
  now: number,
  first: ReadonlySet<string>,
  maxAge = DAY_MS,
) {
  return contracts
    .filter((contract) => now - (at(contract) ?? 0) >= maxAge)
    .sort((left, right) => Number(first.has(right)) - Number(first.has(left)) || (at(left) ?? 0) - (at(right) ?? 0))
    .slice(0, budget);
}

const failures = new Map<string, number>();
function noteFailure(stage: string, error: unknown) {
  const reason = `${stage}: ${String(error).slice(0, 80)}`;
  failures.set(reason, (failures.get(reason) ?? 0) + 1);
}

const now = Date.now();
// v1 reads Rhea's list of top pools and the DCL pools as they are now. v2 reads every pool on both
// contracts at one final block, so the edition says exactly which chain state it graded.
let block: NearBlock | undefined;
let pricesText: string;
let poolsText: string;
let dcl: RefDclPool[];
let poolsRead = 0;
if (V2) {
  // If the main endpoint keeps refusing, the same block is read from the next one.
  const rpc = new NearRpc([RPC_URL, ...NEAR_RPC_FALLBACKS]);
  const pinned = await rpc.finalBlock();
  block = pinned;
  [pricesText, poolsText, dcl] = await Promise.all([
    get(PRICES_URL).then((r) => r.text()),
    readChainPools(rpc, pinned.height).then((pools) => {
      poolsRead = pools.length;
      return JSON.stringify(pools);
    }),
    readChainDclPools(rpc, pinned.height),
  ]);
} else {
  [pricesText, poolsText] = await Promise.all([get(PRICES_URL).then((r) => r.text()), get(POOLS_URL).then((r) => r.text())]);
  dcl = await dclPools();
}
const dclText = JSON.stringify(dcl);
const prices = JSON.parse(pricesText) as NearPriceList;
const parsedPools = parseRefPools(poolsText);
const current = poolDepth(parsedPools, prices, dcl);

// Grade only backing that has held for 24 hours (see heldDepth). The first edition of a methodology
// has no history of its own yet. v2's first run starts from v1's (NEAR_INDEX_SEED_FROM): its tokens
// keep their 24 hours of v1 backing, so a day-one grade comes from the lowest of v1's backing and
// v2's own, and backing new in v2 (from pools only v2 reads) waits its 24 hours like any other.
// Without such a history, tokens that had backing in the previous index count as established.
const readGz = (file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as unknown;
function seedHistory(): BackingHistory | null {
  if (SEED_FROM) {
    const seed = resolve(SEED_FROM, "inputs/history.json.gz");
    if (!existsSync(seed)) throw new Error(`NEAR_INDEX_SEED_FROM has no backing history at ${seed}`);
    return readGz(seed) as BackingHistory;
  }
  const ownPrevious = resolve(DATA_DIR, "near-token-index.json");
  if (!existsSync(ownPrevious)) return null;
  const rows = (JSON.parse(readFileSync(ownPrevious, "utf8")) as { rows?: RatedTokenRow[] }).rows ?? [];
  return Object.fromEntries(rows.filter((row) => row[3] > 0).map((row) => [row[0], { since: 0, points: [] }]));
}
const previousHistory = existsSync(HISTORY_FILE) ? (readGz(HISTORY_FILE) as BackingHistory) : seedHistory();
const history = recordBacking(previousHistory, current, now);
const historyText = JSON.stringify(history);
const depth = heldDepth(history, now);
// v2: what backs each token, in trusted tokens, at every point of the history, and each run's
// prices, so a grade change can be split into price and money exactly.
const detail = V2
  ? recordDetail(existsSync(DETAIL_FILE) ? (readGz(DETAIL_FILE) as BackingDetail) : null, history, poolBackingAmounts(parsedPools, prices, dcl), prices, now)
  : undefined;
const detailText = detail ? JSON.stringify(detail) : undefined;
const graded = rateNearTokens(prices, depth, new Map(), new Date(now), METHODOLOGY);

const backed = graded.rows.filter((row) => row[3] > 0).map((row) => row[0]);
const loudest = graded.rows
  .filter((row) => row[3] === 0)
  .sort((left, right) => right[2] - left[2])
  .slice(0, LOUDEST_CLAIMS)
  .map((row) => row[0]);
const gradedAtLeastD = backed.filter((contract) => tokenGradeFor(Math.round(depth.get(contract) ?? 0)) !== "F");
const gradedFirst: ReadonlySet<string> = new Set(gradedAtLeastD);

const previous: Record<string, CachedStats> = existsSync(STATS_FILE) ? JSON.parse(readFileSync(STATS_FILE, "utf8")) : {};
const cache = new Map<string, CachedStats>([...backed, ...loudest].map((contract) => [contract, previous[contract] ?? {}]));
const entry = (contract: string) => cache.get(contract) as CachedStats;

// One lookup at a time: the public endpoints answer 429 to bursts.
for (const contract of stalest([...backed, ...loudest], (c) => entry(c).metadataAt, BUDGET.metadata, now, gradedFirst, METADATA_MAX_AGE_MS)) {
  try {
    Object.assign(entry(contract), { ...(await metadata(contract)), metadataAt: now });
  } catch (error) {
    noteFailure("metadata", error);
  }
}
for (const contract of stalest([...backed, ...loudest], (c) => entry(c).supplyAt, BUDGET.supply, now, gradedFirst)) {
  try {
    Object.assign(entry(contract), { supply: await totalSupply(contract), supplyAt: now });
  } catch (error) {
    noteFailure("supply", error);
  }
}
for (const contract of stalest(backed, (c) => entry(c).top10At, BUDGET.topHolders, now, gradedFirst)) {
  const { supply } = entry(contract);
  if (!supply) continue;
  try {
    const holders = await topHolders(contract);
    Object.assign(entry(contract), { top10Pct: top10Share(contract, holders, supply), listedHolders: holdersFromTop(holders), top10At: now });
  } catch (error) {
    noteFailure("top holders", error);
  }
}
for (const [at, contract] of stalest(gradedAtLeastD, (c) => entry(c).holdersAt, BUDGET.holderCount, now, gradedFirst).entries()) {
  if (at > 0) await sleep(NEARBLOCKS_SPACING_MS);
  try {
    const count = await nearBlocksHolders(contract);
    Object.assign(entry(contract), { holders: count?.holders ?? null, holdersCapped: count?.atLeast || undefined, holdersAt: now });
  } catch (error) {
    noteFailure("holder count", error);
  }
}

const stats = new Map<string, TokenStats>();
for (const [contract, cached] of cache) {
  const price = prices[contract];
  // Counts cached before 4 Nov 2026 stored NearBlocks' 0 as a fact; it means unknown.
  const { holders, atLeast } = mergeHolderCounts(cached.holders, cached.listedHolders, cached.holdersCapped);
  stats.set(contract, {
    fdvUsd: cached.supply && price ? marketCapUsd(cached.supply, price.decimal, Number(price.price)) : null,
    top10Pct: cached.top10Pct ?? null,
    holders,
    holdersAtLeast: atLeast,
    symbol: cached.symbol ?? null,
    name: cached.name ?? null,
  });
}

// Seal the edition: archive the exact Rhea Finance responses and record their hashes and the code
// commit, so anyone can recompute every grade (scripts/verify-index.ts).
const code = { repository: "https://github.com/noobshole/svalin-agent", commit: process.env.SVALIN_COMMIT ?? "local" };
const rated = rateNearTokens(prices, depth, stats, new Date(now), METHODOLOGY);

/**
 * A sealed edition from `base` (<base>/<day>/...): its record, index and prices, and its history and
 * backing detail when it has them, each checked against its hash. Null when the day has no sealed
 * edition; one with a file missing or altered throws, and the search goes on to the day before.
 */
async function comparedEdition(base: string, sealedDay: string): Promise<ComparedEdition | null> {
  const fetchOk = (path: string) => fetch(`${base}/${sealedDay}/${path}`, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r : null));
  const record = await fetchOk("edition.json");
  if (!record) return null;
  const edition = indexEditionSchema.parse(await record.json());
  if (edition.generatedAt.slice(0, 10) !== sealedDay) throw new Error(`sealed edition ${sealedDay} is dated ${edition.generatedAt}`);
  /** A file the record lists, as text: plain or gzipped, as archived. */
  const read = async (file: { path: string; sha256: string }) => {
    const response = await fetchOk(file.path);
    if (!response) throw new Error(`sealed edition ${sealedDay} has no ${file.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = file.path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
    if (sha256Hex(text) !== file.sha256) throw new Error(`sealed edition ${sealedDay}: ${file.path} does not match its record`);
    return text;
  };
  const { files } = edition;
  const [indexBody, pricesBody, historyBody, detailBody] = await Promise.all([
    read(files.index),
    read(files.prices),
    files.history && files.backingDetail ? read(files.history) : undefined,
    files.history && files.backingDetail ? read(files.backingDetail) : undefined,
  ]);
  return {
    day: sealedDay,
    generatedAt: edition.generatedAt,
    fingerprint: edition.fingerprint,
    methodology: edition.methodology,
    index: nearTokenIndexSchema.parse(JSON.parse(indexBody)),
    prices: JSON.parse(pricesBody) as NearPriceList,
    ...(historyBody && detailBody ? { history: JSON.parse(historyBody) as BackingHistory, detail: JSON.parse(detailBody) as BackingDetail } : {}),
  };
}

// v2: every grade change since the latest sealed edition before today, with its reason. Until v2
// has a sealed edition of its own, it is compared with v1's, and every change reads "method".
async function changesSinceSealed(): Promise<GradeChanges | undefined> {
  for (const base of [SEALED_URL, PREVIOUS_METHOD_URL]) {
    if (!base) continue;
    for (let back = 1; back <= CHANGES_LOOKBACK_DAYS; back += 1) {
      try {
        const compared = await comparedEdition(base, new Date(now - back * DAY_MS).toISOString().slice(0, 10));
        if (compared) return gradeChanges(compared, { index: rated, prices, pools: parsedPools, dclPools: dcl, history, detail });
      } catch (error) {
        noteFailure("grade changes", error);
      }
    }
  }
  return undefined;
}
const changes = V2 ? await changesSinceSealed() : undefined;

const index = nearTokenIndexSchema.parse({
  ...rated,
  provenance: { code, inputs: { pricesSha256: sha256Hex(pricesText), poolsSha256: sha256Hex(poolsText) }, ...(block ? { block } : {}) },
  ...(changes ? { changes } : {}),
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
if (detailText) writeFileSync(DETAIL_FILE, gzipSync(detailText));
writeFileSync(resolve(DATA_DIR, "near-token-index.json"), indexText);

// The edition's Merkle tree, as the Svalin Ratings registry on NEAR reads it: the API serves proofs
// from this file, and its root goes on-chain when the day's edition is sealed (register-root.ts).
const day = index.generatedAt.slice(0, 10);
const tree = editionTree(day, index.rows);
writeFileSync(resolve(DATA_DIR, "near-token-tree.bin"), treeBytes(tree));

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
    ...(detailText ? { backingDetail: { path: "inputs/backing-detail.json.gz", sha256: sha256Hex(detailText) } } : {}),
  },
  ...(block ? { block } : {}),
});
writeFileSync(resolve(DATA_DIR, "edition.json"), `${JSON.stringify(edition, null, 2)}\n`);
// The registry's `publish` arguments for this edition.
const rootArgs = {
  day,
  root: treeRoot(tree),
  fingerprint: edition.fingerprint,
  index_sha256: sha256Hex(indexText),
  methodology: index.methodology,
  tokens: index.rows.length,
};
writeFileSync(resolve(DATA_DIR, "near-token-root.json"), `${JSON.stringify(rootArgs, null, 2)}\n`);
writeFileSync(STATS_FILE, JSON.stringify(Object.fromEntries(cache)));

/** A sealed daily edition from the record on main, or null when it cannot be read. */
async function sealedEdition(sealedDay: string) {
  const response = await fetch(`${SEALED_URL}/${sealedDay}/near-token-index.json`, { signal: AbortSignal.timeout(30_000) });
  return response.ok ? nearTokenIndexSchema.parse(await response.json()) : null;
}

/**
 * The registry tokens' rows for a sealed edition from before the Index graded them, worked out from
 * the inputs archived with it. For the daily file only: their backing is that edition's pool depth,
 * without the 24-hour low, which for these deep pools barely differs.
 */
async function registryRowsFromInputs(sealedDay: string): Promise<RatedTokenRow[]> {
  const read = async (name: string) => {
    const response = await fetch(`${SEALED_URL}/${sealedDay}/inputs/${name}.json.gz`, { signal: AbortSignal.timeout(30_000) });
    return response.ok ? gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8") : null;
  };
  const [sealedPrices, sealedPools, sealedDcl] = await Promise.all([read("prices"), read("pools"), read("dcl-pools")]);
  if (!sealedPrices || !sealedPools) return [];
  const quoted = JSON.parse(sealedPrices) as NearPriceList;
  const sealedDepth = poolDepth(parseRefPools(sealedPools), quoted, sealedDcl ? (JSON.parse(sealedDcl) as RefDclPool[]) : []);
  return rateNearTokens(quoted, sealedDepth).rows.filter((row) => lookupToken("near", row[0]));
}

// The daily file: this edition's prices and backing added to the last 30 days. Without one (the
// first run, or a file that no longer reads), it is filled from the sealed daily editions first.
function readDaily(): TokenDaily | null {
  if (!existsSync(DAILY_FILE)) return null;
  const parsed = tokenDailySchema.safeParse(JSON.parse(readFileSync(DAILY_FILE, "utf8")));
  return parsed.success ? parsed.data : null;
}
let daily = readDaily();
if (!daily) {
  for (let back = TOKEN_DAILY_DAYS - 1; back >= 1; back -= 1) {
    try {
      const sealedDay = new Date(now - back * DAY_MS).toISOString().slice(0, 10);
      const sealed = await sealedEdition(sealedDay);
      if (!sealed) continue;
      const gradesRegistry = sealed.rows.some((row) => lookupToken("near", row[0]));
      daily = addToDaily(daily, gradesRegistry ? sealed : { ...sealed, rows: [...sealed.rows, ...(await registryRowsFromInputs(sealedDay))] });
    } catch {
      failures.set("daily backfill", (failures.get("daily backfill") ?? 0) + 1);
    }
  }
}
daily = addToDaily(daily, index);
writeFileSync(DAILY_FILE, JSON.stringify(daily));

// The track record: how grades moved since the editions sealed 1, 7 and 30 days ago. Only editions
// graded by the same methodology are compared, and a sealed edition that cannot be read skips its
// window rather than holding up this one.
const windows = [];
for (const days of TRACK_WINDOWS) {
  const sealedDay = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  try {
    const baseline = await sealedEdition(sealedDay);
    if (baseline?.methodology === index.methodology) windows.push(gradeMigration(baseline, index, days, sealedDay));
  } catch {
    failures.set("track-record", (failures.get("track-record") ?? 0) + 1);
  }
}
const trackRecord = trackRecordSchema.parse({ generatedAt: index.generatedAt, methodology: index.methodology, windows });
writeFileSync(resolve(DATA_DIR, "near-track-record.json"), JSON.stringify(trackRecord));

// v2: NEAR Intents' quotes beside the grades, outside the sealed edition (quotes cannot be re-checked
// later). If 1Click cannot be read, the previous run's file stays, its times saying how old it is,
// and the edition goes ahead without new quotes.
let quotes: Awaited<ReturnType<typeof intentsQuotes>> | undefined;
if (V2 && process.env.NEAR_INDEX_INTENTS !== "0") {
  try {
    quotes = await intentsQuotes(index);
    writeFileSync(resolve(DATA_DIR, "near-intents-quotes.json"), JSON.stringify(quotes));
  } catch (error) {
    noteFailure("intents quotes", error);
  }
}
console.log(
  JSON.stringify({
    msg: "near_index_built",
    methodology: index.methodology,
    ...(block ? { block: block.height } : {}),
    ...(V2 ? { poolsRead } : {}),
    ...(changes ? { changesSince: changes.since, changes: Object.keys(changes.tokens).length } : {}),
    ...(quotes
      ? {
          intentsQuotes: Object.values(quotes.quotes).filter((quote) => quote.lossPct !== null).length,
          intentsDisagree: Object.values(quotes.quotes).filter((quote) => quote.disagrees).length,
        }
      : {}),
    tokens: index.rows.length,
    counts: index.counts,
    dclPools: dcl.length,
    holding: Object.values(history).filter(({ since }) => now - since < 24 * 60 * 60 * 1000).length,
    withMarketCap: index.rows.filter((row) => row[5] !== null).length,
    withTop10: index.rows.filter((row) => row[6] !== null).length,
    withHolders: index.rows.filter((row) => row[7] !== null).length,
    selfDeclaredTests: Object.values(index.notes ?? {}).filter((note) => note.selfDeclaredTest).length,
    fingerprint: edition.fingerprint,
    root: rootArgs.root,
    trackRecordWindows: windows.map((window) => window.days),
    dailyDays: daily.days.length,
    seconds: Math.round((Date.now() - now) / 1000),
    failures: Object.fromEntries(failures),
  }),
);
