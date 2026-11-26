import type { NearTokenIndex, RatedTokenRow } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { editionAnomaly } from "../src/ratings/edition-guard.js";

const row = (contract: string, backing: number, grade: RatedTokenRow[4]): RatedTokenRow => [contract, contract, 1, backing, grade, null, null, null];
/** An edition of `graded` tokens with $100K of backing each (grade B) and `junk` unbacked ones. */
const edition = (graded: number, junk: number, backingEach = 100_000): NearTokenIndex => ({
  generatedAt: "2026-10-26T00:00:00.000Z",
  methodology: "near-token-backing-v1",
  counts: { A: 0, B: graded, C: 0, D: 0, F: junk },
  rows: [
    ...Array.from({ length: graded }, (_, index) => row(`good-${index}.near`, backingEach, "B")),
    ...Array.from({ length: junk }, (_, index) => row(`junk-${index}.near`, 0, "F")),
  ],
});

describe("edition circuit breaker", () => {
  const before = edition(40, 4_000);

  it("lets a normal market move through", () => {
    expect(editionAnomaly(before, edition(37, 4_050, 90_000))).toBeNull();
  });

  it("refuses an edition that lost a third of its tokens, as when the price list comes back partial", () => {
    expect(editionAnomaly(before, edition(40, 2_000))).toMatch(/tokens priced fell/);
  });

  it("refuses an edition where most graded tokens dropped to F at once", () => {
    expect(editionAnomaly(before, edition(15, 4_025))).toMatch(/graded above F fell from 40 to 15/);
  });

  it("refuses an edition where most of the real money vanished or appeared at once", () => {
    expect(editionAnomaly(before, edition(40, 4_000, 30_000))).toMatch(/fell from \$4,000,000 to \$1,200,000/);
    expect(editionAnomaly(before, edition(40, 4_000, 400_000))).toMatch(/rose/);
  });

  it("leaves the registry tokens out, so their deep pools neither trip it nor hide a collapse", () => {
    const vetted = [row("wrap.near", 6_000_000, "A"), row("usdt.tether-token.near", 500_000, "B")];
    const withVetted = (index: NearTokenIndex): NearTokenIndex => ({ ...index, rows: [...vetted, ...index.rows] });
    // The first edition that grades them is not a sudden rise in real money.
    expect(editionAnomaly(before, withVetted(edition(40, 4_000)))).toBeNull();
    // And their $6.5M does not cover for the rest losing most of theirs.
    expect(editionAnomaly(withVetted(before), withVetted(edition(40, 4_000, 30_000)))).toMatch(/fell from \$4,000,000/);
  });
});
