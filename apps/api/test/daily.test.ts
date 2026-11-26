import { tokenDailySchema, type NearTokenIndex, type RatedTokenRow } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { addToDaily } from "../src/ratings/daily.js";

const row = (contract: string, price: number, backing: number): RatedTokenRow => [contract, contract, price, backing, "F", null, null, null];
const edition = (generatedAt: string, rows: RatedTokenRow[]): NearTokenIndex => ({
  generatedAt,
  methodology: "near-token-backing-v1",
  counts: { A: 0, B: 0, C: 0, D: 0, F: rows.length },
  rows,
});

describe("the daily file behind the ratings page's charts", () => {
  it("keeps one point a day per token, the day's latest edition, with a gap where a token was missing", () => {
    let daily = addToDaily(null, edition("2026-11-24T01:00:00.000Z", [row("a.near", 0.123456, 5_000)]));
    daily = addToDaily(daily, edition("2026-11-25T01:00:00.000Z", [row("a.near", 0.2, 6_000), row("b.near", 3, 0)]));
    // A later edition the same day replaces that day's point.
    daily = addToDaily(daily, edition("2026-11-25T20:00:00.000Z", [row("a.near", 0.25, 6_500), row("b.near", 3, 0)]));
    daily = addToDaily(daily, edition("2026-11-26T01:00:00.000Z", [row("b.near", 3.5, 100)]));

    expect(tokenDailySchema.parse(daily)).toEqual({
      generatedAt: "2026-11-26T01:00:00.000Z",
      days: ["2026-11-24", "2026-11-25", "2026-11-26"],
      tokens: {
        // Prices keep four significant digits; a token gone from today's edition has no point today.
        "a.near": [
          [0.1235, 0.25, null],
          [5_000, 6_500, null],
        ],
        "b.near": [
          [null, 3, 3.5],
          [null, 0, 100],
        ],
      },
    });
  });

  it("drops days past the window, and tokens with no point left in it", () => {
    let daily = addToDaily(null, edition("2026-11-01T00:00:00.000Z", [row("old.near", 1, 10), row("kept.near", 2, 20)]), 2);
    daily = addToDaily(daily, edition("2026-11-02T00:00:00.000Z", [row("kept.near", 2, 30)]), 2);
    daily = addToDaily(daily, edition("2026-11-03T00:00:00.000Z", [row("kept.near", 4, 40)]), 2);
    expect(daily.days).toEqual(["2026-11-02", "2026-11-03"]);
    expect(daily.tokens).toEqual({
      "kept.near": [
        [2, 4],
        [30, 40],
      ],
    });
  });
});
