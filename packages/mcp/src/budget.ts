/**
 * Hard spend limits for the agent's wallet. Amounts are USDC atomic units (6 decimals),
 * which is what x402 PaymentRequirements carry for the USDC asset.
 */
export const USDC_DECIMALS = 6;

export function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Invalid USD amount: ${usd}`);
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

export function atomicToUsd(atomic: bigint): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}$${whole}${fraction ? `.${fraction.padEnd(2, "0")}` : ".00"}`;
}

export class SpendBudget {
  private spent = 0n;
  private calls = 0;

  constructor(
    readonly maxPerCall: bigint,
    readonly sessionCap: bigint,
  ) {}

  /** Returns a human-readable reason to refuse the payment, or null if it fits. */
  check(amount: bigint): string | null {
    if (amount > this.maxPerCall) {
      return `Price ${atomicToUsd(amount)} exceeds the per-call limit of ${atomicToUsd(this.maxPerCall)} (SVALIN_MAX_PRICE_USD).`;
    }
    if (this.spent + amount > this.sessionCap) {
      return `Paying ${atomicToUsd(amount)} would exceed the session budget of ${atomicToUsd(this.sessionCap)} (${atomicToUsd(this.spent)} already spent; SVALIN_BUDGET_USD).`;
    }
    return null;
  }

  commit(amount: bigint) {
    this.spent += amount;
    this.calls += 1;
  }

  status() {
    return {
      paidCalls: this.calls,
      spent: atomicToUsd(this.spent),
      remaining: atomicToUsd(this.sessionCap - this.spent),
      maxPerCall: atomicToUsd(this.maxPerCall),
      sessionCap: atomicToUsd(this.sessionCap),
    };
  }
}
