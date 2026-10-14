import { NEAR_NATIVE_TOKEN, WNEAR_TOKEN, categoriseToken, lookupToken } from "@svalin-agent/chain-config";
import { isNearAccountId, portfolioOverviewSchema, type ChainFamily, type PortfolioOverview } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
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

/** NEAR delegated to a validator staking pool, in yoctoNEAR. */
export type NearPoolStake = { poolId: string; yocto: bigint };

const NEAR_DECIMALS = 24;
const MAX_POOLS = 10;

type FetchLike = typeof fetch;

export type NearSourceOptions = {
  /** FastNEAR API base URL, e.g. https://api.fastnear.com */
  apiUrl: string;
  /** NEAR JSON-RPC URL, used to read staking-pool balances. */
  rpcUrl: string;
  /** Ref Finance token price list URL. */
  priceUrl: string;
};

export class NearPortfolioSource implements PortfolioSource {
  private prices: { at: number; data: Promise<NearPriceList> } | undefined;

  constructor(
    private readonly options: NearSourceOptions,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 10_000,
    private readonly priceTtlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  supports(family: ChainFamily) {
    return family === "near";
  }

  async getOverview(wallet: string): Promise<PortfolioOverview> {
    const [account, prices] = await Promise.all([this.account(wallet), this.priceList()]);
    if (!account.state) {
      throw new ApiError(404, "account_not_found", "This NEAR account does not exist.");
    }
    const stakes = await this.poolStakes(wallet, (account.pools ?? []).slice(0, MAX_POOLS));
    return mapNearToOverview(wallet, account, prices, stakes);
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

/** Pure mapping, exported for tests. */
export function mapNearToOverview(
  wallet: string,
  account: FastNearAccount,
  prices: NearPriceList,
  stakes: NearPoolStake[],
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
    const symbol = known?.symbol ?? clean(entry.symbol) ?? `${token.contract_id.slice(0, 6)}…`;
    drafts.push({
      chain: "near",
      tokenAddress: token.contract_id,
      symbol,
      name: symbol,
      balance: formatUnits(raw, entry.decimal),
      priceUsd: price,
      valueUsd: toAmount(raw, entry.decimal) * price,
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
