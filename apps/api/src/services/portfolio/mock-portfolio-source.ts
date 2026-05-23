import {
  portfolioOverviewSchema,
  type Address,
  type PortfolioOverview,
} from "@svalin-agent/shared";

import type { PortfolioSource } from "./portfolio-source.js";

export class MockPortfolioSource implements PortfolioSource {
  async getOverview(wallet: Address): Promise<PortfolioOverview> {
    return portfolioOverviewSchema.parse({
      wallet,
      totalValueUsd: 21758.5,
      dayChangePct: 4.1,
      riskScore: 60,
      refreshedAt: new Date().toISOString(),
      assets: [
        {
          chain: "ethereum",
          tokenAddress: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          name: "USD Coin",
          balance: "6200.00",
          priceUsd: 1,
          valueUsd: 6200,
          allocationBps: 2849,
          change24hPct: 0,
          isCoreHolding: true,
        },
        {
          chain: "ethereum",
          tokenAddress: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
          symbol: "WETH",
          name: "Wrapped Ether",
          balance: "2.7804",
          priceUsd: 3125.8,
          valueUsd: 8693.27,
          allocationBps: 3995,
          change24hPct: 4.2,
          isCoreHolding: true,
        },
        {
          chain: "base",
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          symbol: "USDC",
          name: "USD Coin",
          balance: "3749.46",
          priceUsd: 1,
          valueUsd: 3749.46,
          allocationBps: 1723,
          change24hPct: 0,
          isCoreHolding: false,
        },
        {
          chain: "solana",
          tokenAddress: "So11111111111111111111111111111111111111112",
          symbol: "SOL",
          name: "Solana",
          balance: "18.5000",
          priceUsd: 168.42,
          valueUsd: 3115.77,
          allocationBps: 1433,
          change24hPct: 6.8,
          isCoreHolding: true,
        },
      ],
    });
  }
}
