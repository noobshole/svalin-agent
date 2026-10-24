import type { ChainFamily, PortfolioAsset, PortfolioOverview } from "@svalin-agent/shared";

import type { RecipientSignals } from "../risk/check.js";

export interface PortfolioSource {
  /** Whether this source can serve addresses of the given family. */
  supports(family: ChainFamily): boolean;
  getOverview(wallet: string): Promise<PortfolioOverview>;
  /**
   * What the chain shows about a payment recipient (kind, age, activity) and, given the payer,
   * whom the payer recently paid and was paid by. Judged by `assessRecipient`.
   */
  inspectRecipient?(recipient: string, payer: string | null): Promise<RecipientSignals>;
}

type DraftAsset = Omit<PortfolioAsset, "allocationBps">;

/**
 * Drops dust, sorts by value, and assigns allocation in basis points so the
 * allocations of priced assets always sum to exactly 10,000 (largest-remainder).
 */
export function finaliseAssets(drafts: DraftAsset[], dustUsd = 0.01): {
  assets: PortfolioAsset[];
  totalValueUsd: number;
} {
  const priced = drafts
    .filter((asset) => asset.priceUsd !== null && asset.valueUsd >= dustUsd)
    .sort((left, right) => right.valueUsd - left.valueUsd);

  const total = priced.reduce((sum, asset) => sum + asset.valueUsd, 0);
  if (total === 0) return { assets: [], totalValueUsd: 0 };

  const raw = priced.map((asset) => (asset.valueUsd / total) * 10_000);
  const floors = raw.map(Math.floor);
  let remainder = 10_000 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((left, right) => right.frac - left.frac);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }

  return {
    assets: priced.map((asset, index) => ({
      ...asset,
      valueUsd: round(asset.valueUsd, 2),
      allocationBps: floors[index],
    })),
    totalValueUsd: round(total, 2),
  };
}

export function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Formats a raw integer token amount with `decimals` into a trimmed decimal string. */
export function formatUnits(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
