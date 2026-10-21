import { SOL_NATIVE_MINT, categoriseToken, lookupToken } from "@svalin-agent/chain-config";
import { portfolioOverviewSchema, type ChainFamily, type PortfolioOverview } from "@svalin-agent/shared";

import { ApiError, tokenAddressError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";
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

/** The parts of `getAccountInfo` that tell a wallet from a token or a program. */
export type SolanaAccountInfo = { owner: string; executable: boolean; space?: number; data?: [string, string] };

export type SolanaAccountKind = "wallet" | "mint" | "token-account" | "program";

const PAGE_LIMIT = 1000;
const MAX_PAGES = 3;
const FUNGIBLE = new Set(["FungibleToken", "FungibleAsset"]);
/** SPL Token and Token-2022. */
const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const MINT_SIZE = 82;
/** Token-2022 accounts with extensions store their type after the 165-byte base: 1 is a mint. */
const ACCOUNT_TYPE_OFFSET = 165;

type FetchLike = typeof fetch;

export class HeliusPortfolioSource implements PortfolioSource {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetchImpl: FetchLike = callFetch,
    private readonly timeoutMs = 10_000,
  ) {}

  supports(family: ChainFamily) {
    return family === "solana";
  }

  async getOverview(wallet: string): Promise<PortfolioOverview> {
    // Who owns the address is read alongside the first page: a token mint, a token account or a
    // program would otherwise get a score as if it were a near-empty wallet.
    const firstPage = this.request(wallet, 1);
    firstPage.catch(() => undefined);
    const kind = await this.accountKind(wallet);
    if (kind === "mint") {
      throw tokenAddressError({ chain: "solana", address: wallet, symbol: lookupToken("solana", wallet)?.symbol ?? null, grade: null, backingUsd: null });
    }
    if (kind === "token-account") {
      throw new ApiError(422, "not_a_wallet", "This is a token account, not a wallet.", "A token account holds one token for a wallet. Send the wallet's address instead.");
    }
    if (kind === "program") {
      throw new ApiError(422, "not_a_wallet", "This is a program, not a wallet.", "Svalin scores wallets. Send a wallet address instead.");
    }

    const pages = [await firstPage];
    for (let page = 2; page <= MAX_PAGES && (pages[pages.length - 1].result?.items?.length ?? 0) >= PAGE_LIMIT; page += 1) {
      pages.push(await this.request(wallet, page));
    }

    return mapHeliusToOverview(wallet, pages);
  }

  /** Reads the account's owner program. If the lookup fails, the address is treated as a wallet. */
  private async accountKind(address: string): Promise<SolanaAccountKind> {
    try {
      const response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "svalin-kind",
          method: "getAccountInfo",
          params: [address, { encoding: "base64", dataSlice: { offset: ACCOUNT_TYPE_OFFSET, length: 1 } }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return "wallet";
      const body = (await response.json()) as { result?: { value?: SolanaAccountInfo | null } };
      return classifySolanaAccount(body.result?.value);
    } catch {
      return "wallet";
    }
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

/**
 * Pure, exported for tests. A missing account is an unused wallet, and an account owned by any
 * program other than the token programs (a vault, a multisig) is scored as a wallet.
 */
export function classifySolanaAccount(account: SolanaAccountInfo | null | undefined): SolanaAccountKind {
  if (!account) return "wallet";
  if (account.executable) return "program";
  if (!TOKEN_PROGRAMS.has(account.owner)) return "wallet";
  const typeByte = account.data?.[0] ? atob(account.data[0]).charCodeAt(0) : undefined;
  return account.space === MINT_SIZE || typeByte === 1 ? "mint" : "token-account";
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
