import type { NearTokenIndex, RatedTokenRow } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { gradeMigration } from "../src/ratings/track-record.js";

const row = (contract: string, backing: number, grade: RatedTokenRow[4]): RatedTokenRow => [contract, contract, 1, backing, grade, null, null, null];
const edition = (generatedAt: string, rows: RatedTokenRow[]): NearTokenIndex => ({
  generatedAt,
  methodology: "near-token-backing-v1",
  counts: { A: 0, B: 0, C: 0, D: 0, F: 0 },
  rows,
});

describe("track record", () => {
  it("counts how grades moved, including tokens that lost all backing or left the Index", () => {
    const then = edition("2026-10-18T00:40:00.000Z", [
      row("steady.near", 150_000, "B"),
      row("rising.near", 25_000, "C"),
      row("falling.near", 25_000, "C"),
      row("rugged.near", 5_000, "D"),
      row("vanished.near", 4_000, "D"),
      row("junk.near", 0, "F"),
    ]);
    const now = edition("2026-10-25T00:40:00.000Z", [
      row("steady.near", 140_000, "B"),
      row("rising.near", 120_000, "B"),
      row("falling.near", 2_000, "F"),
      row("rugged.near", 0, "F"),
      row("junk.near", 0, "F"),
      row("new.near", 9_000, "D"),
    ]);

    const migration = gradeMigration(then, now, 7, "2026-10-18");
    expect(migration).toMatchObject({ days: 7, tokens: 6, upgraded: 1, downgraded: 2, unchanged: 2, gone: 1, lostAllBacking: 2 });
    expect(migration.matrix.C).toEqual({ A: 0, B: 1, C: 0, D: 0, F: 1, gone: 0 });
    expect(migration.matrix.D).toEqual({ A: 0, B: 0, C: 0, D: 0, F: 1, gone: 1 });
  });
});
