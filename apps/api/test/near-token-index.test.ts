import { BACKING_HOLD_MS, saleLoss, tokenGradeFor } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { checkEdition, sealEdition, sha256Hex } from "../src/ratings/edition.js";
import { heldDepth, marketCapUsd, rateNearTokens, recordBacking, top10Share, type BackingHistory } from "../src/ratings/near-tokens.js";
import { poolDepth, type NearPriceList, type RefDclPool, type RefPool } from "../src/sources/near-source.js";

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
    // A guard checks the real trade: $50,000 into $100,000 of backing loses about a third.
    expect(saleLoss(100_000, 50_000)).toBeCloseTo(1 / 3);
  });

  it("counts the trusted side of Ref's concentrated-liquidity pools as backing", () => {
    const dcl: RefDclPool[] = [
      // $20,000 of wNEAR behind THIN on top of its $2,000 classic pool; a stopped pool is ignored.
      { token_x: "thin.near", token_y: "wrap.near", total_x: "1", total_y: near(4_000n), state: "Running" },
      { token_x: "wrap.near", token_y: "thin.near", total_x: near(10_000n), total_y: "1", state: "Paused" },
      // Two unvetted tokens paired with each other add nothing.
      { token_x: "junk.near", token_y: "thin.near", total_x: "5", total_y: "5" },
    ];
    const depth = poolDepth(pools, prices, dcl);
    expect(depth.get("thin.near")).toBe(22_000);
    expect(depth.has("junk.near")).toBe(false);
    expect(tokenGradeFor(depth.get("thin.near") ?? 0)).toBe("C");
  });

  it("grades backing only once it has held for 24 hours, at its lowest in that time", () => {
    const day = BACKING_HOLD_MS;
    const t0 = Date.parse("2026-10-20T00:00:00Z");
    const depthAt = (deep: number, fresh = 0) => new Map([["deep.near", deep], ["fresh.near", fresh]]);

    // First v1 edition: no history, so existing backing counts straight away.
    let history = recordBacking(null, depthAt(250_000), t0);
    expect(heldDepth(history, t0).get("deep.near")).toBe(250_000);

    // A token whose pool appears later waits a full day; DEEP is graded at its low point.
    history = recordBacking(history, depthAt(40_000, 500_000), t0 + day / 2);
    expect(heldDepth(history, t0 + day / 2)).toEqual(new Map([["deep.near", 40_000]]));
    history = recordBacking(history, depthAt(260_000, 500_000), t0 + day + day / 2);
    expect(heldDepth(history, t0 + day + day / 2)).toEqual(new Map([["deep.near", 40_000], ["fresh.near", 500_000]]));

    // Backing that disappears starts the clock again when it comes back.
    history = recordBacking(history, depthAt(260_000, 0), t0 + 2 * day);
    history = recordBacking(history, depthAt(260_000, 500_000), t0 + 2 * day + 1);
    expect(heldDepth(history, t0 + 2 * day + 1).has("fresh.near")).toBe(false);
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
    // Burned tokens are nobody's: the all-zero account does not count as a holder.
    expect(top10Share("token.near", [{ account_id: "0".repeat(64), balance: "900" }, ...holders], "1000")).toBe(15.9);
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

describe("sealed editions with DCL pools and the 24-hour hold", () => {
  const generatedAt = "2026-10-22T12:00:00.000Z";
  const now = Date.parse(generatedAt);
  const dcl: RefDclPool[] = [{ token_x: "thin.near", token_y: "wrap.near", total_x: "1", total_y: near(4_000n), state: "Running" }];
  const current = poolDepth(pools, prices, dcl);
  // DEEP has had backing for days; THIN's DCL pool is a few hours old, so it is still graded on 0.
  const previous: BackingHistory = {
    "deep.near": { since: now - 5 * BACKING_HOLD_MS, points: [[now - 3_600_000, 260_000]] },
    "thin.near": { since: now - 3_600_000, points: [[now - 3_600_000, 2_000]] },
  };
  const history = recordBacking(previous, current, now);
  const files = {
    prices: JSON.stringify(prices),
    pools: JSON.stringify(pools),
    dclPools: JSON.stringify(dcl),
    history: JSON.stringify(history),
    index: JSON.stringify(rateNearTokens(prices, heldDepth(history, now), new Map(), new Date(now))),
  };
  const fields = {
    generatedAt,
    methodology: "near-token-backing-v1",
    code: { repository: "https://github.com/noobshole/svalin-agent", commit: "abc123" },
    files: {
      prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(files.prices) },
      pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(files.pools) },
      index: { path: "near-token-index.json", sha256: sha256Hex(files.index) },
      dclPools: { path: "inputs/dcl-pools.json.gz", sha256: sha256Hex(files.dclPools) },
      history: { path: "inputs/history.json.gz", sha256: sha256Hex(files.history) },
    },
  };
  const edition = sealEdition(fields);

  it("reproduces every grade, including the hold, and keeps older fingerprints unchanged", () => {
    expect(checkEdition(edition, files)).toEqual({ ok: true, problems: [], checked: 3 });
    const published = JSON.parse(files.index) as { rows: [string, string, number, number, string][] };
    expect(published.rows.find((row) => row[0] === "deep.near")?.slice(3, 5)).toEqual([250_000, "B"]);
    expect(published.rows.find((row) => row[0] === "thin.near")?.slice(3, 5)).toEqual([0, "F"]);

    // Editions without the new files are fingerprinted exactly as before, so sealed v0 editions still verify.
    const { dclPools: _dcl, history: _history, ...v0Files } = fields.files;
    const v0 = { generatedAt, methodology: "near-token-backing-v0", code: fields.code, files: v0Files };
    expect(sealEdition(v0).fingerprint).toBe(sha256Hex(JSON.stringify(v0)));
  });

  it("catches a history that skips the hold or does not match the inputs", () => {
    // Backdating THIN's start and dropping its earlier low reading would lift it to C.
    const skipped = JSON.stringify({ ...history, "thin.near": { since: now - 2 * BACKING_HOLD_MS, points: [[now, 22_000]] } });
    const forged = { ...files, history: skipped };
    const result = checkEdition(sealEdition({ ...fields, files: { ...fields.files, history: { ...fields.files.history, sha256: sha256Hex(skipped) } } }), forged);
    expect(result.problems).toEqual(["thin.near: published F ($0), recomputed C ($22000)"]);

    const inflated = JSON.stringify({ ...history, "deep.near": { since: 0, points: [[now, 900_000]] } });
    const lying = checkEdition(edition, { ...files, history: inflated });
    expect(lying.problems).toContain("history file does not match its SHA-256");
    expect(lying.problems).toContain("deep.near: history does not end with this edition's backing ($250000)");
  });
});
