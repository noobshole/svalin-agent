/**
 * Payments ledger. Every settled x402 payment is logged as a JSON line (so any log
 * drain can count payments) and, when Supabase is configured, inserted into
 * public.api_payments. Ledger failures never affect the API response.
 */
export type PaymentRecord = {
  route: string;
  network: string;
  payer: string | null;
  payTo: string;
  /** Atomic units of the payment asset (USDC has 6 decimals). */
  amount: string;
  asset: string;
  transaction: string;
  settledAt: string;
};

export interface PaymentLedger {
  record(entry: PaymentRecord): Promise<void>;
}

export class LogLedger implements PaymentLedger {
  async record(entry: PaymentRecord) {
    console.log(JSON.stringify({ level: "info", msg: "payment_settled", ...entry }));
  }
}

export class SupabaseLedger implements PaymentLedger {
  private readonly log = new LogLedger();

  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async record(entry: PaymentRecord) {
    await this.log.record(entry);
    try {
      const response = await this.fetchImpl(`${this.url.replace(/\/+$/, "")}/rest/v1/api_payments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          prefer: "return=minimal",
        },
        body: JSON.stringify({
          route: entry.route,
          network: entry.network,
          payer: entry.payer,
          pay_to: entry.payTo,
          amount_atomic: entry.amount,
          asset: entry.asset,
          transaction: entry.transaction,
          settled_at: entry.settledAt,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`supabase ${response.status}`);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "ledger_write_failed", error: String(error) }));
    }
  }
}
