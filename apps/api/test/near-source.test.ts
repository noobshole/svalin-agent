import { NEAR_NATIVE_TOKEN } from "@svalin-agent/chain-config";
import { detectAddressFamily } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/lib/errors.js";
import { ChainRouterSource } from "../src/sources/chain-router-source.js";
import { MockPortfolioSource } from "../src/sources/mock-source.js";
import {
  NearPortfolioSource,
  type NearSourceOptions,
  exitValue,
  mapNearToOverview,
  parseRefPools,
  poolDepth,
  type FastNearAccount,
  type NearPriceList,
  type RefPool,
} from "../src/sources/near-source.js";
import { NEAR_WALLET, SOLANA_WALLET } from "./helpers.js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ONE_NEAR = 10n ** 24n;
const REF = "token.v2.ref-finance.near";

const prices: NearPriceList = {
  "wrap.near": { price: "5", decimal: 24, symbol: "wNEAR" },
  [USDC]: { price: "1", decimal: 6, symbol: "USDC" },
  "meta-pool.near": { price: "7.5", decimal: 24, symbol: "STNEAR" },
  [REF]: { price: "0.05", decimal: 18, symbol: "REF" },
};

/** REF trades against 20 wNEAR ($100), so a sale of it could take out at most $100. */
const pools: RefPool[] = [{ token_account_ids: [REF, "wrap.near"], amounts: ["2000000000000000000000", (20n * ONE_NEAR).toString()] }];
const refDepth = poolDepth(pools, prices);

const account: FastNearAccount = {
  account_id: NEAR_WALLET,
  state: { balance: (40n * ONE_NEAR).toString(), locked: "0", storage_bytes: 500 },
  pools: [{ pool_id: "astro-stakers.poolv1.near" }],
  tokens: [
    { contract_id: USDC, balance: "300000000" },
    { contract_id: "meta-pool.near", balance: (20n * ONE_NEAR).toString() },
    { contract_id: "token.v2.ref-finance.near", balance: (1000n * 10n ** 18n).toString() },
    { contract_id: "spam-airdrop.near", balance: "999" },
    { contract_id: "empty.near", balance: "0" },
    { contract_id: "broken.near", balance: "" },
  ],
};

describe("NEAR address detection", () => {
  it("tells Solana addresses and NEAR account IDs apart", () => {
    expect(detectAddressFamily(SOLANA_WALLET)).toBe("solana");
    expect(detectAddressFamily("alice.near")).toBe("near");
    expect(detectAddressFamily("sub.alice.near")).toBe("near");
    expect(detectAddressFamily("svalin-pay.testnet")).toBe("near");
    expect(detectAddressFamily(USDC)).toBe("near");
    expect(detectAddressFamily("0x1111111111111111111111111111111111111111")).toBe("near");
  });

  it("rejects strings that are neither", () => {
    expect(detectAddressFamily("Alice.near")).toBeNull();
    expect(detectAddressFamily("alice..near")).toBeNull();
    expect(detectAddressFamily("a")).toBeNull();
    expect(detectAddressFamily(`${"a".repeat(65)}`)).toBeNull();
    expect(detectAddressFamily("not a wallet")).toBeNull();
  });
});

describe("NEAR mapping", () => {
  it("maps native NEAR, validator stakes and priced tokens, and counts unpriced tokens", () => {
    const stakes = [{ poolId: "astro-stakers.poolv1.near", yocto: 60n * ONE_NEAR }];
    const overview = mapNearToOverview(NEAR_WALLET, account, prices, stakes, refDepth, new Date("2026-10-14T00:00:00Z"));

    expect(overview.chain).toBe("near");
    expect(overview.dataSource).toBe("fastnear");
    expect(overview.totalValueUsd).toBe(1000);
    expect(overview.unpricedAssetCount).toBe(1);
    expect(overview.assets.map((asset) => [asset.symbol, asset.valueUsd, asset.category])).toEqual([
      ["NEAR", 300, "liquid-staking"],
      ["USDC", 300, "stablecoin"],
      ["NEAR", 200, "native"],
      ["stNEAR", 150, "liquid-staking"],
      ["REF", 50, "long-tail"],
    ]);
    expect(overview.assets.find((asset) => asset.tokenAddress === NEAR_NATIVE_TOKEN)?.balance).toBe("40");
    expect(overview.assets.reduce((sum, asset) => sum + asset.allocationBps, 0)).toBe(10_000);
  });

  it("treats NEAR as unpriced when no wNEAR price is available", () => {
    const overview = mapNearToOverview(NEAR_WALLET, account, { [USDC]: prices[USDC] }, [], refDepth);
    expect(overview.assets.map((asset) => asset.symbol)).toEqual(["USDC"]);
  });
});

describe("NEAR pool check", () => {
  // The shape that broke root.near: a token quoted at $48,447 each that nobody can sell.
  const junkPrices: NearPriceList = { ...prices, "junk.near": { price: "48447", decimal: 18, symbol: "" } };
  const junkAccount: FastNearAccount = {
    ...account,
    tokens: [
      { contract_id: "junk.near", balance: (3900n * 10n ** 18n).toString() },
      { contract_id: REF, balance: (100_000n * 10n ** 18n).toString() },
      { contract_id: USDC, balance: "300000000" },
    ],
  };

  it("counts a token with no pool as unpriced and caps others at what their pools could pay", () => {
    const overview = mapNearToOverview(NEAR_WALLET, junkAccount, junkPrices, [], refDepth);

    // REF is quoted at $5,000 for this balance, but its pool holds only $100 of wNEAR.
    expect(overview.assets.map((asset) => [asset.symbol, asset.valueUsd, asset.category])).toEqual([
      ["USDC", 300, "stablecoin"],
      ["NEAR", 200, "native"],
      ["REF", 100, "long-tail"],
    ]);
    expect(overview.totalValueUsd).toBe(600);
    expect(overview.unpricedAssetCount).toBe(1);
    // Selling $5,000 of REF into $100 of backing would fetch about $98, never more than the backing.
    expect(overview.assets.map((asset) => [asset.symbol, asset.exitValueUsd])).toEqual([
      ["USDC", 300],
      ["NEAR", 200],
      ["REF", 98.04],
    ]);
    expect(exitValue(50, 100)).toBeCloseTo(33.33, 2);
    expect(exitValue(50, 0)).toBe(0);
  });

  it("counts only registry tokens in a pool, so junk paired with junk has no depth", () => {
    const depth = poolDepth(
      [
        { token_account_ids: ["junk.near", "junk-two.near"], amounts: ["1000000000000000000000", "1000000000000000000000"] },
        { token_account_ids: [REF, USDC], amounts: ["1", "50000000"] },
        { token_account_ids: [REF, "wrap.near"], amounts: ["1", (2n * ONE_NEAR).toString()] },
        { token_account_ids: [REF], amounts: ["1", "2"] },
      ],
      { ...junkPrices, "junk-two.near": { price: "1000", decimal: 18, symbol: "J2" } },
    );
    expect(depth.get("junk.near")).toBeUndefined();
    expect(depth.get(REF)).toBe(60);
    expect(depth.has("wrap.near")).toBe(false);
  });

  it("reads only the pools that hold a registry token, and falls back to a full parse", () => {
    const text = JSON.stringify([
      { pool_kind: "SIMPLE_POOL", token_account_ids: [REF, "wrap.near"], amounts: ["1", "2"], total_fee: 30 },
      { pool_kind: "SIMPLE_POOL", token_account_ids: ["junk.near", "junk-two.near"], amounts: ["3", "4"], total_fee: 30 },
    ]).replace(/":/g, '": ').replace(/,"/g, ', "');
    expect(parseRefPools(text)).toEqual([{ token_account_ids: [REF, "wrap.near"], amounts: ["1", "2"] }]);

    const reordered = JSON.stringify([{ amounts: ["1", "2"], token_account_ids: [REF, "wrap.near"] }]);
    expect(parseRefPools(reordered)).toEqual([{ amounts: ["1", "2"], token_account_ids: [REF, "wrap.near"] }]);
    expect(() => parseRefPools("not json")).toThrow(ApiError);
  });
});

describe("NEAR source", () => {
  function fakeUpstream(
    responses: { account?: FastNearAccount | null; poolYocto?: bigint; status?: number; dclDepth?: Record<string, number> },
    extra: Partial<NearSourceOptions> = {},
  ) {
    const calls = { account: 0, prices: 0, pools: 0, rpc: 0 };
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (responses.status) return new Response("", { status: responses.status });
      if (target.includes("dcl.example")) return Response.json({ depth: responses.dclDepth ?? {} });
      if (target.includes("/v1/account/")) {
        calls.account += 1;
        return Response.json(responses.account ?? { account_id: NEAR_WALLET, state: null, pools: [], tokens: [] });
      }
      if (target.includes("prices.example")) {
        calls.prices += 1;
        return Response.json(prices);
      }
      if (target.includes("pools.example")) {
        calls.pools += 1;
        return Response.json(pools);
      }
      calls.rpc += 1;
      const encoded = [...Buffer.from(JSON.stringify((responses.poolYocto ?? 0n).toString()))];
      return Response.json({ jsonrpc: "2.0", id: "svalin", result: { result: encoded, logs: [] } });
    }) as typeof fetch;
    const source = new NearPortfolioSource(
      {
        apiUrl: "https://fastnear.example",
        rpcUrl: "https://rpc.example",
        priceUrl: "https://prices.example/list",
        poolsUrl: "https://pools.example/list",
        ...extra,
      },
      fetchImpl,
    );
    return { source, calls };
  }

  it("reads staking pools over RPC and caches the price and pool lists", async () => {
    const { source, calls } = fakeUpstream({ account, poolYocto: 60n * ONE_NEAR });
    const first = await source.getOverview(NEAR_WALLET);
    await source.getOverview(NEAR_WALLET);

    expect(first.totalValueUsd).toBe(1000);
    expect(calls).toEqual({ account: 2, prices: 1, pools: 1, rpc: 2 });
  });

  it("skips the pool list for an account holding only registry tokens", async () => {
    const { source, calls } = fakeUpstream({ account: { ...account, tokens: [{ contract_id: USDC, balance: "300000000" }] } });
    await source.getOverview(NEAR_WALLET);
    expect(calls.pools).toBe(0);
  });

  it("returns 404 for an account that does not exist, so a paid call is not charged", async () => {
    const { source } = fakeUpstream({ account: null });
    await expect(source.getOverview("nobody-here.near")).rejects.toMatchObject({ status: 404, code: "account_not_found" });
  });

  it("answers a token contract with its grade instead of a score, so a paid call is not charged", async () => {
    const { source } = fakeUpstream({ account });
    await expect(source.getOverview(REF)).rejects.toMatchObject({
      status: 422,
      code: "token_address",
      token: { chain: "near", address: REF, symbol: "REF", grade: "F", backingUsd: 100 },
    });
  });

  it("takes a token's grade from the published Index, where backing must have held for 24 hours", async () => {
    const indexed = fakeUpstream({ account }, { indexRow: async () => [REF, "REF", 0.05, 154_000, "B", null, 92.8, 4000] });
    await expect(indexed.source.getOverview(REF)).rejects.toMatchObject({ status: 422, token: { grade: "B", backingUsd: 154_000 } });

    // Backing still on hold is reported as such, not as $0.
    const holding = fakeUpstream(
      { account, dclDepth: { [REF]: 185_000 } },
      { dclDepthUrl: "https://dcl.example/depth.json", indexRow: async () => [REF, "REF", 0.05, 0, "F", null, null, null] },
    );
    await expect(holding.source.getOverview(REF)).rejects.toMatchObject({
      token: { grade: "F", backingUsd: 0 },
      hint: expect.stringContaining("Its pools hold $185,100 now"),
    });

    const fresh = fakeUpstream({ account }, { indexRow: async () => undefined });
    await expect(fresh.source.getOverview(REF)).rejects.toMatchObject({
      status: 422,
      token: { grade: "F", backingUsd: 0 },
      hint: expect.stringContaining("hold for 24 hours"),
    });

    // If the Index cannot be read, live pool depth stands in rather than calling every token new.
    const offline = fakeUpstream({ account }, { indexRow: async () => Promise.reject(new Error("down")) });
    await expect(offline.source.getOverview(REF)).rejects.toMatchObject({ token: { grade: "F", backingUsd: 100 } });
  });

  it("adds concentrated-liquidity depth from the published edition when valuing tokens", async () => {
    // 10,000 REF quoted at $500: classic pools alone cap it at $100, with $900 of DCL depth at $1,000.
    const holder: FastNearAccount = { ...account, tokens: [{ contract_id: REF, balance: (10_000n * 10n ** 18n).toString() }] };
    const valueOf = async (extra: Partial<NearSourceOptions>) => {
      const { source } = fakeUpstream({ account: holder, dclDepth: { [REF]: 900 } }, extra);
      return (await source.getOverview(NEAR_WALLET)).assets.find((asset) => asset.tokenAddress === REF)?.valueUsd;
    };
    expect(await valueOf({})).toBe(100);
    expect(await valueOf({ dclDepthUrl: "https://dcl.example/depth.json" })).toBe(500);
  });

  it("never values a token above the backing it has held for 24 hours in the Index", async () => {
    const holder: FastNearAccount = { ...account, tokens: [{ contract_id: REF, balance: (10_000n * 10n ** 18n).toString() }] };
    const valueOf = async (indexRow: NearSourceOptions["indexRow"]) => {
      const { source } = fakeUpstream({ account: holder, dclDepth: { [REF]: 900 } }, { dclDepthUrl: "https://dcl.example/depth.json", indexRow });
      const overview = await source.getOverview(NEAR_WALLET);
      return { value: overview.assets.find((asset) => asset.tokenAddress === REF)?.valueUsd, unpriced: overview.unpricedAssetCount };
    };
    // $1,000 of live depth, but only $250 has held: valued at $250.
    expect(await valueOf(async () => [REF, "REF", 0.05, 250, "F", null, null, null])).toEqual({ value: 250, unpriced: 0 });
    // Too new for the Index: unpriced, however deep its fresh pool.
    expect(await valueOf(async () => undefined)).toEqual({ value: undefined, unpriced: 1 });
    // Index unreachable: live depth alone.
    expect(await valueOf(async () => Promise.reject(new Error("down")))).toEqual({ value: 500, unpriced: 0 });
  });

  it("gives no grade to the trusted tokens, and skips the pool list for them", async () => {
    const { source, calls } = fakeUpstream({ account });
    await expect(source.getOverview(USDC)).rejects.toMatchObject({
      status: 422,
      token: { symbol: "USDC", grade: null, backingUsd: null },
    });
    expect(calls.pools).toBe(0);
  });

  it("surfaces upstream failures as ApiError", async () => {
    const { source } = fakeUpstream({ status: 500 });
    await expect(source.getOverview(NEAR_WALLET)).rejects.toBeInstanceOf(ApiError);
    const limited = fakeUpstream({ status: 429 });
    await expect(limited.source.getOverview(NEAR_WALLET)).rejects.toMatchObject({ status: 503 });
  });
});

describe("chain router", () => {
  it("sends each wallet to the source for its chain", async () => {
    const solana = new MockPortfolioSource();
    const router = new ChainRouterSource({ solana });
    expect(router.supports("solana")).toBe(true);
    expect(router.supports("near")).toBe(false);
    expect((await router.getOverview(SOLANA_WALLET)).chain).toBe("solana");
    expect(() => router.getOverview(NEAR_WALLET)).toThrow(ApiError);
  });
});
