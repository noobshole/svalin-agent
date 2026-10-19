import { NEAR_NATIVE_TOKEN, WNEAR_TOKEN, categoriseToken, knownTokens, lookupToken } from "@svalin-agent/chain-config";
import { isNearAccountId, portfolioOverviewSchema, type ChainFamily, type PortfolioOverview } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";
import { finaliseAssets, formatUnits, type PortfolioSource } from "./portfolio-source.js";

/** The subset of FastNEAR's `GET /v1/account/{id}/full` response Svalin relies on. */
export type FastNearAccount = {
  account_id: string;
  /** Null when the account does not exist. */
  state: { balance: string; locked?: string; storage_bytes?: number } | null;
  pools?: { pool_id: string }[];
  tokens?: { contract_id: string; balance: string }[];
};

/** Ref Finance `list-token-price`: token contract -> USD price, decimals and symbol. */
export type NearPriceList = Record<string, { price: string; decimal: number; symbol: string }>;

/** A Ref Finance liquidity pool: the tokens it holds and their raw amounts, in the same order. */
export type RefPool = { token_account_ids: string[]; amounts: string[] };

/** NEAR delegated to a validator staking pool, in yoctoNEAR. */
export type NearPoolStake = { poolId: string; yocto: bigint };

const NEAR_DECIMALS = 24;
const MAX_POOLS = 10;

/** Registry token contracts on NEAR. Only value held in these counts as pool depth. */
const REGISTRY_CONTRACTS = new Set(
  knownTokens.filter((token) => token.chain === "near" && token.address !== NEAR_NATIVE_TOKEN).map((token) => token.address),
);
const REGISTRY_QUOTED = [...REGISTRY_CONTRACTS].map((contract) => `"${contract}"`);
const POOL_FIELDS = /"token_account_ids":\s*(\[[^\]]*\]),\s*"amounts":\s*(\[[^\]]*\])/g;

type FetchLike = typeof fetch;

export type NearSourceOptions = {
  /** FastNEAR API base URL, e.g. https://api.fastnear.com */
  apiUrl: string;
  /** NEAR JSON-RPC URL, used to read staking-pool balances. */
  rpcUrl: string;
  /** Ref Finance token price list URL. */
  priceUrl: string;
  /** Ref Finance liquidity pool list URL, used to check what tokens outside the registry could sell for. */
  poolsUrl: string;
};

export class NearPortfolioSource implements PortfolioSource {
  private prices: { at: number; data: Promise<NearPriceList> } | undefined;
  private depth: { at: number; data: Promise<Map<string, number>> } | undefined;

  constructor(
    private readonly options: NearSourceOptions,
    private readonly fetchImpl: FetchLike = callFetch,
    private readonly timeoutMs = 10_000,
    private readonly priceTtlMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly poolsTtlMs = 5 * 60_000,
  ) {}

  supports(family: ChainFamily) {
    return family === "near";
  }

  async getOverview(wallet: string): Promise<PortfolioOverview> {
    const [account, prices] = await Promise.all([this.account(wallet), this.priceList()]);
    if (!account.state) {
      throw new ApiError(404, "account_not_found", "This NEAR account does not exist.");
    }
    const [stakes, depth] = await Promise.all([
      this.poolStakes(wallet, (account.pools ?? []).slice(0, MAX_POOLS)),
      holdsUnvettedTokens(account, prices) ? this.depthMap(prices) : new Map<string, number>(),
    ]);
    return mapNearToOverview(wallet, account, prices, stakes, depth);
  }

  private async account(wallet: string): Promise<FastNearAccount> {
    const response = await this.get(`${this.options.apiUrl}/v1/account/${encodeURIComponent(wallet)}/full`);
    return (await response.json()) as FastNearAccount;
  }

  /** One request prices every token; cached so most reports cost a single upstream call. */
  private priceList(): Promise<NearPriceList> {
    if (this.prices && this.now() - this.prices.at < this.priceTtlMs) return this.prices.data;
    const data = this.get(this.options.priceUrl).then((response) => response.json() as Promise<NearPriceList>);
    this.prices = { at: this.now(), data };
    data.catch(() => {
      if (this.prices?.data === data) this.prices = undefined;
    });
    return data;
  }

  /**
   * Pool depth per token. Ref's pool list is about 900 KB, so it is read only for accounts that
   * need it, priced once with the current price list, and the result is cached for five minutes.
   */
  private depthMap(prices: NearPriceList): Promise<Map<string, number>> {
    if (this.depth && this.now() - this.depth.at < this.poolsTtlMs) return this.depth.data;
    const data = this.get(this.options.poolsUrl)
      .then((response) => response.text())
      .then((text) => poolDepth(parseRefPools(text), prices));
    this.depth = { at: this.now(), data };
    data.catch(() => {
      if (this.depth?.data === data) this.depth = undefined;
    });
    return data;
  }

  /** Reads each staking pool's balance for the wallet. A pool that fails to answer is skipped. */
  private async poolStakes(wallet: string, pools: { pool_id: string }[]): Promise<NearPoolStake[]> {
    const results = await Promise.allSettled(
      pools.map(async ({ pool_id: poolId }) => ({ poolId, yocto: await this.poolBalance(poolId, wallet) })),
    );
    return results.flatMap((result) => (result.status === "fulfilled" && result.value.yocto > 0n ? [result.value] : []));
  }

  private async poolBalance(poolId: string, wallet: string): Promise<bigint> {
    const response = await this.fetchImpl(this.options.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "svalin",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: poolId,
          method_name: "get_account_total_balance",
          args_base64: Buffer.from(JSON.stringify({ account_id: wallet })).toString("base64"),
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await response.json()) as { result?: { result?: number[] } };
    const bytes = body.result?.result;
    if (!response.ok || !bytes) throw new Error(`pool ${poolId} unavailable`);
    return BigInt(JSON.parse(Buffer.from(bytes).toString("utf8")) as string);
  }

  private async get(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "NEAR data provider did not respond.");
    }
    if (response.status === 429) {
      throw new ApiError(503, "upstream_rate_limited", "NEAR data provider is rate limiting. Retry shortly.");
    }
    if (!response.ok) {
      throw new ApiError(502, "upstream_error", `NEAR data provider returned ${response.status}.`);
    }
    return response;
  }
}

/**
 * Pure mapping, exported for tests. `depth` comes from `poolDepth`: a token outside the registry
 * is valued at no more than its pools could pay out, and counts as unpriced if they hold nothing.
 */
export function mapNearToOverview(
  wallet: string,
  account: FastNearAccount,
  prices: NearPriceList,
  stakes: NearPoolStake[],
  depth: ReadonlyMap<string, number>,
  now: Date = new Date(),
): PortfolioOverview {
  const drafts: Parameters<typeof finaliseAssets>[0] = [];
  let unpricedAssetCount = 0;
  const nearPrice = priceOf(prices, WNEAR_TOKEN);

  const nativeYocto = toBigInt(account.state?.balance);
  if (nativeYocto > 0n) {
    drafts.push({
      chain: "near",
      tokenAddress: NEAR_NATIVE_TOKEN,
      symbol: "NEAR",
      name: "NEAR",
      balance: formatUnits(nativeYocto, NEAR_DECIMALS),
      priceUsd: nearPrice,
      valueUsd: nearPrice === null ? 0 : toAmount(nativeYocto, NEAR_DECIMALS) * nearPrice,
      category: "native",
    });
  }

  // NEAR delegated to a validator earns staking rewards like a liquid-staking token,
  // so it counts as staked rather than idle.
  for (const stake of stakes) {
    if (!isNearAccountId(stake.poolId)) continue;
    drafts.push({
      chain: "near",
      tokenAddress: stake.poolId,
      symbol: "NEAR",
      name: `Staked with ${stake.poolId}`.slice(0, 64),
      balance: formatUnits(stake.yocto, NEAR_DECIMALS),
      priceUsd: nearPrice,
      valueUsd: nearPrice === null ? 0 : toAmount(stake.yocto, NEAR_DECIMALS) * nearPrice,
      category: "liquid-staking",
    });
  }

  for (const token of account.tokens ?? []) {
    const raw = toBigInt(token.balance);
    if (raw <= 0n || !isNearAccountId(token.contract_id)) continue;

    const entry = prices[token.contract_id];
    const price = priceOf(prices, token.contract_id);
    if (!entry || price === null || !Number.isInteger(entry.decimal)) {
      unpricedAssetCount += 1;
      continue;
    }

    const known = lookupToken("near", token.contract_id);
    // Anyone can send an account a token whose quoted price is fake or stale, so a token outside
    // the registry is worth at most what its pools could pay out, and nothing without a pool.
    let valueUsd = toAmount(raw, entry.decimal) * price;
    if (!known) {
      const sellable = depth.get(token.contract_id) ?? 0;
      if (sellable <= 0) {
        unpricedAssetCount += 1;
        continue;
      }
      valueUsd = Math.min(valueUsd, sellable);
    }

    const symbol = known?.symbol ?? clean(entry.symbol) ?? `${token.contract_id.slice(0, 6)}…`;
    drafts.push({
      chain: "near",
      tokenAddress: token.contract_id,
      symbol,
      name: symbol,
      balance: formatUnits(raw, entry.decimal),
      priceUsd: price,
      valueUsd,
      category: categoriseToken("near", token.contract_id),
    });
  }

  const { assets, totalValueUsd } = finaliseAssets(drafts);

  return portfolioOverviewSchema.parse({
    wallet,
    chain: "near",
    totalValueUsd,
    assets,
    unpricedAssetCount,
    dataSource: "fastnear",
    refreshedAt: now.toISOString(),
  });
}

/**
 * For each token outside the registry, the USD value of registry tokens (wNEAR, stablecoins,
 * liquid staking and so on) in the pools it trades in: the most a sale of it could take out.
 * A token paired only with other unvetted tokens gets nothing, so fake liquidity does not count.
 */
export function poolDepth(pools: RefPool[], prices: NearPriceList): Map<string, number> {
  // USD per raw unit of each registry token, worked out once rather than per pool.
  const unitUsd = new Map<string, number>();
  for (const contract of REGISTRY_CONTRACTS) {
    const entry = prices[contract];
    const price = priceOf(prices, contract);
    if (entry && price !== null && Number.isInteger(entry.decimal)) unitUsd.set(contract, price / 10 ** entry.decimal);
  }

  const depth = new Map<string, number>();
  for (const { token_account_ids: ids, amounts } of pools) {
    if (!Array.isArray(ids) || !Array.isArray(amounts) || ids.length !== amounts.length) continue;

    let registryUsd = 0;
    for (let index = 0; index < ids.length; index += 1) {
      const usd = unitUsd.get(ids[index]);
      const amount = usd === undefined ? 0 : Number(amounts[index]);
      if (usd !== undefined && Number.isFinite(amount) && amount > 0) registryUsd += amount * usd;
    }
    if (registryUsd <= 0) continue;

    for (const id of ids) {
      if (!REGISTRY_CONTRACTS.has(id)) depth.set(id, (depth.get(id) ?? 0) + registryUsd);
    }
  }
  return depth;
}

/**
 * Reads Ref's pool list, keeping only pools that hold a registry token. It pulls the two needed
 * fields out of the text instead of parsing the whole document, which roughly halves the CPU time
 * (Cloudflare Workers allow 10 ms per request on the free plan). If the format ever changes so
 * that nothing matches, it falls back to a full parse.
 */
export function parseRefPools(text: string): RefPool[] {
  const pools: RefPool[] = [];
  let matched = false;
  for (const [, ids, amounts] of text.matchAll(POOL_FIELDS)) {
    matched = true;
    if (!REGISTRY_QUOTED.some((contract) => ids.includes(contract))) continue;
    try {
      pools.push({ token_account_ids: JSON.parse(ids) as string[], amounts: JSON.parse(amounts) as string[] });
    } catch {
      // A malformed pool is skipped; its tokens simply get no depth from it.
    }
  }
  if (matched) return pools;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(502, "upstream_error", "NEAR pool data could not be read.");
  }
  return Array.isArray(parsed) ? (parsed as RefPool[]) : [];
}

/** Whether the account holds a priced token outside the registry, which needs the pool check. */
function holdsUnvettedTokens(account: FastNearAccount, prices: NearPriceList): boolean {
  return (account.tokens ?? []).some(
    (token) => !lookupToken("near", token.contract_id) && priceOf(prices, token.contract_id) !== null && toBigInt(token.balance) > 0n,
  );
}

function priceOf(prices: NearPriceList, contract: string): number | null {
  const price = Number(prices[contract]?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function toBigInt(value: string | undefined): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

function toAmount(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 32) : undefined;
}
