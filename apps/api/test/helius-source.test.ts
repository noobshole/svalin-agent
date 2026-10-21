import { SOL_NATIVE_MINT } from "@svalin-agent/chain-config";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/lib/errors.js";
import {
  HeliusPortfolioSource,
  classifySolanaAccount,
  mapHeliusToOverview,
  type HeliusAssetsResponse,
} from "../src/sources/helius-source.js";
import { formatUnits } from "../src/sources/portfolio-source.js";
import { SOLANA_WALLET } from "./helpers.js";

const SYSTEM = "11111111111111111111111111111111";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const RANDOM = "Fake1111111111111111111111111111111111111111";

const page: HeliusAssetsResponse = {
  result: {
    total: 5,
    nativeBalance: { lamports: 2_500_000_000, price_per_sol: 160, total_price: 400 },
    items: [
      {
        id: USDC,
        interface: "FungibleToken",
        content: { metadata: { name: "USD Coin", symbol: "USDC" } },
        token_info: { symbol: "USDC", balance: 600_000_000, decimals: 6, price_info: { price_per_token: 1, total_price: 600 } },
      },
      {
        id: JITOSOL,
        interface: "FungibleToken",
        token_info: { symbol: "JitoSOL", balance: "1000000000", decimals: 9, price_info: { price_per_token: 200 } },
      },
      { id: RANDOM, interface: "FungibleToken", token_info: { symbol: "SPAM", balance: 5, decimals: 0 } },
      { id: "Nft11111111111111111111111111111111111111111", interface: "V1_NFT" },
      { id: "Zero1111111111111111111111111111111111111111", interface: "FungibleToken", token_info: { balance: 0, decimals: 6, price_info: { price_per_token: 3 } } },
    ],
  },
};

describe("Helius mapping", () => {
  it("maps native SOL, priced tokens and counts unpriced tokens", () => {
    const overview = mapHeliusToOverview(SOLANA_WALLET, [page], new Date("2026-10-13T00:00:00Z"));
    expect(overview.dataSource).toBe("helius");
    expect(overview.totalValueUsd).toBe(1200);
    expect(overview.unpricedAssetCount).toBe(1);
    expect(overview.assets.map((asset) => [asset.symbol, asset.valueUsd, asset.category])).toEqual([
      ["USDC", 600, "stablecoin"],
      ["SOL", 400, "native"],
      ["JitoSOL", 200, "liquid-staking"],
    ]);
    expect(overview.assets.find((asset) => asset.tokenAddress === SOL_NATIVE_MINT)?.balance).toBe("2.5");
    expect(overview.assets.reduce((sum, asset) => sum + asset.allocationBps, 0)).toBe(10_000);
  });

  it("paginates until a short page and surfaces upstream errors as ApiError", async () => {
    let calls = 0;
    const source = new HeliusPortfolioSource("https://rpc.example", (async (_url, init) => {
      if (JSON.parse(String(init?.body)).method === "getAssetsByOwner") calls += 1;
      return new Response(JSON.stringify(page), { status: 200 });
    }) as typeof fetch);
    await source.getOverview(SOLANA_WALLET);
    expect(calls).toBe(1);

    const failing = new HeliusPortfolioSource("https://rpc.example", (async () => new Response("", { status: 500 })) as typeof fetch);
    await expect(failing.getOverview(SOLANA_WALLET)).rejects.toBeInstanceOf(ApiError);
  });

  it("tells wallets from token mints, token accounts and programs", () => {
    expect(classifySolanaAccount(null)).toBe("wallet");
    expect(classifySolanaAccount({ owner: SYSTEM, executable: false, space: 0 })).toBe("wallet");
    expect(classifySolanaAccount({ owner: SPL_TOKEN, executable: false, space: 82, data: ["", "base64"] })).toBe("mint");
    expect(classifySolanaAccount({ owner: SPL_TOKEN, executable: false, space: 165, data: ["", "base64"] })).toBe("token-account");
    // Token-2022 accounts with extensions: the byte after the 165-byte base says which kind.
    expect(classifySolanaAccount({ owner: TOKEN_2022, executable: false, space: 866, data: ["AQ==", "base64"] })).toBe("mint");
    expect(classifySolanaAccount({ owner: TOKEN_2022, executable: false, space: 300, data: ["Ag==", "base64"] })).toBe("token-account");
    expect(classifySolanaAccount({ owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true, space: 36 })).toBe("program");
  });

  it("answers a token mint with 422 instead of scoring it as an empty wallet", async () => {
    const source = new HeliusPortfolioSource("https://rpc.example", (async (_url, init) => {
      const { method } = JSON.parse(String(init?.body));
      return Response.json(method === "getAccountInfo" ? { result: { value: { owner: SPL_TOKEN, executable: false, space: 82 } } } : page);
    }) as typeof fetch);
    await expect(source.getOverview(USDC)).rejects.toMatchObject({
      status: 422,
      code: "token_address",
      token: { chain: "solana", address: USDC, symbol: "USDC", grade: null },
    });
  });

  it("formats raw token units without floating point loss", () => {
    expect(formatUnits(123456789012345678901n, 9)).toBe("123456789012.345678901");
    expect(formatUnits(1_000_000n, 6)).toBe("1");
    expect(formatUnits(5n, 0)).toBe("5");
  });
});
