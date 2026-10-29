import { NEAR_BURN_ACCOUNTS, NEAR_SHARED_CUSTODY_ACCOUNTS, lookupToken } from "@svalin-agent/chain-config";
import { BACKING_HOLD_MS, tokenGradeFor, type NearTokenIndex, type RatedTokenRow } from "@svalin-agent/shared";

import { onChainLabel } from "../lib/text.js";
import type { NearPriceList } from "../sources/near-source.js";

/** v1 counts Ref's concentrated-liquidity pools and grades only backing that has held for 24 hours. */
export const NEAR_TOKEN_METHODOLOGY = "near-token-backing-v1";

/**
 * Per token with backing: since when it has had backing without a break, and the backing seen in
 * each edition within the hold window, as [time in ms, USD].
 */
export type BackingHistory = Record<string, { since: number; points: [number, number][] }>;

/**
 * Adds this edition's backing to the history. A token without backing drops out, so backing that
 * appears or comes back starts its 24 hours again. With no earlier history (the first v1 edition),
 * every token that has backing counts as established.
 */
export function recordBacking(previous: BackingHistory | null, depth: ReadonlyMap<string, number>, now: number): BackingHistory {
  const history: BackingHistory = {};
  for (const [contract, usd] of depth) {
    const backing = Math.round(usd);
    if (backing <= 0) continue;
    const prior = previous?.[contract];
    history[contract] = {
      since: prior ? prior.since : previous === null ? 0 : now,
      points: [...(prior?.points ?? []).filter(([at]) => at < now && now - at <= BACKING_HOLD_MS), [now, backing]],
    };
  }
  return history;
}

/**
 * The backing each token is graded on: the lowest value seen over the last 24 hours, or 0 if its
 * backing appeared less than 24 hours ago. A pool added this morning cannot lift a grade today.
 */
export function heldDepth(history: BackingHistory, now: number): Map<string, number> {
  const held = new Map<string, number>();
  for (const [contract, { since, points }] of Object.entries(history)) {
    if (now - since < BACKING_HOLD_MS) continue;
    const recent = points.filter(([at]) => now - at <= BACKING_HOLD_MS).map(([, usd]) => usd);
    if (recent.length > 0) held.set(contract, Math.min(...recent));
  }
  return held;
}

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
    // Agents read the Index too: a symbol written as instructions is shown as [hidden name].
    const symbol = onChainLabel(entry.symbol, 24) ?? `${contract.slice(0, 10)}…`;
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
 * others, and burn addresses, whose tokens are gone. `holders` is the largest-first list FastNEAR
 * returns.
 */
export function top10Share(contract: string, holders: { account_id: string; balance: string }[], totalSupplyRaw: string): number | null {
  const supply = Number(totalSupplyRaw);
  if (!Number.isFinite(supply) || supply <= 0) return null;
  const top = holders
    .filter(
      (holder) =>
        holder.account_id !== contract && !NEAR_SHARED_CUSTODY_ACCOUNTS.has(holder.account_id) && !NEAR_BURN_ACCOUNTS.has(holder.account_id),
    )
    .slice(0, 10);
  const held = top.reduce((sum, holder) => sum + (Number(holder.balance) || 0), 0);
  return Math.min(100, Math.round((held / supply) * 1000) / 10);
}
