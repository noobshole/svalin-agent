import type { PortfolioAsset, PortfolioOverview } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import {
  DexScreenerDepth,
  MAX_CHECKED_TOKENS,
  MarketCheckedSource,
  limitToMarketDepth,
  type MarketDepth,
} from "../src/sources/market-depth.js";
import type { PortfolioSource } from "../src/sources/portfolio-source.js";
import { NEAR_WALLET } from "./helpers.js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

function asset(tokenAddress: string, valueUsd: number, category: PortfolioAsset["category"]): PortfolioAsset {
  return {
    chain: "near",
    tokenAddress,
    symbol: tokenAddress.slice(0, 6),
    name: tokenAddress.slice(0, 6),
    balance: "1",
    priceUsd: valueUsd,
    valueUsd,
    allocationBps: 0,
    category,
  };
}

function overview(assets: PortfolioAsset[], unpricedAssetCount = 0): PortfolioOverview {
  return {
    wallet: NEAR_WALLET,
    chain: "near",
    totalValueUsd: assets.reduce((sum, item) => sum + item.valueUsd, 0),
    assets,
    unpricedAssetCount,
    dataSource: "fastnear",
    refreshedAt: "2026-10-19T00:00:00.000Z",
  };
}

// The shape that broke root.near: a token nobody trades, quoted at $48,447 each.
const wallet = overview(
  [
    asset("junk.near", 189_000_000, "long-tail"),
    asset("meme.near", 58_000, "long-tail"),
    asset("small.near", 500, "long-tail"),
    asset(USDC, 300, "stablecoin"),
    asset("near", 200, "native"),
  ],
  2,
);

describe("market check", () => {
  it("drops long-tail tokens with no pool, caps the rest at what their pools could pay, and trusts registry tokens", () => {
    const sellable = new Map([
      ["junk.near", 0],
      ["meme.near", 34_000],
      ["small.near", 10_000],
    ]);
    const checked = limitToMarketDepth(wallet, sellable);

    expect(checked.assets.map((item) => [item.tokenAddress, item.valueUsd, item.category])).toEqual([
      ["meme.near", 34_000, "long-tail"],
      ["small.near", 500, "long-tail"],
      [USDC, 300, "stablecoin"],
      ["near", 200, "native"],
    ]);
    expect(checked.totalValueUsd).toBe(35_000);
    expect(checked.unpricedAssetCount).toBe(3);
    expect(checked.assets.reduce((sum, item) => sum + item.allocationBps, 0)).toBe(10_000);
  });

  it("counts long-tail tokens that were not checked as unpriced", () => {
    const checked = limitToMarketDepth(wallet, new Map());
    expect(checked.assets.map((item) => item.tokenAddress)).toEqual([USDC, "near"]);
    expect(checked.unpricedAssetCount).toBe(5);
  });

  it("checks only long-tail tokens, largest first, up to the per-report cap", async () => {
    const many = overview([
      asset(USDC, 1_000_000, "stablecoin"),
      ...Array.from({ length: MAX_CHECKED_TOKENS + 5 }, (_, index) => asset(`t${String(index).padStart(3, "0")}.near`, 1000 - index, "long-tail")),
    ]);
    const asked: string[][] = [];
    const depth: MarketDepth = {
      async sellableUsd(chain, tokens) {
        asked.push(tokens);
        return new Map(tokens.map((token) => [token, 1_000_000]));
      },
    };
    const inner: PortfolioSource = { supports: () => true, getOverview: async () => many };
    const checked = await new MarketCheckedSource(inner, depth).getOverview(NEAR_WALLET);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(MAX_CHECKED_TOKENS);
    expect(asked[0][0]).toBe("t000.near");
    expect(asked[0]).not.toContain(USDC);
    expect(checked.unpricedAssetCount).toBe(5);
  });

  it("makes no market request for a wallet with no long-tail tokens", async () => {
    const depth: MarketDepth = {
      async sellableUsd() {
        throw new Error("should not be called");
      },
    };
    const inner: PortfolioSource = { supports: () => true, getOverview: async () => overview([asset(USDC, 300, "stablecoin")]) };
    await expect(new MarketCheckedSource(inner, depth).getOverview(NEAR_WALLET)).resolves.toMatchObject({ totalValueUsd: 300 });
  });
});

describe("DexScreener depth", () => {
  function fakeDexScreener(pairs: unknown, status = 200) {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return status === 200 ? Response.json(pairs) : new Response("", { status });
    }) as typeof fetch;
    return { depth: new DexScreenerDepth("https://dex.example", fetchImpl), urls };
  }

  it("adds half of each pool's liquidity, whichever side the token is on, and caches per token", async () => {
    const { depth, urls } = fakeDexScreener([
      { baseToken: { address: "meme.near" }, quoteToken: { address: "wrap.near" }, liquidity: { usd: 60_000 } },
      { baseToken: { address: "wrap.near" }, quoteToken: { address: "meme.near" }, liquidity: { usd: 8_000 } },
      { baseToken: { address: "other.near" }, quoteToken: { address: "wrap.near" }, liquidity: { usd: 1e9 } },
      { baseToken: { address: "meme.near" }, quoteToken: { address: "wrap.near" } },
    ]);

    const first = await depth.sellableUsd("near", ["meme.near", "junk.near"]);
    expect(first).toEqual(new Map([["meme.near", 34_000], ["junk.near", 0]]));
    expect(urls).toEqual(["https://dex.example/tokens/v1/near/meme.near,junk.near"]);

    await depth.sellableUsd("near", ["meme.near", "junk.near"]);
    expect(urls).toHaveLength(1);
  });

  it("asks for at most 30 tokens per request", async () => {
    const { depth, urls } = fakeDexScreener([]);
    await depth.sellableUsd("solana", Array.from({ length: 61 }, (_, index) => `Mint${index}`));
    expect(urls.map((url) => url.split("/").pop()?.split(",").length)).toEqual([30, 30, 1]);
    expect(urls[0]).toContain("/tokens/v1/solana/");
  });

  it("fails the report when market data is unavailable, so a paid call is not charged", async () => {
    await expect(fakeDexScreener([], 429).depth.sellableUsd("near", ["a.near"])).rejects.toMatchObject({ status: 503 });
    await expect(fakeDexScreener([], 500).depth.sellableUsd("near", ["a.near"])).rejects.toMatchObject({ status: 502 });
  });
});
