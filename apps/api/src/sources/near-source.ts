import { NEAR_NATIVE_TOKEN, WNEAR_TOKEN, categoriseToken, knownTokens, lookupToken } from "@svalin-agent/chain-config";
import {
  isNearAccountId,
  portfolioOverviewSchema,
  saleProceeds,
  tokenGradeFor,
  type ChainFamily,
  type PortfolioOverview,
  type RatedTokenRow,
  type RecipientKind,
} from "@svalin-agent/shared";

import { ApiError, tokenAddressError } from "../lib/errors.js";
import type { RecipientSignals } from "../risk/check.js";
import { callFetch } from "../lib/fetch.js";
import { HIDDEN_NAME, onChainLabel } from "../lib/text.js";
import { finaliseAssets, formatUnits, round, type PortfolioSource } from "./portfolio-source.js";

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

/**
 * A Ref Finance concentrated-liquidity (DCL) pool: the fields Svalin reads from `list_pools` on
 * dclv2.ref-labs.near. `total_x` and `total_y` are the raw amounts it holds of each token.
 */
export type RefDclPool = { token_x: string; token_y: string; total_x: string; total_y: string; state?: string };

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
  /**
   * Depth each token gets from Ref's concentrated-liquidity pools, published with every Svalin
   * Index edition (`near-dcl-depth.json`). Paging the DCL contract does not fit in a request.
   */
  dclDepthUrl?: string;
  /** The token's row in the latest published Svalin Index, which carries its authoritative grade. */
  indexRow?: (contract: string) => Promise<RatedTokenRow | undefined>;
  /**
   * FastNEAR transactions API base URL, e.g. https://tx.main.fastnear.com: account age, activity
   * and recent transfers for the recipient check.
   */
  txApiUrl?: string;
};

/** The parts of FastNEAR transactions API responses the recipient check reads. */
type TxAccountPage = { account_txs?: { transaction_hash?: string; tx_block_timestamp?: string }[]; txs_count?: number };
export type TxAction = {
  Transfer?: { deposit?: string };
  FunctionCall?: { method_name?: string; args?: string };
  /** A relayed (NEP-366) transaction, as x402 payments on NEAR are: the real sender is inside. */
  Delegate?: { delegate_action?: { sender_id?: string; receiver_id?: string; actions?: TxAction[] } };
};
export type TxRecord = {
  transaction?: { signer_id?: string; receiver_id?: string; actions?: TxAction[] };
  /** Every step the transaction set off, including transfers made by contracts it called. */
  receipts?: {
    receipt?: { predecessor_id?: string; receiver_id?: string; receipt?: { Action?: { actions?: TxAction[] } } };
    execution_outcome?: { outcome?: { status?: Record<string, unknown> } };
  }[];
};

/** A NEAR account with no contract deployed has this code hash. */
const EMPTY_CODE_HASH = "11111111111111111111111111111111";
/** Recent transactions of the payer read for the look-alike and first-payment checks: its own, and any. */
const PAYER_HISTORY = 20;
/** The most transaction hashes FastNEAR returns per request. */
const TX_BATCH = 20;
const IMPLICIT_ACCOUNT = /^([0-9a-f]{64}|0x[0-9a-f]{40})$/;
const FT_TRANSFERS = new Set(["ft_transfer", "ft_transfer_call"]);

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
    if (prices[wallet]) throw await this.tokenError(wallet, prices);
    if (!account.state) {
      throw new ApiError(404, "account_not_found", "This NEAR account does not exist.");
    }
    const [stakes, depth] = await Promise.all([
      this.poolStakes(wallet, (account.pools ?? []).slice(0, MAX_POOLS)),
      holdsUnvettedTokens(account, prices) ? this.heldDepthMap(account, prices) : new Map<string, number>(),
    ]);
    return mapNearToOverview(wallet, account, prices, stakes, depth);
  }

  /**
   * Live pool depth for the account's tokens, capped at the backing each has held for 24 hours in
   * the latest Index edition: a pool added this morning cannot make a wallet look richer, and one
   * pulled since the edition still lowers the value at once. A token too new for the Index counts
   * as unpriced. If the Index cannot be read, live depth alone sets the bound.
   */
  private async heldDepthMap(account: FastNearAccount, prices: NearPriceList): Promise<Map<string, number>> {
    const live = await this.depthMap(prices);
    if (!this.options.indexRow) return live;
    const capped = new Map(live);
    try {
      for (const { contract_id: contract } of account.tokens ?? []) {
        if (lookupToken("near", contract) || !live.has(contract)) continue;
        const held = (await this.options.indexRow(contract))?.[3] ?? 0;
        capped.set(contract, Math.min(live.get(contract) ?? 0, held));
      }
    } catch {
      return live;
    }
    return capped;
  }

  async inspectRecipient(recipient: string, payer: string | null): Promise<RecipientSignals> {
    const [prices, view, latest, first, history] = await Promise.all([
      this.priceList(),
      this.viewAccount(recipient),
      this.txApi<TxAccountPage>("/v0/account", { account_id: recipient, limit: 1 }),
      // Its first successful receipt: the transaction that created the account.
      this.txApi<TxAccountPage>("/v0/account", { account_id: recipient, is_real_receiver: true, is_success: true, desc: false, limit: 1 }),
      payer ? this.payerHistory(payer) : Promise.resolve(null),
    ]);

    let kind: RecipientKind = "wallet";
    if (prices[recipient]) kind = "token";
    else if (!view) kind = IMPLICIT_ACCOUNT.test(recipient) ? "unused" : "missing";
    else if (view.code_hash && view.code_hash !== EMPTY_CODE_HASH) kind = "contract";

    const createdNs = Number(first?.account_txs?.[0]?.tx_block_timestamp);
    const transactions = latest?.txs_count;
    return {
      chain: "near",
      recipient,
      payer,
      kind,
      createdAt: Number.isFinite(createdNs) && createdNs > 0 ? Math.floor(createdNs / 1e6) : null,
      transactions: typeof transactions === "number" && Number.isInteger(transactions) ? transactions : null,
      transactionsAtLeast: false,
      payerSentTo: history?.sentTo ?? null,
      payerReceivedFrom: history?.receivedFrom ?? null,
      dataSource: "fastnear",
    };
  }

  /** `view_account` over RPC: null when the account does not exist. */
  private async viewAccount(accountId: string): Promise<{ code_hash?: string } | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "svalin",
          method: "query",
          params: { request_type: "view_account", finality: "final", account_id: accountId },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "NEAR data provider did not respond.");
    }
    const body = (await response.json().catch(() => ({}))) as {
      result?: { code_hash?: string };
      error?: { cause?: { name?: string } };
    };
    if (body.result) return body.result;
    if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
    throw new ApiError(502, "upstream_error", "NEAR data provider could not read the account.");
  }

  /** A FastNEAR transactions API read, or null if it is not configured or does not answer. */
  private async txApi<T>(path: string, body: object): Promise<T | null> {
    if (!this.options.txApiUrl) return null;
    try {
      const response = await this.fetchImpl(`${this.options.txApiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok ? ((await response.json()) as T) : null;
    } catch {
      return null;
    }
  }

  /**
   * Whom the payer recently sent NEAR or tokens to, and received them from. Its own transactions
   * are read apart from everything else, so a stream of incoming payouts or spam cannot push the
   * payments a look-alike would imitate out of view.
   */
  private async payerHistory(payer: string): Promise<{ sentTo: string[]; receivedFrom: string[] } | null> {
    const [own, recent] = await Promise.all([
      this.txApi<TxAccountPage>("/v0/account", { account_id: payer, is_any_signer: true, is_success: true, limit: PAYER_HISTORY }),
      this.txApi<TxAccountPage>("/v0/account", { account_id: payer, is_success: true, limit: PAYER_HISTORY }),
    ]);
    // Every read is needed: a gap could hide the very payment a look-alike imitates.
    if (!own || !recent) return null;
    const hashes = [...new Set([...(own.account_txs ?? []), ...(recent.account_txs ?? [])].flatMap((tx) => tx.transaction_hash ?? []))];
    const batches: string[][] = [];
    for (let start = 0; start < hashes.length; start += TX_BATCH) batches.push(hashes.slice(start, start + TX_BATCH));
    const records = await Promise.all(
      batches.map((batch) => this.txApi<{ transactions?: TxRecord[] }>("/v0/transactions", { tx_hashes: batch })),
    );
    if (records.some((record) => !record)) return null;
    return transferCounterpartiesNear(payer, records.flatMap((record) => record?.transactions ?? []));
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
   * Depth from concentrated-liquidity pools comes from the latest Index edition and is added on top;
   * if it cannot be read, tokens are valued on the classic pools alone, which can only lower them.
   */
  private depthMap(prices: NearPriceList): Promise<Map<string, number>> {
    if (this.depth && this.now() - this.depth.at < this.poolsTtlMs) return this.depth.data;
    const data = Promise.all([
      this.get(this.options.poolsUrl).then((response) => response.text()),
      this.dclDepth(),
    ]).then(([text, dcl]) => {
      const depth = poolDepth(parseRefPools(text), prices);
      for (const [contract, usd] of dcl) depth.set(contract, (depth.get(contract) ?? 0) + usd);
      return depth;
    });
    this.depth = { at: this.now(), data };
    data.catch(() => {
      if (this.depth?.data === data) this.depth = undefined;
    });
    return data;
  }

  private async dclDepth(): Promise<Map<string, number>> {
    if (!this.options.dclDepthUrl) return new Map();
    try {
      const response = await this.fetchImpl(this.options.dclDepthUrl, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return new Map();
      const body = (await response.json()) as { depth?: Record<string, number> };
      return new Map(Object.entries(body.depth ?? {}).filter(([, usd]) => Number.isFinite(usd) && usd > 0));
    } catch {
      return new Map();
    }
  }

  /**
   * The address is a token contract Ref Finance prices: answer with its grade from the published
   * Svalin Index, where backing has to hold for 24 hours before it counts. A token too new for the
   * Index is graded F until it has.
   */
  private async tokenError(contract: string, prices: NearPriceList): Promise<ApiError> {
    const known = lookupToken("near", contract);
    const symbol = known?.symbol ?? onChainLabel(prices[contract]?.symbol) ?? null;
    if (known) return tokenAddressError({ chain: "near", address: contract, symbol, grade: null, backingUsd: null });

    if (this.options.indexRow) {
      let row: RatedTokenRow | undefined;
      let indexed = true;
      try {
        row = await this.options.indexRow(contract);
      } catch {
        indexed = false; // The Index is unreachable: fall back to live pool depth below.
      }
      if (row) {
        const notice = { chain: "near" as const, address: contract, symbol, grade: row[4], backingUsd: row[3] };
        // Backing that is newer than 24 hours is on hold: say so, rather than calling it $0.
        const live = Math.round((await this.depthMap(prices).catch(() => new Map<string, number>())).get(contract) ?? 0);
        if (live > row[3] && tokenGradeFor(live) !== row[4]) {
          return tokenAddressError(
            notice,
            `Svalin Index grade ${row[4]}: $${row[3].toLocaleString("en-US")} of backing has held for 24 hours. Its pools hold $${live.toLocaleString("en-US")} now; the rest counts once it has held for 24 hours.`,
          );
        }
        return tokenAddressError(notice);
      }
      if (indexed) {
        return tokenAddressError(
          { chain: "near", address: contract, symbol, grade: "F", backingUsd: 0 },
          "It is not in the Svalin Index yet: a token's pool backing has to hold for 24 hours before it is graded.",
        );
      }
    }
    const backingUsd = Math.round((await this.depthMap(prices)).get(contract) ?? 0);
    return tokenAddressError({ chain: "near", address: contract, symbol, grade: tokenGradeFor(backingUsd), backingUsd });
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
  let hiddenNameCount = 0;
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
      exitValueUsd: nearPrice === null ? 0 : round(toAmount(nativeYocto, NEAR_DECIMALS) * nearPrice, 2),
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
      exitValueUsd: nearPrice === null ? 0 : round(toAmount(stake.yocto, NEAR_DECIMALS) * nearPrice, 2),
      category: "liquid-staking",
    });
  }

  for (const token of account.tokens ?? []) {
    const raw = toBigInt(token.balance);
    if (raw <= 0n || !isNearAccountId(token.contract_id)) continue;

    const entry = prices[token.contract_id];
    if (entry && onChainLabel(entry.symbol) === HIDDEN_NAME) hiddenNameCount += 1;
    const price = priceOf(prices, token.contract_id);
    if (!entry || price === null || !Number.isInteger(entry.decimal)) {
      unpricedAssetCount += 1;
      continue;
    }

    const known = lookupToken("near", token.contract_id);
    // Anyone can send an account a token whose quoted price is fake or stale, so a token outside
    // the registry is worth at most what its pools could pay out, and nothing without a pool.
    const quotedUsd = toAmount(raw, entry.decimal) * price;
    let valueUsd = quotedUsd;
    let exitValueUsd = quotedUsd;
    if (!known) {
      const sellable = depth.get(token.contract_id) ?? 0;
      if (sellable <= 0) {
        unpricedAssetCount += 1;
        continue;
      }
      valueUsd = Math.min(quotedUsd, sellable);
      exitValueUsd = exitValue(quotedUsd, sellable);
    }

    const symbol = known?.symbol ?? onChainLabel(entry.symbol) ?? `${token.contract_id.slice(0, 6)}…`;
    drafts.push({
      chain: "near",
      tokenAddress: token.contract_id,
      symbol,
      name: symbol,
      balance: formatUnits(raw, entry.decimal),
      priceUsd: price,
      valueUsd,
      exitValueUsd: round(exitValueUsd, 2),
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
    hiddenNameCount,
    dataSource: "fastnear",
    refreshedAt: now.toISOString(),
  });
}

/**
 * For each token outside the registry, the USD value of registry tokens (wNEAR, stablecoins,
 * liquid staking and so on) in the pools it trades in: the most a sale of it could take out.
 * A token paired only with other unvetted tokens gets nothing, so fake liquidity does not count.
 */
export function poolDepth(pools: RefPool[], prices: NearPriceList, dclPools: readonly RefDclPool[] = []): Map<string, number> {
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

  // A concentrated-liquidity pool holds its two tokens across price ranges. The registry token it
  // holds is still the most a sale of the other token could take out.
  const reserveUsd = (contract: string, raw: string) => {
    const usd = unitUsd.get(contract);
    const amount = Number(raw);
    return usd !== undefined && Number.isFinite(amount) && amount > 0 ? amount * usd : 0;
  };
  for (const { token_x: x, token_y: y, total_x: totalX, total_y: totalY, state } of dclPools) {
    if (state !== undefined && state !== "Running") continue;
    const xUsd = reserveUsd(x, totalX);
    const yUsd = reserveUsd(y, totalY);
    if (!REGISTRY_CONTRACTS.has(x) && yUsd > 0) depth.set(x, (depth.get(x) ?? 0) + yUsd);
    if (!REGISTRY_CONTRACTS.has(y) && xUsd > 0) depth.set(y, (depth.get(y) ?? 0) + xUsd);
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

/**
 * What selling `quotedUsd` worth of a token would fetch from pools holding `backingUsd` of
 * registry tokens on the other side: the Index's sale loss applied to the whole position. The bigger
 * the sale against the pool, the worse the price, and never more than the backing itself. Registry
 * tokens trade deep enough to count at full value.
 */
export function exitValue(quotedUsd: number, backingUsd: number): number {
  return saleProceeds(backingUsd, quotedUsd);
}

/**
 * Whom the payer sent NEAR or tokens to, and who sent them to the payer, in a batch of the
 * payer's transactions. Each transaction's receipts are read, so transfers made by a contract it
 * called count too; network refunds and failed steps do not. Relayed transactions count for their
 * real sender.
 */
export function transferCounterpartiesNear(payer: string, records: readonly TxRecord[]): { sentTo: string[]; receivedFrom: string[] } {
  const sentTo = new Set<string>();
  const receivedFrom = new Set<string>();
  const note = (from: string | undefined, to: string | undefined) => {
    if (!from || !to || from === to) return;
    if (from === payer) sentTo.add(to);
    else if (to === payer) receivedFrom.add(from);
  };
  const visit = (from: string | undefined, to: string | undefined, actions: readonly TxAction[] | undefined) => {
    for (const action of actions ?? []) {
      if (action.Transfer) note(from, to);
      else if (action.FunctionCall && FT_TRANSFERS.has(action.FunctionCall.method_name ?? "")) {
        note(from, ftReceiver(action.FunctionCall.args));
      } else if (action.Delegate?.delegate_action) {
        const inner = action.Delegate.delegate_action;
        visit(inner.sender_id, inner.receiver_id, inner.actions);
      }
    }
  };
  for (const { transaction, receipts } of records) {
    if (!receipts?.length) {
      if (transaction) visit(transaction.signer_id, transaction.receiver_id, transaction.actions);
      continue;
    }
    for (const { receipt, execution_outcome: outcome } of receipts) {
      if (!receipt || receipt.predecessor_id === "system") continue;
      if (outcome?.outcome?.status && "Failure" in outcome.outcome.status) continue;
      visit(receipt.predecessor_id, receipt.receiver_id, receipt.receipt?.Action?.actions);
    }
  }
  return { sentTo: [...sentTo], receivedFrom: [...receivedFrom] };
}

/** The `receiver_id` of an `ft_transfer` call's base64 JSON arguments. */
function ftReceiver(args: string | undefined): string | undefined {
  try {
    const parsed = JSON.parse(atob(args ?? "")) as { receiver_id?: unknown };
    return typeof parsed.receiver_id === "string" ? parsed.receiver_id : undefined;
  } catch {
    return undefined;
  }
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
