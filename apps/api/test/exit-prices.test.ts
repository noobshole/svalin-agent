import type { RatedTokenRow } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { tokenExit } from "../src/ratings/exit-prices.js";

const EDITION = { generatedAt: "2026-10-25T00:40:00.000Z", methodology: "near-token-backing-v1" };
const REF: RatedTokenRow = ["token.v2.ref-finance.near", "REF", 2, 100_000, "B", 5_000_000, 41.2, 12_000];

describe("exit prices", () => {
  it("quotes what $1K, $10K and $100K sales would fetch from the backing", () => {
    const { exit, grade, backingUsd } = tokenExit(REF, EDITION);
    expect({ grade, backingUsd }).toEqual({ grade: "B", backingUsd: 100_000 });
    expect(exit.quotes).toEqual([
      { saleUsd: 1_000, fetchesUsd: 990.1, lossPct: 0.99, exitPriceUsd: 1.9802 },
      { saleUsd: 10_000, fetchesUsd: 9_090.91, lossPct: 9.09, exitPriceUsd: 1.81818 },
      { saleUsd: 100_000, fetchesUsd: 50_000, lossPct: 50, exitPriceUsd: 1 },
    ]);
  });

  it("states the largest sales that lose at most 1% and 5%, and what the whole supply could fetch", () => {
    const { exit } = tokenExit(REF, EDITION);
    expect(exit.within1PctUsd).toBe(1_010.1);
    expect(exit.within5PctUsd).toBe(5_263.16);
    // A $5M market cap backed by $100K could never be sold for more than the backing.
    expect(exit.wholeSupplyUsd).toBe(98_039.22);
  });

  it("adds the caller's sale size in order, once", () => {
    expect(tokenExit(REF, EDITION, 25_000).exit.quotes.map((quote) => quote.saleUsd)).toEqual([1_000, 10_000, 25_000, 100_000]);
    expect(tokenExit(REF, EDITION, 10_000).exit.quotes).toHaveLength(3);
  });

  it("never fetches more than the backing, however large the sale", () => {
    const [quote] = tokenExit(REF, EDITION, 1e12).exit.quotes.slice(-1);
    expect(quote?.fetchesUsd).toBeLessThan(100_000);
  });

  it("fetches nothing for a token with no real backing", () => {
    const { exit } = tokenExit(["junk.near", "JUNK", 4.2, 0, "F", null, null, null], EDITION);
    expect(exit.quotes.every((quote) => quote.fetchesUsd === 0 && quote.lossPct === 100 && quote.exitPriceUsd === 0)).toBe(true);
    expect({ within1: exit.within1PctUsd, within5: exit.within5PctUsd, whole: exit.wholeSupplyUsd }).toEqual({ within1: 0, within5: 0, whole: 0 });
  });

  it("leaves the whole-supply value out when the supply is unknown", () => {
    expect(tokenExit(["thin.near", "THIN", 1, 5_000, "D", null, null, null], EDITION).exit.wholeSupplyUsd).toBeNull();
  });
});
