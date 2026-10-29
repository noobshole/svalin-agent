/**
 * Finding Svalin Pro payments on-chain. The API checks each payment itself, against the chain:
 * the transaction succeeded, the token is native USDC, and the money reached Svalin's account.
 * The buyer's wallet is never connected and never asked to sign anything.
 */
import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";

type FetchLike = typeof fetch;

/** A payment to Svalin: the transaction, its network, the USDC it brought (atomic units), and when. */
export type FoundPayment = { tx: string; network: string; atomic: string; at: number };

/** Transactions read per lookup: enough for years of monthly renewals with one code. */
const SOLANA_SIGNATURES = 20;
/** Svalin's newest NEAR transactions read per lookup; a Pro payment is found while its buyer waits. */
const NEAR_RECENT = 50;
const NEAR_BATCH = 20;

type TokenBalance = { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } };
type SolanaTransaction = {
  blockTime?: number | null;
  meta?: { err?: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
};

/**
 * Payments made with a Solana Pay reference. Each counts by how much USDC Svalin's own token
 * accounts gained in it, read from the balances before and after, so it does not matter how the
 * wallet built the transfer.
 */
export async function solanaPaymentsByReference(options: {
  rpcUrl: string;
  network: string;
  reference: string;
  payTo: string;
  mint: string;
  fetchImpl?: FetchLike;
}): Promise<FoundPayment[]> {
  const rpc = solanaRpc(options.rpcUrl, options.fetchImpl ?? callFetch);
  const signatures = await rpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [
    options.reference,
    { limit: SOLANA_SIGNATURES, commitment: "confirmed" },
  ]);
  const succeeded = (signatures ?? []).filter((entry) => entry.err === null && typeof entry.signature === "string");
  const transactions = await Promise.all(
    succeeded.map((entry) =>
      rpc<SolanaTransaction | null>("getTransaction", [
        entry.signature,
        { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]),
    ),
  );
  return succeeded.flatMap((entry, index) => {
    const transaction = transactions[index];
    if (!transaction?.meta || transaction.meta.err !== null || !transaction.blockTime) return [];
    const received = usdcReceived(transaction.meta, options.payTo, options.mint);
    return received > 0n
      ? [{ tx: entry.signature, network: options.network, atomic: received.toString(), at: transaction.blockTime * 1000 }]
      : [];
  });
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

type TxAccountPage = { account_txs?: { transaction_hash?: string; tx_block_timestamp?: string }[] };
type NearReceiptRecord = {
  receipt?: { receiver_id?: string };
  execution_outcome?: { outcome?: { logs?: string[]; status?: Record<string, unknown> } };
};
type NearTxRecord = { transaction?: { hash?: string }; execution_outcome?: { id?: string }; receipts?: NearReceiptRecord[] };

/**
 * USDC payments Svalin's NEAR account received recently, read from the FastNEAR transactions API.
 * Each counts by the token's own transfer events (NEP-141), net of any refund in the same
 * transaction, so a plain transfer, a transfer with a call and a relayed one all count the same.
 */
export async function nearPaymentsReceived(options: {
  txApiUrl: string;
  network: string;
  payTo: string;
  token: string;
  /** Payments before this time (ms) are skipped. */
  since: number;
  fetchImpl?: FetchLike;
}): Promise<FoundPayment[]> {
  const fetchImpl = options.fetchImpl ?? callFetch;
  const post = async <T>(path: string, body: object): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.txApiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "pro_lookup_error", chain: "near", path, error: String(error).slice(0, 200) }));
      throw new ApiError(502, "upstream_unavailable", "The NEAR network did not answer. Try again in a minute.");
    }
    if (!response.ok) {
      console.error(JSON.stringify({ level: "error", msg: "pro_lookup_error", chain: "near", path, status: response.status }));
      throw new ApiError(502, "upstream_error", "The NEAR network could not be read. Try again in a minute.");
    }
    return (await response.json()) as T;
  };

  const page = await post<TxAccountPage>("/v0/account", { account_id: options.payTo, is_event_log: true, is_success: true, limit: NEAR_RECENT });
  const times = new Map<string, number>();
  for (const entry of page.account_txs ?? []) {
    const at = Math.floor(Number(entry.tx_block_timestamp) / 1e6);
    if (entry.transaction_hash && Number.isFinite(at) && at >= options.since) times.set(entry.transaction_hash, at);
  }
  const hashes = [...times.keys()];
  const batches: string[][] = [];
  for (let start = 0; start < hashes.length; start += NEAR_BATCH) batches.push(hashes.slice(start, start + NEAR_BATCH));
  const records = (await Promise.all(batches.map((batch) => post<{ transactions?: NearTxRecord[] }>("/v0/transactions", { tx_hashes: batch }))))
    .flatMap((result) => result.transactions ?? []);

  return records.flatMap((record) => {
    const tx = record.execution_outcome?.id ?? record.transaction?.hash;
    const at = tx ? times.get(tx) : undefined;
    if (!tx || at === undefined) return [];
    const received = nearUsdcReceived(record.receipts ?? [], options.payTo, options.token);
    return received > 0n ? [{ tx, network: options.network, atomic: received.toString(), at }] : [];
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
