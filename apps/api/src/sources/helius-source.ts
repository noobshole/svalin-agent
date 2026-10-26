import { SOL_NATIVE_MINT, categoriseToken, lookupToken } from "@svalin-agent/chain-config";
import { portfolioOverviewSchema, type ChainFamily, type PortfolioOverview, type RecipientKind } from "@svalin-agent/shared";

import { ApiError, tokenAddressError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";
import { onChainLabel } from "../lib/text.js";
import type { RecipientSignals } from "../risk/check.js";
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
/** Signatures read for a recipient's age and activity; reaching the cap means "at least this many". */
const SIGNATURE_CAP = 1000;
/** The payer's recent transactions read for the look-alike and first-payment checks. */
const PAYER_HISTORY = 15;
/** The newest Solana transaction version Svalin parses; older RPC defaults refuse version 1. */
const MAX_TRANSACTION_VERSION = 1;

type FetchLike = typeof fetch;

/** Records a provider error for the operator; the RPC URL (which holds the API key) is never logged. */
function upstreamLog(method: string, status: number, message: string | undefined) {
  console.error(JSON.stringify({ level: "error", msg: "helius_error", method, status, upstream: message?.slice(0, 200) }));
}

export class HeliusPortfolioSource implements PortfolioSource {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetchImpl: FetchLike = callFetch,
    private readonly timeoutMs = 10_000,
    private readonly retryDelayMs = 500,
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

  async inspectRecipient(recipient: string, payer: string | null): Promise<RecipientSignals> {
    const [account, signatures, history] = await Promise.all([
      this.rpc<{ value?: SolanaAccountInfo | null }>("getAccountInfo", [
        recipient,
        { encoding: "base64", dataSlice: { offset: ACCOUNT_TYPE_OFFSET, length: 1 } },
      ]),
      this.rpc<{ blockTime?: number | null }[]>("getSignaturesForAddress", [recipient, { limit: SIGNATURE_CAP }]),
      payer ? this.payerHistory(payer).catch(() => null) : Promise.resolve(null),
    ]);

    const info = account.value ?? null;
    const classified = classifySolanaAccount(info);
    let kind: RecipientKind = classified === "mint" ? "token" : classified;
    if (kind === "wallet" && !info && signatures.length === 0) kind = "unused";

    // Under the cap, the oldest signature is the address's first activity.
    const times = signatures.map((entry) => entry.blockTime).filter((time): time is number => typeof time === "number");
    const complete = signatures.length < SIGNATURE_CAP;
    return {
      chain: "solana",
      recipient,
      payer,
      kind,
      createdAt: complete && times.length > 0 ? Math.min(...times) * 1000 : null,
      transactions: signatures.length,
      transactionsAtLeast: !complete,
      payerSentTo: history?.sentTo ?? null,
      payerReceivedFrom: history?.receivedFrom ?? null,
      dataSource: "helius",
    };
  }

  /** Whom the payer paid, and was paid by, in its last few transactions. */
  private async payerHistory(payer: string): Promise<{ sentTo: string[]; receivedFrom: string[] }> {
    const signatures = await this.rpc<{ signature: string }[]>("getSignaturesForAddress", [payer, { limit: PAYER_HISTORY }]);
    // One at a time: RPC providers rate-limit bursts. Any transaction that fails to load makes the
    // whole history unknown, since a gap could hide the very payment a look-alike imitates.
    const transactions: (SolanaParsedTransaction | null)[] = [];
    for (const { signature } of signatures) {
      transactions.push(
        await this.rpc<SolanaParsedTransaction | null>("getTransaction", [
          signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: MAX_TRANSACTION_VERSION },
        ]),
      );
    }
    const sentTo = new Set<string>();
    const receivedFrom = new Set<string>();
    for (const transaction of transactions) {
      const parties = transferCounterparties(payer, transaction);
      parties.sentTo.forEach((address) => sentTo.add(address));
      parties.receivedFrom.forEach((address) => receivedFrom.add(address));
    }
    return { sentTo: [...sentTo], receivedFrom: [...receivedFrom] };
  }

  /** A JSON-RPC call. A rate-limited call is retried twice after a short wait before giving up. */
  private async rpc<T>(method: string, params: unknown[], attempt = 1): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: `svalin-${method}`, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "Solana data provider did not respond.");
    }
    if (response.status === 429) {
      if (attempt < 3) {
        await new Promise((resume) => setTimeout(resume, this.retryDelayMs * attempt));
        return this.rpc(method, params, attempt + 1);
      }
      throw new ApiError(503, "upstream_rate_limited", "Solana data provider is rate limiting. Retry shortly.");
    }
    const body = (await response.json().catch(() => ({}))) as { result?: T; error?: { message?: string } };
    if (!response.ok || body.error || !("result" in body)) {
      // The provider's own wording stays in our logs: callers (often agents) get ours, never theirs.
      upstreamLog(method, response.status, body.error?.message);
      throw new ApiError(502, "upstream_error", `Solana data provider returned an error (${response.status}).`);
    }
    return body.result as T;
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
      upstreamLog("getAssetsByOwner", response.status, body.error.message);
      throw new ApiError(502, "upstream_error", "Solana data provider error.");
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

/** The parts of a `getTransaction` (jsonParsed) result that show who paid whom. */
export type SolanaParsedTransaction = {
  meta?: {
    err?: unknown;
    innerInstructions?: { instructions?: SolanaParsedInstruction[] }[] | null;
    preTokenBalances?: SolanaTokenBalance[] | null;
    postTokenBalances?: SolanaTokenBalance[] | null;
  } | null;
  transaction?: { message?: { instructions?: SolanaParsedInstruction[] } };
};
type SolanaParsedInstruction = { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string } } };
type SolanaTokenBalance = { accountIndex: number; mint?: string; owner?: string; uiTokenAmount?: { amount?: string } };

/**
 * Pure, exported for tests: from one transaction, the wallets the payer sent SOL or tokens to and
 * received them from. SOL comes from system transfers; tokens from balance changes per owner,
 * since token transfers name token accounts, not their owners.
 */
export function transferCounterparties(payer: string, transaction: SolanaParsedTransaction | null): { sentTo: string[]; receivedFrom: string[] } {
  const sentTo = new Set<string>();
  const receivedFrom = new Set<string>();
  if (!transaction || transaction.meta?.err) return { sentTo: [], receivedFrom: [] };

  const instructions = [
    ...(transaction.transaction?.message?.instructions ?? []),
    ...(transaction.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions ?? []),
  ];
  for (const instruction of instructions) {
    const type = instruction.parsed?.type;
    if (instruction.program !== "system" || (type !== "transfer" && type !== "transferWithSeed")) continue;
    const { source, destination } = instruction.parsed?.info ?? {};
    if (source === payer && destination && destination !== payer) sentTo.add(destination);
    if (destination === payer && source && source !== payer) receivedFrom.add(source);
  }

  // Net change per owner and mint, from the token balances before and after.
  const change = new Map<string, bigint>();
  const apply = (balances: SolanaTokenBalance[] | null | undefined, sign: bigint) => {
    for (const balance of balances ?? []) {
      if (!balance.owner || !balance.mint) continue;
      let amount: bigint;
      try {
        amount = BigInt(balance.uiTokenAmount?.amount ?? "0");
      } catch {
        continue;
      }
      const key = `${balance.mint} ${balance.owner}`;
      change.set(key, (change.get(key) ?? 0n) + sign * amount);
    }
  };
  apply(transaction.meta?.preTokenBalances, -1n);
  apply(transaction.meta?.postTokenBalances, 1n);
  for (const [key, delta] of change) {
    const [mint, owner] = key.split(" ");
    if (owner !== payer || delta === 0n) continue;
    for (const [otherKey, otherDelta] of change) {
      const [otherMint, other] = otherKey.split(" ");
      if (otherMint !== mint || other === payer) continue;
      if (delta < 0n && otherDelta > 0n) sentTo.add(other);
      if (delta > 0n && otherDelta < 0n) receivedFrom.add(other);
    }
  }
  return { sentTo: [...sentTo], receivedFrom: [...receivedFrom] };
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
        known?.symbol ?? onChainLabel(info.symbol) ?? onChainLabel(item.content?.metadata?.symbol) ?? `${item.id.slice(0, 4)}…`;
      const name = onChainLabel(item.content?.metadata?.name) ?? symbol;

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
