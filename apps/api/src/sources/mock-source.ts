import { NEAR_NATIVE_TOKEN, SOL_NATIVE_MINT, categoriseToken } from "@svalin-agent/chain-config";
import {
  detectAddressFamily,
  portfolioOverviewSchema,
  type ChainFamily,
  type PortfolioOverview,
  type SupportedChainKey,
} from "@svalin-agent/shared";

import type { RecipientSignals } from "../risk/check.js";
import { finaliseAssets, type PortfolioSource } from "./portfolio-source.js";

type Holding = {
  chain: SupportedChainKey;
  tokenAddress: string;
  symbol: string;
  name: string;
  amount: number;
  priceUsd: number;
};

/** Sample Solana wallet: SOL-heavy degen with some memes and a long-tail bag. */
const solanaSample: Holding[] = [
  { chain: "solana", tokenAddress: SOL_NATIVE_MINT, symbol: "SOL", name: "Solana", amount: 48.2, priceUsd: 172.4 },
  { chain: "solana", tokenAddress: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", name: "Jito Staked SOL", amount: 9.1, priceUsd: 208.9 },
  { chain: "solana", tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", amount: 1240, priceUsd: 1 },
  { chain: "solana", tokenAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", amount: 2100, priceUsd: 0.82 },
  { chain: "solana", tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", amount: 61_000_000, priceUsd: 0.0000215 },
  { chain: "solana", tokenAddress: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", amount: 610, priceUsd: 1.62 },
  { chain: "solana", tokenAddress: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat", amount: 3900, priceUsd: 0.41 },
];

/** Sample NEAR wallet: NEAR-heavy with some liquid staking, stables and a meme. */
const nearSample: Holding[] = [
  { chain: "near", tokenAddress: NEAR_NATIVE_TOKEN, symbol: "NEAR", name: "NEAR", amount: 1850, priceUsd: 4.93 },
  { chain: "near", tokenAddress: "meta-pool.near", symbol: "stNEAR", name: "Staked NEAR", amount: 240, priceUsd: 7.34 },
  { chain: "near", tokenAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", name: "USD Coin", amount: 2100, priceUsd: 1 },
  { chain: "near", tokenAddress: "blackdragon.tkn.near", symbol: "BLACKDRAGON", name: "Black Dragon", amount: 52_000_000_000, priceUsd: 0.00000001 },
  { chain: "near", tokenAddress: "token.v2.ref-finance.near", symbol: "REF", name: "Ref Finance", amount: 6400, priceUsd: 0.057 },
];

/**
 * Deterministic sample data for local development and the test suite.
 * Every response is labelled `dataSource: "mock"`; production refuses to boot with it.
 */
export class MockPortfolioSource implements PortfolioSource {
  constructor(private readonly now: () => Date = () => new Date()) {}

  supports(_family: ChainFamily): boolean {
    return true;
  }

  async getOverview(wallet: string): Promise<PortfolioOverview> {
    const family = detectAddressFamily(wallet);
    const holdings = family === "near" ? nearSample : solanaSample;

    const { assets, totalValueUsd } = finaliseAssets(
      holdings.map((holding) => ({
        chain: holding.chain,
        tokenAddress: holding.tokenAddress,
        symbol: holding.symbol,
        name: holding.name,
        balance: String(holding.amount),
        priceUsd: holding.priceUsd,
        valueUsd: holding.amount * holding.priceUsd,
        category: categoriseToken(holding.chain, holding.tokenAddress),
      })),
    );

    return portfolioOverviewSchema.parse({
      wallet,
      chain: family === "near" ? "near" : "solana",
      totalValueUsd,
      assets,
      unpricedAssetCount: family === "near" ? 3 : 14,
      dataSource: "mock",
      refreshedAt: this.now().toISOString(),
    });
  }

  /** Sample recipient: an established wallet about a year old that the payer has not paid yet. */
  async inspectRecipient(recipient: string, payer: string | null): Promise<RecipientSignals> {
    return {
      chain: detectAddressFamily(recipient) === "near" ? "near" : "solana",
      recipient,
      payer,
      kind: "wallet",
      createdAt: this.now().getTime() - 400 * 24 * 60 * 60 * 1000,
      transactions: 120,
      transactionsAtLeast: false,
      payerSentTo: payer ? [] : null,
      payerReceivedFrom: payer ? [] : null,
      dataSource: "mock",
    };
  }
}
