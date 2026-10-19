import {
  portfolioOverviewSchema,
  type ChainFamily,
  type PortfolioOverview,
  type SupportedChainKey,
} from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";
import { TtlCache } from "../lib/ttl-cache.js";
import { finaliseAssets, type PortfolioSource } from "./portfolio-source.js";

/**
 * How much a sale of each token could take out of its trading pools, in USD: half of each pool's
 * liquidity, the side a seller is paid from. Zero means no pool was found.
 */
export interface MarketDepth {
  sellableUsd(chain: SupportedChainKey, tokens: string[]): Promise<Map<string, number>>;
}

/** Long-tail tokens checked per report, largest first (three DexScreener requests). */
export const MAX_CHECKED_TOKENS = 90;
const BATCH_SIZE = 30;

type DexPair = {
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  liquidity?: { usd?: number };
};

type FetchLike = typeof fetch;

/** Pool liquidity from DexScreener's public API (no key). Results are cached per token. */
export class DexScreenerDepth implements MarketDepth {
  private readonly cache: TtlCache<number>;

  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: FetchLike = callFetch,
    private readonly timeoutMs = 10_000,
    cacheMs = 5 * 60_000,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache<number>(cacheMs, 5_000, now);
  }

  async sellableUsd(chain: SupportedChainKey, tokens: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const missing = new Map<string, number>();
    for (const token of new Set(tokens)) {
      const cached = this.cache.get(`${chain}:${token}`);
      if (cached === undefined) missing.set(token, 0);
      else result.set(token, cached);
    }

    const batches: string[][] = [];
    const queue = [...missing.keys()];
    for (let index = 0; index < queue.length; index += BATCH_SIZE) batches.push(queue.slice(index, index + BATCH_SIZE));
    const responses = await Promise.all(batches.map((batch) => this.pairs(chain, batch)));

    for (const pair of responses.flat()) {
      const liquidity = Number(pair.liquidity?.usd);
      if (!Number.isFinite(liquidity) || liquidity <= 0) continue;
      for (const address of new Set([pair.baseToken?.address, pair.quoteToken?.address])) {
        if (address !== undefined && missing.has(address)) {
          missing.set(address, (missing.get(address) ?? 0) + liquidity / 2);
        }
      }
    }

    for (const [token, usd] of missing) {
      this.cache.set(`${chain}:${token}`, usd);
      result.set(token, usd);
    }
    return result;
  }

  private async pairs(chain: SupportedChainKey, tokens: string[]): Promise<DexPair[]> {
    const url = `${this.apiUrl}/tokens/v1/${chain}/${tokens.map(encodeURIComponent).join(",")}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "Market data provider did not respond.");
    }
    if (response.status === 429) {
      throw new ApiError(503, "upstream_rate_limited", "Market data provider is rate limiting. Retry shortly.");
    }
    if (!response.ok) {
      throw new ApiError(502, "upstream_error", `Market data provider returned ${response.status}.`);
    }
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as DexPair[]) : [];
  }
}

/**
 * Checks every long-tail token against its trading pools before it counts toward a portfolio.
 * Curated tokens (native, stablecoins, liquid staking, majors, memes) are trusted as priced.
 */
export class MarketCheckedSource implements PortfolioSource {
  constructor(
    private readonly inner: PortfolioSource,
    private readonly depth: MarketDepth,
  ) {}

  supports(family: ChainFamily) {
    return this.inner.supports(family);
  }

  async getOverview(wallet: string): Promise<PortfolioOverview> {
    const overview = await this.inner.getOverview(wallet);
    const unvetted = overview.assets
      .filter((asset) => asset.category === "long-tail")
      .slice(0, MAX_CHECKED_TOKENS)
      .map((asset) => asset.tokenAddress);
    const sellable = unvetted.length > 0 ? await this.depth.sellableUsd(overview.chain, unvetted) : new Map<string, number>();
    return limitToMarketDepth(overview, sellable);
  }
}

/**
 * Pure, exported for tests. A long-tail token is valued at no more than what its pools could pay
 * out; one with no pool (or not checked) counts as unpriced, like a token with no price at all.
 */
export function limitToMarketDepth(overview: PortfolioOverview, sellable: Map<string, number>): PortfolioOverview {
  let unpricedAssetCount = overview.unpricedAssetCount;
  const drafts: Parameters<typeof finaliseAssets>[0] = [];

  for (const { allocationBps: _allocation, ...asset } of overview.assets) {
    if (asset.category !== "long-tail") {
      drafts.push(asset);
      continue;
    }
    const limit = sellable.get(asset.tokenAddress) ?? 0;
    if (limit <= 0) {
      unpricedAssetCount += 1;
      continue;
    }
    drafts.push({ ...asset, valueUsd: Math.min(asset.valueUsd, limit) });
  }

  const { assets, totalValueUsd } = finaliseAssets(drafts);
  return portfolioOverviewSchema.parse({ ...overview, assets, totalValueUsd, unpricedAssetCount });
}
