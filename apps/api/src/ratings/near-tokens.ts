import { NEAR_SHARED_CUSTODY_ACCOUNTS, lookupToken } from "@svalin-agent/chain-config";
import { tokenGradeFor, type NearTokenIndex, type RatedTokenRow } from "@svalin-agent/shared";

import type { NearPriceList } from "../sources/near-source.js";

export const NEAR_TOKEN_METHODOLOGY = "near-token-backing-v0";

/** Market data for one token, looked up only for tokens with real backing. */
export type TokenStats = { fdvUsd: number | null; top10Pct: number | null; holders: number | null };

/**
 * Grades every NEAR token Ref Finance prices, except registry tokens (wNEAR, stablecoins, liquid
 * staking), which are the yardstick. `depth` is `poolDepth` over Ref's pools: the registry-token
 * value in each token's pools, the same figure Svalin's reports use to cap long-tail holdings.
 */
export function rateNearTokens(
  prices: NearPriceList,
  depth: ReadonlyMap<string, number>,
  stats: ReadonlyMap<string, TokenStats> = new Map(),
  now: Date = new Date(),
): NearTokenIndex {
  const rows: RatedTokenRow[] = [];

  for (const [contract, entry] of Object.entries(prices)) {
    const priceUsd = Number(entry.price);
    if (lookupToken("near", contract) || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const backingUsd = Math.round(depth.get(contract) ?? 0);
    const symbol = entry.symbol?.trim().slice(0, 24) || `${contract.slice(0, 10)}…`;
    const extra = stats.get(contract);
    rows.push([
      contract,
      symbol,
      Number(priceUsd.toPrecision(6)),
      backingUsd,
      tokenGradeFor(backingUsd),
      extra?.fdvUsd ?? null,
      extra?.top10Pct ?? null,
      extra?.holders ?? null,
    ]);
  }

  rows.sort((left, right) => right[3] - left[3] || left[0].localeCompare(right[0]));
  const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const row of rows) counts[row[4]] += 1;

  return { generatedAt: now.toISOString(), methodology: NEAR_TOKEN_METHODOLOGY, counts, rows };
}

/** Market cap at the quoted price: total supply (raw units) scaled by decimals, times price. */
export function marketCapUsd(totalSupplyRaw: string, decimals: number, priceUsd: number): number | null {
  const supply = Number(totalSupplyRaw) / 10 ** decimals;
  const value = supply * priceUsd;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Share of total supply held by the 10 largest holders, leaving out shared-custody accounts
 * (pools, bridges, NEAR Intents, lending) and the token's own contract, which hold on behalf of
 * others. `holders` is the largest-first list FastNEAR returns.
 */
export function top10Share(contract: string, holders: { account_id: string; balance: string }[], totalSupplyRaw: string): number | null {
  const supply = Number(totalSupplyRaw);
  if (!Number.isFinite(supply) || supply <= 0) return null;
  const top = holders.filter((holder) => holder.account_id !== contract && !NEAR_SHARED_CUSTODY_ACCOUNTS.has(holder.account_id)).slice(0, 10);
  const held = top.reduce((sum, holder) => sum + (Number(holder.balance) || 0), 0);
  return Math.min(100, Math.round((held / supply) * 1000) / 10);
}
