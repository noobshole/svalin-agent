import type { NearTokenIndex, RatedTokenRow } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { detailProblems, recordDetail, type BackingDetail } from "../src/ratings/backing-detail.js";
import { NearRpc, readChainDclPools, readChainPools } from "../src/ratings/chain-pools.js";
import { checkEdition, sealEdition, sha256Hex } from "../src/ratings/edition.js";
import { gradeChanges, type ComparedEdition } from "../src/ratings/grade-changes.js";
import { contractOfAsset, impliedGrade, intentsQuotes, quoteDisagrees } from "../src/ratings/intents-quotes.js";
import {
  NEAR_TOKEN_METHODOLOGY,
  NEAR_TOKEN_METHODOLOGY_V2,
  heldDepth,
  rateNearTokens,
  recordBacking,
  type BackingHistory,
} from "../src/ratings/near-tokens.js";
import { compareMethods } from "../src/ratings/trial.js";
import { poolBackingAmounts, poolDepth, type NearPriceList, type RefPool } from "../src/sources/near-source.js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const near = (amount: number) => (BigInt(amount) * 10n ** 24n).toString();
const usdc = (amount: number) => (BigInt(amount) * 10n ** 6n).toString();
const token = (symbol: string) => ({ price: "1", decimal: 18, symbol });

const pricesThen: NearPriceList = {
  "wrap.near": { price: "5", decimal: 24, symbol: "wNEAR" },
  [USDC]: { price: "1", decimal: 6, symbol: "USDC" },
  "price.near": token("PRICE"),
  "out.near": token("OUT"),
  "in.near": token("IN"),
  "both.near": token("BOTH"),
  "same.near": token("SAME"),
};
// NEAR falls from $5 to $4 overnight; a new token is listed.
const pricesNow: NearPriceList = { ...pricesThen, "wrap.near": { price: "4", decimal: 24, symbol: "wNEAR" }, "new.near": token("NEW") };

const poolsThen: RefPool[] = [
  { token_account_ids: ["price.near", "wrap.near"], amounts: ["1", near(22_000)] }, // $110,000: B
  { token_account_ids: ["out.near", USDC], amounts: ["1", usdc(120_000)] }, // B
  { token_account_ids: ["in.near", USDC], amounts: ["1", usdc(2_000)] }, // F
  { token_account_ids: ["both.near", "wrap.near"], amounts: ["1", near(22_000)] }, // $110,000: B
  { token_account_ids: ["same.near", "wrap.near"], amounts: ["1", near(500_000)] }, // A
];
const poolsNow: RefPool[] = [
  { token_account_ids: ["price.near", "wrap.near"], amounts: ["1", near(22_000)] }, // same NEAR, now $88,000: C
  { token_account_ids: ["out.near", USDC], amounts: ["1", usdc(50_000)] }, // money left: C
  { token_account_ids: ["in.near", USDC], amounts: ["1", usdc(25_000)] }, // money came in: C
  { token_account_ids: ["both.near", "wrap.near"], amounts: ["1", near(17_000)] }, // $68,000: C either way
  { token_account_ids: ["same.near", "wrap.near"], amounts: ["1", near(500_000)] }, // still A
  { token_account_ids: ["new.near", USDC], amounts: ["1", usdc(40_000)] },
];

const thenAt = new Date("2026-12-04T00:17:00.000Z");
const nowAt = new Date("2026-12-05T00:17:00.000Z");
const indexThen = rateNearTokens(pricesThen, poolDepth(poolsThen, pricesThen), new Map(), thenAt, NEAR_TOKEN_METHODOLOGY_V2);
const ratedNow = rateNearTokens(pricesNow, poolDepth(poolsNow, pricesNow), new Map(), nowAt, NEAR_TOKEN_METHODOLOGY_V2);
const code = { repository: "https://github.com/noobshole/svalin-agent", commit: "abc123" };

const previousFiles = { prices: JSON.stringify(pricesThen), pools: JSON.stringify(poolsThen), index: JSON.stringify(indexThen) };
const previousEdition = sealEdition({
  generatedAt: thenAt.toISOString(),
  methodology: NEAR_TOKEN_METHODOLOGY_V2,
  code,
  files: {
    prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(previousFiles.prices) },
    pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(previousFiles.pools) },
    index: { path: "near-token-index.json", sha256: sha256Hex(previousFiles.index) },
  },
  block: { height: 226_000_000, hash: "Then1111" },
});
const compared: ComparedEdition = {
  day: "2026-12-04",
  generatedAt: previousEdition.generatedAt,
  fingerprint: previousEdition.fingerprint,
  methodology: previousEdition.methodology,
  index: indexThen,
  prices: pricesThen,
};

describe("why a grade changed (near-token-backing-v2)", () => {
  const changes = gradeChanges(compared, { index: ratedNow, prices: pricesNow, pools: poolsNow, dclPools: [] });

  it("gives each change one reason: the price, money leaving or coming in, or both (estimated without backing detail)", () => {
    expect(changes.tokens).toEqual({
      "price.near": { from: "B", to: "C", reason: "price", estimated: true },
      "out.near": { from: "B", to: "C", reason: "money-out", estimated: true },
      "in.near": { from: "F", to: "C", reason: "money-in", estimated: true },
      "both.near": { from: "B", to: "C", reason: "price-and-money", estimated: true },
    });
    expect(changes).toMatchObject({ since: "2026-12-04", sinceFingerprint: previousEdition.fingerprint, sinceMethodology: NEAR_TOKEN_METHODOLOGY_V2 });
  });

  it("leaves out unchanged grades and tokens new to the Index, and says 'method' across methodologies", () => {
    expect(changes.tokens["same.near"]).toBeUndefined();
    expect(changes.tokens["new.near"]).toBeUndefined();
    const acrossMethods = gradeChanges({ ...compared, methodology: NEAR_TOKEN_METHODOLOGY }, { index: ratedNow, prices: pricesNow, pools: poolsNow, dclPools: [] });
    expect(Object.values(acrossMethods.tokens).map((change) => change.reason)).toEqual(["method", "method", "method", "method"]);
  });
});

describe("sealed v2 editions", () => {
  const block = { height: 226_427_095, hash: "Now22222" };
  const changes = gradeChanges(compared, { index: ratedNow, prices: pricesNow, pools: poolsNow, dclPools: [] });
  const indexOf = (extra: object) => JSON.stringify({ ...ratedNow, provenance: { code, inputs: { pricesSha256: "0".repeat(64), poolsSha256: "0".repeat(64) }, block }, ...extra });
  const seal = (indexText: string, sealedBlock = block) =>
    sealEdition({
      generatedAt: nowAt.toISOString(),
      methodology: NEAR_TOKEN_METHODOLOGY_V2,
      code,
      files: {
        prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(JSON.stringify(pricesNow)) },
        pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(JSON.stringify(poolsNow)) },
        index: { path: "near-token-index.json", sha256: sha256Hex(indexText) },
      },
      block: sealedBlock,
    });
  const indexText = indexOf({ changes });
  const files = { prices: JSON.stringify(pricesNow), pools: JSON.stringify(poolsNow), index: indexText };
  const previous = { edition: previousEdition, index: previousFiles.index, prices: previousFiles.prices };

  it("pins the block in the fingerprint, and recomputes the reasons from both editions", () => {
    expect(seal(indexText).fingerprint).not.toBe(seal(indexText, { ...block, height: block.height + 1 }).fingerprint);
    expect(checkEdition(seal(indexText), { ...files, previous })).toEqual({ ok: true, problems: [], checked: ratedNow.rows.length });
  });

  it("says when the reasons could not be checked, and catches a wrong reason or a mismatched block", () => {
    const unchecked = checkEdition(seal(indexText), files);
    expect(unchecked.ok).toBe(true);
    expect(unchecked.notes).toEqual(["grade changes since 2026-12-04 not checked: give that sealed edition with --previous"]);

    const blamed = indexOf({ changes: { ...changes, tokens: { ...changes.tokens, "out.near": { from: "B", to: "C", reason: "price" } } } });
    expect(checkEdition(seal(blamed), { ...files, index: blamed, previous }).problems).toEqual([
      "out.near: change published as B→C (price), recomputed as B→C (money-out, estimated)",
    ]);

    expect(checkEdition(seal(indexText, { ...block, hash: "Other333" }), { ...files, previous }).problems).toContain(
      "the index and the edition record name different blocks",
    );
    expect(checkEdition(seal(indexText), { ...files, previous: { ...previous, prices: JSON.stringify(pricesNow) } }).problems).toEqual([
      "the previous prices file does not match its SHA-256",
    ]);
  });
});

describe("exact reasons from the backing detail", () => {
  const HOUR = 60 * 60 * 1000;
  const priced = (nearUsd: number): NearPriceList => ({
    "wrap.near": { price: String(nearUsd), decimal: 24, symbol: "wNEAR" },
    "held.near": token("HELD"),
    "gone.near": token("GONE"),
  });
  const pools = (goneNear: number): RefPool[] => [
    { token_account_ids: ["held.near", "wrap.near"], amounts: ["1", near(22_000)] }, // the same money every run
    ...(goneNear > 0 ? [{ token_account_ids: ["gone.near", "wrap.near"], amounts: ["1", near(goneNear)] }] : []),
  ];
  type Run = { history: BackingHistory; detail: BackingDetail; index: NearTokenIndex; prices: NearPriceList; pools: RefPool[] };
  const run = (before: Run | null, at: number, nearUsd: number, goneNear: number, keepDetail = true): Run => {
    const prices = priced(nearUsd);
    const runPools = pools(goneNear);
    const history = recordBacking(before?.history ?? null, poolDepth(runPools, prices), at);
    const detail = recordDetail(keepDetail ? (before?.detail ?? null) : null, history, poolBackingAmounts(runPools, prices), prices, at);
    const index = rateNearTokens(prices, heldDepth(history, at), new Map(), new Date(at), NEAR_TOKEN_METHODOLOGY_V2);
    return { history, detail, index, prices, pools: runPools };
  };
  // NEAR is $4 six hours before the earlier edition and $5 from then on; HELD's pool never changes.
  // The earlier grade comes from the $4 run inside its 24 hours ($88,000: C), today's from $5 ($110,000: B).
  // GONE's pool is emptied between the editions.
  const t1 = thenAt.getTime();
  const t3 = nowAt.getTime();
  const r0 = run(null, t1 - 6 * HOUR, 4, 30_000);
  const r1 = run(r0, t1, 5, 30_000);
  const r2 = run(r1, t3 - 6 * HOUR, 5, 1_000);
  const r3 = run(r2, t3, 5, 1_000);
  const comparedRun = (from: Run, detailed = true): ComparedEdition => ({
    ...compared,
    generatedAt: from.index.generatedAt,
    index: from.index,
    prices: from.prices,
    ...(detailed ? { history: from.history, detail: from.detail } : {}),
  });

  it("puts a change inside the 24-hour hold down to price when only the price moved, where the estimate says money", () => {
    const grade = (from: Run, contract: string) => from.index.rows.find((row) => row[0] === contract)?.[4];
    expect([grade(r1, "held.near"), grade(r3, "held.near")]).toEqual(["C", "B"]);
    const current = { index: r3.index, prices: r3.prices, pools: r3.pools, dclPools: [], history: r3.history, detail: r3.detail };
    expect(gradeChanges(comparedRun(r1), current).tokens).toEqual({
      "held.near": { from: "C", to: "B", reason: "price" },
      "gone.near": { from: "B", to: "D", reason: "money-out" },
    });
    // Without the earlier edition's detail, today's pools at both editions' prices see no price move.
    expect(gradeChanges(comparedRun(r1, false), current).tokens["held.near"]).toEqual({ from: "C", to: "B", reason: "money-in", estimated: true });
  });

  it("falls back to the estimate when the detail does not reach the point the earlier grade used", () => {
    const shortDetail = { ...r1, detail: run(r0, t1, 5, 30_000, false).detail };
    const current = { index: r3.index, prices: r3.prices, pools: r3.pools, dclPools: [], history: r3.history, detail: r3.detail };
    expect(gradeChanges(comparedRun(shortDetail), current).tokens["held.near"]).toMatchObject({ estimated: true });
  });

  it("keeps detail only for points the history still holds, and checks it against the history and the pools", () => {
    expect(Object.keys(r3.detail.prices).map(Number)).toEqual([t1, t3 - 6 * HOUR, t3]);
    expect(r3.detail.amounts["held.near"].map(([at]) => at)).toEqual(r3.history["held.near"].points.map(([at]) => at));
    const amountsNow = poolBackingAmounts(r3.pools, r3.prices);
    expect(detailProblems(r3.detail, r3.history, amountsNow, r3.prices, t3)).toEqual([]);
    const inflated = structuredClone(r3.detail);
    inflated.amounts["held.near"][0][1]["wrap.near"] = 30_000;
    expect(detailProblems(inflated, r3.history, amountsNow, r3.prices, t3)).toEqual([
      `held.near: backing detail at ${new Date(t1).toISOString()} does not match its history`,
    ]);
    expect(detailProblems(r3.detail, r3.history, amountsNow, priced(6), t3)).toEqual(["backing detail: this run's prices are not the archived prices"]);
  });

  it("recomputes the exact reasons when an edition is verified with the one before it", () => {
    const text = (value: unknown) => JSON.stringify(value);
    const files = (from: Run, changes?: object) => ({
      prices: text(from.prices),
      pools: text(from.pools),
      index: text({ ...from.index, ...(changes ? { changes } : {}) }),
      history: text(from.history),
      backingDetail: text(from.detail),
    });
    const sealFiles = (from: Run, given: ReturnType<typeof files>) =>
      sealEdition({
        generatedAt: from.index.generatedAt,
        methodology: NEAR_TOKEN_METHODOLOGY_V2,
        code,
        files: {
          prices: { path: "inputs/prices.json.gz", sha256: sha256Hex(given.prices) },
          pools: { path: "inputs/pools.json.gz", sha256: sha256Hex(given.pools) },
          index: { path: "near-token-index.json", sha256: sha256Hex(given.index) },
          history: { path: "inputs/history.json.gz", sha256: sha256Hex(given.history) },
          backingDetail: { path: "inputs/backing-detail.json.gz", sha256: sha256Hex(given.backingDetail) },
        },
      });
    const before = files(r1);
    const beforeEdition = sealFiles(r1, before);
    const changes = gradeChanges(
      { ...comparedRun(r1), fingerprint: beforeEdition.fingerprint },
      { index: r3.index, prices: r3.prices, pools: r3.pools, dclPools: [], history: r3.history, detail: r3.detail },
    );
    const after = files(r3, changes);
    const previous = { edition: beforeEdition, ...before };
    expect(checkEdition(sealFiles(r3, after), { ...after, previous })).toEqual({ ok: true, problems: [], checked: r3.index.rows.length });
    // Leaving out the earlier detail is caught, not quietly turned into an estimate.
    expect(checkEdition(sealFiles(r3, after), { ...after, previous: { ...previous, backingDetail: undefined } }).problems).toEqual([
      "the previous backingDetail file is missing",
    ]);
  });
});

describe("pools read from NEAR at one block", () => {
  const bytes = (value: unknown) => [...Buffer.from(JSON.stringify(value))];
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
    calls.push({ method, params });
    if (method === "block") return Response.json({ result: { header: { height: 123, hash: "Blk" } } });
    const args = JSON.parse(Buffer.from(String(params.args_base64), "base64").toString()) as { from_index?: number };
    const results: Record<string, unknown> = {
      get_number_of_pools: 2,
      get_pools: [
        { pool_kind: "SIMPLE_POOL", token_account_ids: ["a.near", "wrap.near"], amounts: ["1", "2"], total_fee: 30, shares_total_supply: "9", amp: 0 },
        { pool_kind: "RATED_SWAP", token_account_ids: ["meta-pool.near", "wrap.near"], amounts: ["3", "4"], total_fee: 5, shares_total_supply: "9", amp: 240 },
      ],
      list_pools: args.from_index === 0 ? [{ token_x: "a.near", token_y: "wrap.near", total_x: "5", total_y: "6", state: "Running", fee: 100 }] : [],
    };
    return Response.json({ result: { result: bytes(results[String(params.method_name)]) } });
  };
  const rpc = new NearRpc("https://rpc.example", fetchImpl, 0, 0);

  it("reads every pool at the same block, keeping only the fields the grades use, with each pool's id", async () => {
    expect(await rpc.finalBlock()).toEqual({ height: 123, hash: "Blk" });
    expect(await readChainPools(rpc, 123)).toEqual([
      { id: 0, pool_kind: "SIMPLE_POOL", token_account_ids: ["a.near", "wrap.near"], amounts: ["1", "2"] },
      { id: 1, pool_kind: "RATED_SWAP", token_account_ids: ["meta-pool.near", "wrap.near"], amounts: ["3", "4"] },
    ]);
    expect(await readChainDclPools(rpc, 123)).toEqual([{ token_x: "a.near", token_y: "wrap.near", total_x: "5", total_y: "6", state: "Running" }]);
    const views = calls.filter((call) => call.method === "query");
    expect(views.every((call) => call.params.block_id === 123 && call.params.finality === undefined)).toBe(true);
  });

  it("moves to the next endpoint when one keeps refusing or needs a key, and stays there", async () => {
    const asked: string[] = [];
    const answer = Response.json({ result: { header: { height: 9, hash: "C" } } });
    const fetchImpl = async (url: string) => {
      asked.push(new URL(url).host);
      if (url.includes("busy")) return new Response("", { status: 429 });
      if (url.includes("closed")) return new Response("", { status: 403 });
      return answer.clone();
    };
    const rpc = new NearRpc(["https://busy.example", "https://closed.example", "https://ok.example"], fetchImpl, 0, 0);
    expect(await rpc.finalBlock()).toEqual({ height: 9, hash: "C" });
    // Three tries on the busy node, one on the node that needs a key, then the one that answers.
    expect(asked).toEqual(["busy.example", "busy.example", "busy.example", "closed.example", "ok.example"]);
    await rpc.finalBlock();
    expect(asked.at(-1)).toBe("ok.example");
    expect(rpc.endpoint).toBe("https://ok.example");
  });

  it("asks a node that is a block behind again, but fails at once on a call that is wrong in itself", async () => {
    let tries = 0;
    const behind = new NearRpc(
      "https://rpc.example",
      async () => {
        tries += 1;
        if (tries === 1) return Response.json({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK" } } });
        return Response.json({ result: { header: { height: 5, hash: "D" } } });
      },
      0,
      0,
    );
    expect(await behind.finalBlock()).toEqual({ height: 5, hash: "D" });

    let wrongTries = 0;
    const wrong = new NearRpc(
      ["https://one.example", "https://two.example"],
      async () => {
        wrongTries += 1;
        return Response.json({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });
      },
      0,
      0,
    );
    await expect(wrong.view("nobody.near", "get_pools", {}, 1)).rejects.toThrow("UNKNOWN_ACCOUNT");
    expect(wrongTries).toBe(1);
  });

  it("asks one call at a time, tries again when a node is busy or a call fails, and gives up after three tries", async () => {
    let tries = 0;
    const flaky = new NearRpc(
      "https://rpc.example",
      async () => {
        tries += 1;
        if (tries === 1) throw new Error("socket hang up");
        if (tries === 2) return new Response("", { status: 503 });
        return Response.json({ result: { header: { height: 7, hash: "B" } } });
      },
      0,
      0,
    );
    expect(await flaky.finalBlock()).toEqual({ height: 7, hash: "B" });
    let downTries = 0;
    const down = new NearRpc(
      "https://rpc.example",
      async () => {
        downTries += 1;
        return new Response("", { status: 502 });
      },
      0,
      0,
    );
    await expect(down.finalBlock()).rejects.toThrow("NEAR RPC block failed on every endpoint: rpc.example: returned 502");
    expect(downTries).toBe(3);

    let open = 0;
    let most = 0;
    const counted = new NearRpc(
      "https://rpc.example",
      async () => {
        open += 1;
        most = Math.max(most, open);
        await new Promise((done) => setTimeout(done, 5));
        open -= 1;
        return Response.json({ result: { header: { height: 1, hash: "H" } } });
      },
      0,
      0,
    );
    await Promise.all([counted.finalBlock(), counted.finalBlock(), counted.finalBlock()]);
    expect(most).toBe(1);
  });

  it("archives pools in a form the existing pool reader still parses", async () => {
    const text = JSON.stringify(await readChainPools(rpc, 123));
    const depth = poolDepth(JSON.parse(text) as RefPool[], { "wrap.near": { price: "1", decimal: 0, symbol: "wNEAR" } });
    expect(depth.get("a.near")).toBe(2);
  });
});

describe("NEAR Intents beside the grade", () => {
  it("reads contracts from 1Click asset ids, and turns a quoted loss into a grade band", () => {
    expect(contractOfAsset("nep141:wrap.near")).toBe("wrap.near");
    expect(contractOfAsset("1cs_v1:near:zec.omft.near")).toBe("zec.omft.near");
    expect(contractOfAsset("nep245:v2_1.omni.hot.tg:56_11111111111111111111")).toBeNull();
    expect(["A", "B", "C", "D", "F"].map((_, at) => impliedGrade([0.0005, 0.0036, 0.025, 0.12, 0.41][at]))).toEqual(["A", "B", "C", "D", "F"]);
  });

  it("flags two bands apart, or no route for a token graded C or better; one band is fees", () => {
    expect(quoteDisagrees("A", "B", false)).toBe(false);
    expect(quoteDisagrees("B", "D", false)).toBe(true);
    expect(quoteDisagrees("C", null, true)).toBe(true);
    expect(quoteDisagrees("D", null, true)).toBe(false);
    expect(quoteDisagrees("B", null, false)).toBe(false);
  });

  it("asks dry quotes for the graded tokens 1Click lists, one at a time, and records failures apart from missing routes", async () => {
    const rows: RatedTokenRow[] = [
      ["wrap.near", "wNEAR", 4, 2_000_000, "A", null, null, null],
      ["deep.near", "DEEP", 1, 250_000, "B", null, null, null],
      ["thin.near", "THIN", 0.01, 25_000, "C", null, null, null],
      ["flaky.near", "FLAKY", 1, 5_000, "D", null, null, null],
      ["busy.near", "BUSY", 1, 150_000, "B", null, null, null],
    ];
    const asked: Record<string, unknown>[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/tokens")) {
        return Response.json([
          { assetId: "nep141:wrap.near", blockchain: "near", decimals: 24, price: 4 },
          { assetId: `nep141:${USDC}`, blockchain: "near", decimals: 6, price: 1 },
          { assetId: "nep141:deep.near", blockchain: "near", decimals: 18, price: 1 },
          { assetId: "nep141:thin.near", blockchain: "near", decimals: 18, price: 0.01 },
          { assetId: "nep141:flaky.near", blockchain: "near", decimals: 18, price: 1 },
          { assetId: "nep141:busy.near", blockchain: "near", decimals: 18, price: 1 },
          { assetId: "nep141:other.near", blockchain: "near", decimals: 18, price: 1 },
          { assetId: "nep141:sol-token", blockchain: "sol", decimals: 9, price: 1 },
        ]);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      asked.push(body);
      const out: Record<string, string> = { "nep141:wrap.near": "996.40", "nep141:deep.near": "900" };
      if (body.originAsset === "nep141:thin.near") return Response.json({ message: "No liquidity" }, { status: 400 });
      if (body.originAsset === "nep141:flaky.near") return new Response("busy", { status: 503 });
      if (body.originAsset === "nep141:busy.near") return Response.json({ message: "Too many requests" }, { status: 429 });
      return Response.json({ quote: { amountInUsd: "1000", amountOutUsd: out[String(body.originAsset)] } }, { status: 201 });
    };

    const result = await intentsQuotes({ rows, generatedAt: "2026-12-05T00:17:00.000Z" }, { fetchImpl, baseUrl: "https://1click.example", spacingMs: 0 });
    expect(asked.map((body) => body.originAsset)).toEqual(["nep141:wrap.near", "nep141:deep.near", "nep141:thin.near", "nep141:flaky.near", "nep141:busy.near"]);
    expect(asked[0]).toMatchObject({ dry: true, amount: "250000000000000000000000000", destinationAsset: `nep141:${USDC}` });
    expect(result.quotes).toEqual({
      "wrap.near": { grade: "A", fetchesUsd: 996.4, lossPct: 0.36, impliedGrade: "B", disagrees: false },
      "deep.near": { grade: "B", fetchesUsd: 900, lossPct: 10, impliedGrade: "D", disagrees: true },
      "thin.near": { grade: "C", fetchesUsd: null, lossPct: null, impliedGrade: null, disagrees: true, error: "no route: No liquidity" },
      "flaky.near": { grade: "D", fetchesUsd: null, lossPct: null, impliedGrade: null, disagrees: false, error: "request failed (503)" },
      // Rate limited: not a missing route, so a B token is not flagged.
      "busy.near": { grade: "B", fetchesUsd: null, lossPct: null, impliedGrade: null, disagrees: false, error: "request failed (429)" },
    });
  });
});

describe("a methodology trial, side by side", () => {
  it("counts both and lists every token they grade differently", () => {
    const current = rateNearTokens(pricesNow, poolDepth(poolsThen, pricesNow), new Map(), nowAt);
    const trial = { ...ratedNow, rows: ratedNow.rows.filter((row) => row[0] !== "same.near") };
    const result = compareMethods(current, trial, nowAt);
    expect(result.differ).toEqual({
      "out.near": ["OUT", "B", 120_000, "C", 50_000],
      "in.near": ["IN", "F", 2_000, "C", 25_000],
      "new.near": ["NEW", "F", 0, "C", 40_000],
    });
    expect(result).toMatchObject({ onlyCurrent: 1, onlyTrial: 0 });
  });
});
