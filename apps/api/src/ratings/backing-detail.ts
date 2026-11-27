import { BACKING_HOLD_MS, tokenGradeFor, type GradeChangeReason, type TokenGrade } from "@svalin-agent/shared";

import { registryPrices, type NearPriceList } from "../sources/near-source.js";
import type { BackingHistory } from "./near-tokens.js";

/**
 * The backing history's detail, from near-token-backing-v2: for every point, how much of each trusted
 * token backed the token (in whole tokens), and each run's prices for the trusted tokens. With it, a
 * grade change splits into price and money exactly, including inside the 24-hour hold, where the
 * backing a grade uses may be hours old and was priced at that hour's prices. Archived and hashed
 * with each edition, beside the history (Node scripts only).
 */
export type TrustedAmounts = Record<string, number>;

export type BackingDetail = {
  /** Run time in ms (as a key) → trusted token → USD price. */
  prices: Record<string, Record<string, number>>;
  /** Token → [run time in ms, trusted amounts], one per point of its history that has detail. */
  amounts: Record<string, [number, TrustedAmounts][]>;
};

/** Ten significant digits: far finer than a grade band, and the same everywhere it is recomputed. */
const exact = (value: number) => Number(value.toPrecision(10));

function rounded(amounts: TrustedAmounts | undefined): TrustedAmounts {
  return Object.fromEntries(
    Object.entries(amounts ?? {})
      .filter(([, units]) => units > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([token, units]) => [token, exact(units)]),
  );
}

/** The USD value of trusted amounts at one run's prices. */
export function valueAt(amounts: TrustedAmounts, prices: Record<string, number>): number {
  return Object.entries(amounts).reduce((sum, [token, units]) => sum + units * (prices[token] ?? 0), 0);
}

/**
 * Adds this run's amounts and prices to the detail, keeping only what the new history still holds:
 * the same tokens and the same points. Points from before the detail was kept (v2's first day,
 * seeded from v1's history) have none.
 */
export function recordDetail(
  previous: BackingDetail | null,
  history: BackingHistory,
  amountsNow: ReadonlyMap<string, TrustedAmounts>,
  prices: NearPriceList,
  now: number,
): BackingDetail {
  const amounts: BackingDetail["amounts"] = {};
  const times = new Set<number>();
  for (const [contract, { points }] of Object.entries(history)) {
    const kept = new Set(points.map(([at]) => at));
    const older = (previous?.amounts[contract] ?? []).filter(([at]) => at < now && kept.has(at));
    for (const [at] of older) times.add(at);
    amounts[contract] = [...older, [now, rounded(amountsNow.get(contract))]];
  }
  const kept: BackingDetail["prices"] = {};
  for (const at of [...times].sort((left, right) => left - right)) {
    const entry = previous?.prices[String(at)];
    if (entry) kept[String(at)] = entry;
  }
  kept[String(now)] = registryPrices(prices);
  return { prices: kept, amounts };
}

/**
 * Checks the detail against the history and this edition's inputs: this run's prices are the
 * archived prices, the newest point of every token holds exactly the amounts the archived pools
 * give, and every point is worth, at its run's prices, the backing its history records.
 */
export function detailProblems(
  detail: BackingDetail,
  history: BackingHistory,
  amountsNow: ReadonlyMap<string, TrustedAmounts>,
  prices: NearPriceList,
  now: number,
): string[] {
  const problems: string[] = [];
  if (JSON.stringify(detail.prices[String(now)] ?? null) !== JSON.stringify(registryPrices(prices))) {
    problems.push("backing detail: this run's prices are not the archived prices");
  }
  for (const contract of Object.keys(detail.amounts)) {
    if (!history[contract]) problems.push(`${contract}: backing detail for a token the history does not hold`);
  }
  for (const [contract, { points }] of Object.entries(history)) {
    const entries = detail.amounts[contract] ?? [];
    const newest = entries.at(-1);
    if (!newest || newest[0] !== now || JSON.stringify(newest[1]) !== JSON.stringify(rounded(amountsNow.get(contract)))) {
      problems.push(`${contract}: backing detail does not end with the amounts in this edition's pools`);
      continue;
    }
    const usdAt = new Map(points.map(([at, usd]) => [at, usd]));
    for (const [at, amounts] of entries) {
      const usd = usdAt.get(at);
      const runPrices = detail.prices[String(at)];
      if (usd === undefined || !runPrices || Math.abs(valueAt(amounts, runPrices) - usd) > 1) {
        problems.push(`${contract}: backing detail at ${new Date(at).toISOString()} does not match its history`);
        break;
      }
    }
  }
  return problems.slice(0, 20);
}

/** One edition's side of an exact reason: its history, its detail and its time. */
export type DetailedSide = { history: BackingHistory; detail: BackingDetail; at: number };

/**
 * The exact reason for one grade change, or null when the detail does not reach far enough (a point
 * from before it was kept). Two what-ifs over the runs each grade comes from:
 * - price alone: the earlier money (the point the earlier grade used) at the prices of every run
 *   in today's 24 hours;
 * - money alone: the money of every point in today's 24 hours at the earlier prices (0 while the
 *   backing is still in its first 24 hours, as the grade has it).
 * Each takes the lowest value, as the grade does. Whichever alone lands on today's grade is the reason.
 */
export function exactReason(
  contract: string,
  then: DetailedSide & { backing: number },
  now: DetailedSide & { grade: TokenGrade },
): GradeChangeReason | null {
  // The earlier money and prices: the point the earlier grade used, or no money if it was graded on 0.
  let earlierMoney: TrustedAmounts = {};
  let earlierPrices = then.detail.prices[String(then.at)];
  if (then.backing > 0) {
    const used = then.history[contract]?.points.find(([at, usd]) => then.at - at <= BACKING_HOLD_MS && usd === then.backing);
    const amounts = used ? then.detail.amounts[contract]?.find(([at]) => at === used[0])?.[1] : undefined;
    if (!used || !amounts) return null;
    earlierMoney = amounts;
    earlierPrices = then.detail.prices[String(used[0])];
  }
  if (!earlierPrices) return null;

  // Every run in today's 24 hours, whether or not this token had backing in it.
  const runs = Object.keys(now.detail.prices)
    .map(Number)
    .filter((at) => at <= now.at && now.at - at <= BACKING_HOLD_MS);
  if (!runs.includes(now.at)) return null;
  const priceAlone = Math.min(...runs.map((at) => valueAt(earlierMoney, now.detail.prices[String(at)])));

  let moneyAlone = 0;
  const entry = now.history[contract];
  if (entry && now.at - entry.since >= BACKING_HOLD_MS) {
    const points = entry.points.filter(([at]) => now.at - at <= BACKING_HOLD_MS);
    const values: number[] = [];
    for (const [at] of points) {
      const amounts = now.detail.amounts[contract]?.find(([time]) => time === at)?.[1];
      if (!amounts) return null;
      values.push(valueAt(amounts, earlierPrices));
    }
    moneyAlone = values.length > 0 ? Math.min(...values) : 0;
  }

  const byPrice = tokenGradeFor(Math.round(priceAlone)) === now.grade;
  const byMoney = tokenGradeFor(Math.round(moneyAlone)) === now.grade;
  if (byPrice && !byMoney) return "price";
  if (byMoney && !byPrice) return moneyAlone < then.backing ? "money-out" : "money-in";
  return "price-and-money";
}
