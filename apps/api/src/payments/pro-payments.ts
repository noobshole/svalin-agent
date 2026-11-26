/**
 * Finding Svalin Pro payments on-chain. The API checks each payment itself, against the chain:
 * the transaction succeeded, the token is native USDC, and the money reached Svalin's account.
 * The buyer's wallet is never connected and never asked to sign anything.
 */
import { ApiError } from "../lib/errors.js";
import { fastNearTx } from "../lib/fastnear.js";
import { callFetch } from "../lib/fetch.js";

type FetchLike = typeof fetch;

/**
 * A transaction a lookup read: its network, the USDC it brought Svalin (atomic units, "0" when it
 * paid nothing), and when.
 */
export type FoundPayment = { tx: string; network: string; atomic: string; at: number };

/**
 * Drops the transactions read before, so each is fetched from the chain once: repeated lookups
 * then cost one call, however many transactions a code's reference has collected.
 */
export type UnreadFilter = (txs: string[]) => Promise<string[]>;

/** Transactions read per lookup: enough for years of monthly renewals with one code. */
const SOLANA_SIGNATURES = 20;
/** Svalin's NEAR history is read a page at a time, back to the oldest waiting checkout. */
const NEAR_PAGE = 50;
/** At most this many pages a lookup: 500 transactions, two days of a busy account. */
const NEAR_PAGES = 10;
const NEAR_BATCH = 20;
/** A NEAR transfer's refund, if it has one, lands a few blocks later, so newer transactions wait for the next lookup. */
const NEAR_SETTLE_MS = 15_000;

type TokenBalance = { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } };
type SolanaTransaction = {
  blockTime?: number | null;
  meta?: { err?: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  /** jsonParsed lists each account as `{ pubkey }`; the first one pays the fee. */
  transaction?: { message?: { accountKeys?: (string | { pubkey?: string })[] } } | null;
};

/**
 * Transactions made with a Solana Pay reference, each with what it paid. A payment counts by how
 * much USDC Svalin's own token accounts gained in it, read from the balances before and after, so
 * it does not matter how the wallet built the transfer. It counts only when the account that paid
 * the fee is the one whose USDC went down by at least that much: a wallet paying for Pro pays its
 * own fee, while an x402 payment's fee is paid by the facilitator, so one transfer can never buy
 * an x402 call or pass and Pro too. A transaction the RPC cannot return yet is left out, to be
 * read on the next lookup.
 */
export async function solanaPaymentsByReference(options: {
  rpcUrl: string;
  network: string;
  reference: string;
  payTo: string;
  mint: string;
  unread?: UnreadFilter;
  fetchImpl?: FetchLike;
}): Promise<FoundPayment[]> {
  const rpc = solanaRpc(options.rpcUrl, options.fetchImpl ?? callFetch);
  const signatures = await rpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [
    options.reference,
    { limit: SOLANA_SIGNATURES, commitment: "confirmed" },
  ]);
  const succeeded = (signatures ?? []).filter((entry) => entry.err === null && typeof entry.signature === "string").map((entry) => entry.signature);
  const fresh = succeeded.length > 0 && options.unread ? await options.unread(succeeded) : succeeded;
  const transactions = await Promise.all(
    fresh.map((signature) =>
      rpc<SolanaTransaction | null>("getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]),
    ),
  );
  return fresh.flatMap((signature, index) => {
    const transaction = transactions[index];
    // Read once means read in full: without its balances, a transaction waits for the next lookup.
    const feePayer = feePayerOf(transaction);
    if (!transaction?.meta || !transaction.blockTime || !Array.isArray(transaction.meta.postTokenBalances) || !feePayer) return [];
    const received = transaction.meta.err === null ? usdcReceived(transaction.meta, options.payTo, options.mint) : 0n;
    const paidByFeePayer = received > 0n && -usdcReceived(transaction.meta, feePayer, options.mint) >= received;
    if (received > 0n && !paidByFeePayer) {
      // Logged with its transaction, so a wallet that has someone else pay its fees can be credited by hand.
      console.error(JSON.stringify({ level: "error", msg: "pro_payment_fee_paid_by_other", network: options.network, transaction: signature }));
    }
    return [{ tx: signature, network: options.network, atomic: (paidByFeePayer ? received : 0n).toString(), at: transaction.blockTime * 1000 }];
  });
}

/** The account that paid a transaction's fee: the first in its list. */
function feePayerOf(transaction: SolanaTransaction | null | undefined): string | null {
  const first = transaction?.transaction?.message?.accountKeys?.[0];
  const key = typeof first === "string" ? first : first?.pubkey;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/** USDC that token accounts owned by `owner` gained in one transaction. */
export function usdcReceived(meta: NonNullable<SolanaTransaction["meta"]>, owner: string, mint: string): bigint {
  const total = (balances: TokenBalance[] | undefined) =>
    (balances ?? [])
      .filter((balance) => balance.owner === owner && balance.mint === mint)
      .reduce((sum, balance) => sum + atomic(balance.uiTokenAmount?.amount), 0n);
  return total(meta.postTokenBalances) - total(meta.preTokenBalances);
}

function solanaRpc(url: string, fetchImpl: FetchLike) {
  return async <T>(method: string, params: unknown[]): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "svalin", method, params }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "pro_lookup_error", chain: "solana", method, error: String(error).slice(0, 200) }));
      throw new ApiError(502, "upstream_unavailable", "The Solana network did not answer. Try again in a minute.");
    }
    const body = (await response.json().catch(() => ({}))) as { result?: T; error?: { message?: string } };
    if (!response.ok || body.error || !("result" in body)) {
      console.error(
        JSON.stringify({ level: "error", msg: "pro_lookup_error", chain: "solana", method, status: response.status, upstream: body.error?.message?.slice(0, 200) }),
      );
      throw new ApiError(502, "upstream_error", "The Solana network could not be read. Try again in a minute.");
    }
    return body.result as T;
  };
}

type TxAccountPage = { account_txs?: { transaction_hash?: string; tx_block_timestamp?: string }[]; resume_token?: string };
type NearReceiptRecord = {
  receipt?: { receiver_id?: string };
  execution_outcome?: { outcome?: { logs?: string[]; status?: Record<string, unknown> } };
};
type NearTxRecord = { transaction?: { hash?: string }; execution_outcome?: { id?: string }; receipts?: NearReceiptRecord[] };

/**
 * Svalin's NEAR transactions since a time, each with the USDC it brought, read from the FastNEAR
 * transactions API newest first. A payment counts by the token's own transfer events (NEP-141),
 * net of any refund in the same transaction, so a plain transfer, a transfer with a call and a
 * relayed one all count the same.
 */
export async function nearPaymentsReceived(options: {
  txApiUrl: string;
  network: string;
  payTo: string;
  token: string;
  /** Payments before this time (ms) are skipped. */
  since: number;
  unread?: UnreadFilter;
  now?: number;
  fetchImpl?: FetchLike;
  /** A FastNEAR API key; see lib/fastnear.ts. */
  apiKey?: string;
  /** The waits before retrying a refused read (tests use none). */
  retryDelaysMs?: readonly number[];
}): Promise<FoundPayment[]> {
  const fetchImpl = options.fetchImpl ?? callFetch;
  const post = async <T>(path: string, body: object): Promise<T> => {
    const result = await fastNearTx<T>(
      { baseUrl: options.txApiUrl, apiKey: options.apiKey, fetchImpl, retryDelaysMs: options.retryDelaysMs },
      path,
      body,
    );
    if (result.ok) return result.body;
    console.error(JSON.stringify({ level: "error", msg: "pro_lookup_error", chain: "near", path, reason: result.reason }));
    if (result.reason.startsWith("HTTP ")) {
      throw new ApiError(502, "upstream_error", "The NEAR network could not be read. Try again in a minute.");
    }
    throw new ApiError(502, "upstream_unavailable", "The NEAR network did not answer. Try again in a minute.");
  };

  const settled = (options.now ?? Date.now()) - NEAR_SETTLE_MS;
  const times = new Map<string, number>();
  let resume: string | undefined;
  for (let page = 0; page < NEAR_PAGES; page += 1) {
    const result = await post<TxAccountPage>("/v0/account", {
      account_id: options.payTo,
      is_event_log: true,
      is_success: true,
      limit: NEAR_PAGE,
      ...(resume ? { resume_token: resume } : {}),
    });
    const entries = result.account_txs ?? [];
    let reachedSince = false;
    for (const entry of entries) {
      const at = Math.floor(Number(entry.tx_block_timestamp) / 1e6);
      if (!entry.transaction_hash || !Number.isFinite(at)) continue;
      if (at < options.since) reachedSince = true;
      else if (at <= settled) times.set(entry.transaction_hash, at);
    }
    resume = result.resume_token;
    if (reachedSince || !resume || entries.length < NEAR_PAGE) break;
  }
  const hashes = times.size > 0 && options.unread ? await options.unread([...times.keys()]) : [...times.keys()];
  const batches: string[][] = [];
  for (let start = 0; start < hashes.length; start += NEAR_BATCH) batches.push(hashes.slice(start, start + NEAR_BATCH));
  const records = (await Promise.all(batches.map((batch) => post<{ transactions?: NearTxRecord[] }>("/v0/transactions", { tx_hashes: batch }))))
    .flatMap((result) => result.transactions ?? []);

  return records.flatMap((record) => {
    const tx = record.execution_outcome?.id ?? record.transaction?.hash;
    const at = tx ? times.get(tx) : undefined;
    if (!tx || at === undefined || !record.receipts?.length) return [];
    const received = nearUsdcReceived(record.receipts ?? [], options.payTo, options.token);
    return [{ tx, network: options.network, atomic: (received > 0n ? received : 0n).toString(), at }];
  });
}

/** Net USDC `payTo` received in one NEAR transaction, from the token contract's successful transfer events. */
export function nearUsdcReceived(receipts: NearReceiptRecord[], payTo: string, token: string): bigint {
  let net = 0n;
  for (const { receipt, execution_outcome: outcome } of receipts) {
    if (receipt?.receiver_id !== token) continue;
    const status = outcome?.outcome?.status;
    if (!status || !("SuccessValue" in status || "SuccessReceiptId" in status)) continue;
    for (const log of outcome?.outcome?.logs ?? []) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      let event: { standard?: unknown; event?: unknown; data?: unknown };
      try {
        event = JSON.parse(log.slice("EVENT_JSON:".length)) as typeof event;
      } catch {
        continue;
      }
      if (event.standard !== "nep141" || event.event !== "ft_transfer" || !Array.isArray(event.data)) continue;
      for (const transfer of event.data as { old_owner_id?: unknown; new_owner_id?: unknown; amount?: unknown }[]) {
        const amount = atomic(typeof transfer.amount === "string" ? transfer.amount : undefined);
        if (transfer.new_owner_id === payTo) net += amount;
        if (transfer.old_owner_id === payTo) net -= amount;
      }
    }
  }
  return net;
}

function atomic(value: string | undefined): bigint {
  return value && /^\d{1,30}$/.test(value) ? BigInt(value) : 0n;
}

/** "5.004217" from 5004217 atomic units of a 6-decimal token. */
export function usdcDecimal(atomicAmount: string): string {
  const padded = atomicAmount.padStart(7, "0");
  return `${padded.slice(0, -6)}.${padded.slice(-6)}`;
}

/** 5000000 atomic units from a whole-dollar or decimal USD price. */
export function usdcAtomic(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}
