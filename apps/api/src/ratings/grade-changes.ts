import { tokenGradeFor, type GradeChangeReason, type GradeChanges, type NearTokenIndex } from "@svalin-agent/shared";

import { poolDepth, type NearPriceList, type RefDclPool, type RefPool } from "../sources/near-source.js";
import { exactReason, type BackingDetail } from "./backing-detail.js";
import type { BackingHistory } from "./near-tokens.js";

/**
 * The sealed edition a new one is compared with: its day, record fields, rows and archived prices,
 * and, from near-token-backing-v2, its backing history and detail.
 */
export type ComparedEdition = {
  day: string;
  generatedAt: string;
  fingerprint: string;
  methodology: string;
  index: Pick<NearTokenIndex, "rows">;
  prices: NearPriceList;
  history?: BackingHistory;
  detail?: BackingDetail;
};

/** This edition: its rows, methodology and time, and the archived inputs its backing came from. */
export type ThisEdition = {
  index: Pick<NearTokenIndex, "rows" | "methodology" | "generatedAt">;
  prices: NearPriceList;
  pools: RefPool[];
  dclPools: readonly RefDclPool[];
  history?: BackingHistory;
  detail?: BackingDetail;
};

/**
 * Gives every grade that changed since `previous` one reason (near-token-backing-v2), from two
 * what-ifs: the price alone moving (the earlier money at today's prices) and the money alone moving
 * (today's money at the earlier prices). Whichever alone lands on today's grade is the reason; when
 * both or neither do, it is both.
 *
 * With both editions' backing detail the what-ifs are exact: they use the very point each grade
 * was taken from inside its 24 hours, priced at that point's run (see `exactReason`). Where the
 * detail does not reach back that far (the trial's first days), the reason is estimated from this
 * edition's pools at both editions' prices, and marked `estimated`. A token whose backing cannot be
 * repriced that way (no trusted token priced in both editions) is put down to money. Every input
 * is archived with the two editions, so the reasons can be recomputed.
 */
export function gradeChanges(previous: ComparedEdition, current: ThisEdition): GradeChanges {
  const sameMethod = previous.methodology === current.index.methodology;
  const before = new Map(previous.index.rows.map((row) => [row[0], row] as const));
  const then = previous.history && previous.detail ? { history: previous.history, detail: previous.detail, at: Date.parse(previous.generatedAt) } : null;
  const now = current.history && current.detail ? { history: current.history, detail: current.detail, at: Date.parse(current.index.generatedAt) } : null;
  let atToday: Map<string, number> | undefined;
  let atThen: Map<string, number> | undefined;

  const tokens: GradeChanges["tokens"] = {};
  for (const [contract, , , backing, grade] of current.index.rows) {
    const earlier = before.get(contract);
    if (!earlier || earlier[4] === grade) continue;
    if (!sameMethod) {
      tokens[contract] = { from: earlier[4], to: grade, reason: "method" };
      continue;
    }
    const exact = then && now ? exactReason(contract, { ...then, backing: earlier[3] }, { ...now, grade }) : null;
    if (exact) {
      tokens[contract] = { from: earlier[4], to: grade, reason: exact };
      continue;
    }
    atToday ??= poolDepth(current.pools, current.prices, current.dclPools);
    atThen ??= poolDepth(current.pools, previous.prices, current.dclPools);
    tokens[contract] = {
      from: earlier[4],
      to: grade,
      reason: estimatedReason(earlier[3], backing, grade, atToday.get(contract), atThen.get(contract)),
      estimated: true,
    };
  }
  return {
    since: previous.day,
    sinceGeneratedAt: previous.generatedAt,
    sinceFingerprint: previous.fingerprint,
    sinceMethodology: previous.methodology,
    tokens,
  };
}

/**
 * The estimate: how much the move from the earlier prices to today's changes the value of today's
 * pools, applied to the backing each grade was given.
 */
function estimatedReason(backingThen: number, backingNow: number, gradeNow: string, depthToday = 0, depthThen = 0): GradeChangeReason {
  const repriced = depthToday > 0 && depthThen > 0;
  const priceRatio = repriced ? depthToday / depthThen : 1;
  const priceAlone = repriced && tokenGradeFor(Math.round(backingThen * priceRatio)) === gradeNow;
  const moneyAtThen = backingNow / priceRatio;
  const moneyAlone = tokenGradeFor(Math.round(moneyAtThen)) === gradeNow;
  if (priceAlone && !moneyAlone) return "price";
  if (moneyAlone && !priceAlone) return moneyAtThen < backingThen ? "money-out" : "money-in";
  return "price-and-money";
}
