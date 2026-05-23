import type { Address, ChainAddress, SupportedChainKey } from "./core.js";

export type PortfolioAsset = {
  chain: SupportedChainKey;
  tokenAddress: ChainAddress;
  symbol: string;
  name: string;
  balance: string;
  priceUsd: number;
  valueUsd: number;
  allocationBps: number;
  change24hPct: number | null;
  isCoreHolding: boolean;
};

export type PortfolioOverview = {
  wallet: Address;
  totalValueUsd: number;
  dayChangePct: number | null;
  riskScore: number | null;
  assets: PortfolioAsset[];
  refreshedAt: string;
};
