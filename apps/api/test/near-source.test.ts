import { NEAR_NATIVE_TOKEN } from "@svalin-agent/chain-config";
import { detectAddressFamily } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/lib/errors.js";
import { ChainRouterSource } from "../src/sources/chain-router-source.js";
import { MockPortfolioSource } from "../src/sources/mock-source.js";
import {
  NearPortfolioSource,
  mapNearToOverview,
  type FastNearAccount,
  type NearPriceList,
} from "../src/sources/near-source.js";
import { NEAR_WALLET, SOLANA_WALLET } from "./helpers.js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ONE_NEAR = 10n ** 24n;

const prices: NearPriceList = {
  "wrap.near": { price: "5", decimal: 24, symbol: "wNEAR" },
  [USDC]: { price: "1", decimal: 6, symbol: "USDC" },
  "meta-pool.near": { price: "7.5", decimal: 24, symbol: "STNEAR" },
  "token.v2.ref-finance.near": { price: "0.05", decimal: 18, symbol: "REF" },
};

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
    const overview = mapNearToOverview(NEAR_WALLET, account, prices, stakes, new Date("2026-10-14T00:00:00Z"));

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
    const overview = mapNearToOverview(NEAR_WALLET, account, { [USDC]: prices[USDC] }, []);
    expect(overview.assets.map((asset) => asset.symbol)).toEqual(["USDC"]);
  });
});

describe("NEAR source", () => {
  function fakeUpstream(responses: { account?: FastNearAccount | null; poolYocto?: bigint; status?: number }) {
    const calls = { account: 0, prices: 0, rpc: 0 };
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (responses.status) return new Response("", { status: responses.status });
      if (target.includes("/v1/account/")) {
        calls.account += 1;
        return Response.json(responses.account ?? { account_id: NEAR_WALLET, state: null, pools: [], tokens: [] });
      }
      if (target.includes("prices.example")) {
        calls.prices += 1;
        return Response.json(prices);
      }
      calls.rpc += 1;
      const encoded = [...Buffer.from(JSON.stringify((responses.poolYocto ?? 0n).toString()))];
      return Response.json({ jsonrpc: "2.0", id: "svalin", result: { result: encoded, logs: [] } });
    }) as typeof fetch;
    const source = new NearPortfolioSource(
      { apiUrl: "https://fastnear.example", rpcUrl: "https://rpc.example", priceUrl: "https://prices.example/list" },
      fetchImpl,
    );
    return { source, calls };
  }

  it("reads staking pools over RPC and caches the price list", async () => {
    const { source, calls } = fakeUpstream({ account, poolYocto: 60n * ONE_NEAR });
    const first = await source.getOverview(NEAR_WALLET);
    await source.getOverview(NEAR_WALLET);

    expect(first.totalValueUsd).toBe(1000);
    expect(calls).toEqual({ account: 2, prices: 1, rpc: 2 });
  });

  it("returns 404 for an account that does not exist, so a paid call is not charged", async () => {
    const { source } = fakeUpstream({ account: null });
    await expect(source.getOverview("nobody-here.near")).rejects.toMatchObject({ status: 404, code: "account_not_found" });
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
