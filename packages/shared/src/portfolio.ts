import { z } from "zod";

import { supportedChainKeySchema, tokenAddressSchema, walletAddressSchema } from "./address.js";

/**
 * How a token is classified for risk purposes. Assigned from a curated registry;
 * anything not in the registry is "long-tail".
 */
export const assetCategorySchema = z.enum([
  "native",
  "stablecoin",
  "liquid-staking",
  "major",
  "meme",
  "long-tail",
]);

export const dataSourceSchema = z.enum(["helius", "fastnear", "mock"]);

export const portfolioAssetSchema = z.object({
  chain: supportedChainKeySchema,
  tokenAddress: tokenAddressSchema,
  symbol: z.string().min(1),
  name: z.string().min(1),
  /** Human-readable balance (already scaled by decimals). */
  balance: z.string().min(1),
  /** Null when no reliable price exists for the token. */
  priceUsd: z.number().nonnegative().nullable(),
  /** Zero when priceUsd is null. */
  valueUsd: z.number().nonnegative(),
  /** Share of total *priced* value, in basis points. */
  allocationBps: z.number().int().min(0).max(10_000),
  category: assetCategorySchema,
});

export const portfolioOverviewSchema = z.object({
  wallet: walletAddressSchema,
  chain: supportedChainKeySchema,
  totalValueUsd: z.number().nonnegative(),
  assets: z.array(portfolioAssetSchema),
  /** Tokens held with no price (often airdropped spam). Excluded from totals. */
  unpricedAssetCount: z.number().int().nonnegative(),
  dataSource: dataSourceSchema,
  refreshedAt: z.string().datetime(),
});

export type AssetCategory = z.infer<typeof assetCategorySchema>;
export type DataSource = z.infer<typeof dataSourceSchema>;
export type PortfolioAsset = z.infer<typeof portfolioAssetSchema>;
export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>;
