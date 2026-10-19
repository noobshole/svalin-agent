import { saleLoss, tokenGradeFor } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { checkEdition, sealEdition, sha256Hex } from "../src/ratings/edition.js";
import { marketCapUsd, rateNearTokens, top10Share } from "../src/ratings/near-tokens.js";
import { poolDepth, type NearPriceList, type RefPool } from "../src/sources/near-source.js";

const ONE_NEAR = 10n ** 24n;
const near = (amount: bigint) => (amount * ONE_NEAR).toString();

const prices: NearPriceList = {
  "wrap.near": { price: "5", decimal: 24, symbol: "wNEAR" },
  "deep.near": { price: "1", decimal: 18, symbol: "DEEP" },
  "thin.near": { price: "0.01", decimal: 18, symbol: "THIN" },
  "junk.near": { price: "48447", decimal: 18, symbol: "" },
  "zero.near": { price: "0", decimal: 18, symbol: "ZERO" },
};

const pools: RefPool[] = [
  // $250,000 of wNEAR behind DEEP, $2,000 behind THIN, junk only paired with junk.
  { token_account_ids: ["deep.near", "wrap.near"], amounts: ["1", near(50_000n)] },
  { token_account_ids: ["thin.near", "wrap.near"], amounts: ["1", near(400n)] },
  { token_account_ids: ["junk.near", "thin.near"], amounts: ["1", "1"] },
];

describe("NEAR token index", () => {
  it("grades by the trusted money in a token's pools, a $1,000 sale against it", () => {
    expect(tokenGradeFor(1_000_000)).toBe("A");
    expect(tokenGradeFor(250_000)).toBe("B");
    expect(tokenGradeFor(20_000)).toBe("C");
    expect(tokenGradeFor(3_000)).toBe("D");
    expect(tokenGradeFor(2_999)).toBe("F");
    expect(saleLoss(0)).toBe(1);
    expect(saleLoss(99_000)).toBeCloseTo(0.01);
  });

  it("rates every priced token except registry tokens, sorted by backing, with market data where known", () => {
    const stats = new Map([["deep.near", { fdvUsd: 10_000_000, top10Pct: 42.5, holders: 1200 }]]);
    const index = rateNearTokens(prices, poolDepth(pools, prices), stats, new Date("2026-10-19T00:00:00Z"));

    expect(index.rows).toEqual([
      ["deep.near", "DEEP", 1, 250_000, "B", 10_000_000, 42.5, 1200],
      ["thin.near", "THIN", 0.01, 2_000, "F", null, null, null],
      ["junk.near", "junk.near…", 48447, 0, "F", null, null, null],
    ]);
    expect(index.counts).toEqual({ A: 0, B: 1, C: 0, D: 0, F: 2 });
    expect(index.generatedAt).toBe("2026-10-19T00:00:00.000Z");
  });

  it("works out market cap at the quoted price from raw supply and decimals", () => {
    expect(marketCapUsd("1000000000000000000000000000", 18, 0.5)).toBe(500_000_000);
    expect(marketCapUsd("not a number", 18, 1)).toBeNull();
  });

  it("measures the top 10 holders outside pools, bridges, NEAR Intents and the token contract itself", () => {
    const holders = [
      { account_id: "v2.ref-finance.near", balance: "500" },
      { account_id: "token.near", balance: "200" },
      { account_id: "whale.near", balance: "150" },
      { account_id: "intents.near", balance: "100" },
      ...Array.from({ length: 12 }, (_, index) => ({ account_id: `holder${index}.near`, balance: "1" })),
    ];
    // whale + nine holders of 1 = 159 of 1,000.
    expect(top10Share("token.near", holders, "1000")).toBe(15.9);
    expect(top10Share("token.near", holders, "0")).toBeNull();
  });
});

describe("sealed editions", () => {
  const pricesText = JSON.stringify(prices);
  const poolsText = JSON.stringify(pools);
  const indexText = JSON.stringify(rateNearTokens(prices, poolDepth(pools, prices), new Map(), new Date("2026-10-19T00:00:00Z")));
  const edition = sealEdition({
    generatedAt: "2026-10-19T00:00:00.000Z",
    methodology: "near-token-backing-v0",
    code: { repository: "https://github.com/noobshole/svalin-agent", commit: "abc123" },
    files: {
      prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(pricesText) },
      pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(poolsText) },
      index: { path: "near-token-index.json", sha256: sha256Hex(indexText) },
    },
  });

  it("reproduces every grade from the archived inputs", () => {
    expect(edition.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(checkEdition(edition, { prices: pricesText, pools: poolsText, index: indexText })).toEqual({ ok: true, problems: [], checked: 3 });
  });

  it("catches a changed grade, a swapped input and an edited edition record", () => {
    const forged = indexText.replace('"thin.near","THIN",0.01,2000,"F"', '"thin.near","THIN",0.01,2000,"A"');
    expect(checkEdition(edition, { prices: pricesText, pools: poolsText, index: forged }).problems).toEqual([
      "index file does not match its SHA-256",
      "thin.near: published A ($2000), recomputed F ($2000)",
    ]);

    const swapped = JSON.stringify({ ...prices, "wrap.near": { price: "50", decimal: 24, symbol: "wNEAR" } });
    expect(checkEdition(edition, { prices: swapped, pools: poolsText, index: indexText }).ok).toBe(false);

    const backdated = { ...edition, generatedAt: "2026-10-01T00:00:00.000Z" };
    expect(checkEdition(backdated, { prices: pricesText, pools: poolsText, index: indexText }).problems).toEqual([
      "fingerprint does not match the edition's fields",
    ]);
  });
});
