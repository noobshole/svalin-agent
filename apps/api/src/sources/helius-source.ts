import { SOL_NATIVE_MINT, categoriseToken, lookupToken } from "@svalin-agent/chain-config";
import { portfolioOverviewSchema, type ChainFamily, type PortfolioOverview } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import { finaliseAssets, formatUnits, type PortfolioSource } from "./portfolio-source.js";

/** The subset of the Helius DAS `getAssetsByOwner` response Svalin relies on. */
export type HeliusAssetsResponse = {
  result?: {
    total?: number;
    items?: HeliusAsset[];
    nativeBalance?: {
      lamports?: number;
      price_per_sol?: number;
      total_price?: number;
    };
  };
  error?: { code?: number; message?: string };
};

export type HeliusAsset = {
  id: string;
  interface?: string;
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: {
    symbol?: string;
    balance?: number | string;
    decimals?: number;
    price_info?: { price_per_token?: number; total_price?: number };
  };
};

const PAGE_LIMIT = 1000;
const MAX_PAGES = 3;
const FUNGIBLE = new Set(["FungibleToken", "FungibleAsset"]);

type FetchLike = typeof fetch;

export class HeliusPortfolioSource implements PortfolioSource {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  supports(family: ChainFamily) {
    return family === "solana";
  }

  async getOverview(wallet: string): Promise<PortfolioOverview> {
    const pages: HeliusAssetsResponse[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.request(wallet, page);
      pages.push(response);
      const items = response.result?.items ?? [];
      if (items.length < PAGE_LIMIT) break;
    }

    return mapHeliusToOverview(wallet, pages);
  }

  private async request(wallet: string, page: number): Promise<HeliusAssetsResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `svalin-${page}`,
          method: "getAssetsByOwner",
          params: {
            ownerAddress: wallet,
            page,
            limit: PAGE_LIMIT,
            options: { showFungible: true, showNativeBalance: true },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "Solana data provider did not respond.");
    }

    if (response.status === 429) {
      throw new ApiError(503, "upstream_rate_limited", "Solana data provider is rate limiting. Retry shortly.");
    }
    if (!response.ok) {
      throw new ApiError(502, "upstream_error", `Solana data provider returned ${response.status}.`);
    }

    const body = (await response.json()) as HeliusAssetsResponse;
    if (body.error) {
      // Helius returns -32602 for malformed owners; surface it as a client error.
      if (body.error.code === -32602) {
        throw new ApiError(400, "invalid_address", "Helius rejected this address.");
      }
      throw new ApiError(502, "upstream_error", body.error.message ?? "Solana data provider error.");
    }
    return body;
  }
}

/** Pure mapping, exported for tests. */
export function mapHeliusToOverview(
  wallet: string,
  pages: HeliusAssetsResponse[],
  now: Date = new Date(),
): PortfolioOverview {
  const drafts: Parameters<typeof finaliseAssets>[0] = [];
  let unpricedAssetCount = 0;

  const native = pages[0]?.result?.nativeBalance;
  if (native?.lamports && native.lamports > 0) {
    const price = typeof native.price_per_sol === "number" ? native.price_per_sol : null;
    const sol = native.lamports / 1e9;
    drafts.push({
      chain: "solana",
      tokenAddress: SOL_NATIVE_MINT,
      symbol: "SOL",
      name: "Solana",
      balance: formatUnits(BigInt(Math.trunc(native.lamports)), 9),
      priceUsd: price,
      valueUsd: price === null ? 0 : (native.total_price ?? sol * price),
      category: "native",
    });
  }

  for (const page of pages) {
    for (const item of page.result?.items ?? []) {
      if (!item.interface || !FUNGIBLE.has(item.interface)) continue;
      const info = item.token_info;
      if (!info || info.balance === undefined || info.decimals === undefined) continue;

      let raw: bigint;
      try {
        raw = BigInt(typeof info.balance === "number" ? Math.trunc(info.balance) : info.balance);
      } catch {
        continue;
      }
      if (raw <= 0n) continue;

      const price = info.price_info?.price_per_token;
      const known = lookupToken("solana", item.id);
      const symbol =
        known?.symbol ?? clean(info.symbol) ?? clean(item.content?.metadata?.symbol) ?? `${item.id.slice(0, 4)}…`;
      const name = clean(item.content?.metadata?.name) ?? symbol;

      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
        unpricedAssetCount += 1;
        continue;
      }

      const amount = Number(raw) / 10 ** info.decimals;
      drafts.push({
        chain: "solana",
        tokenAddress: item.id,
        symbol,
        name,
        balance: formatUnits(raw, info.decimals),
        priceUsd: price,
        valueUsd: info.price_info?.total_price ?? amount * price,
        category: categoriseToken("solana", item.id),
      });
    }
  }

  const { assets, totalValueUsd } = finaliseAssets(drafts);

  return portfolioOverviewSchema.parse({
    wallet,
    chain: "solana",
    totalValueUsd,
    assets,
    unpricedAssetCount,
    dataSource: "helius",
    refreshedAt: now.toISOString(),
  });
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 32) : undefined;
}
