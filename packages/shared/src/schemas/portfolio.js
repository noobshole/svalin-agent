import { z } from "zod";
const addressSchema = z.custom((value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value), {
    message: "Invalid address format",
});
export const supportedChainKeySchema = z.enum(["ethereum", "base", "solana"]);
export const portfolioAssetSchema = z.object({
    chain: supportedChainKeySchema,
    tokenAddress: addressSchema,
    symbol: z.string().min(1),
    name: z.string().min(1),
    balance: z.string().min(1),
    priceUsd: z.number().nonnegative(),
    valueUsd: z.number().nonnegative(),
    allocationBps: z.number().int().min(0).max(10_000),
    change24hPct: z.number().nullable(),
    isCoreHolding: z.boolean(),
});
export const portfolioOverviewSchema = z.object({
    wallet: addressSchema,
    totalValueUsd: z.number().nonnegative(),
    dayChangePct: z.number().nullable(),
    riskScore: z.number().min(0).max(100).nullable(),
    assets: z.array(portfolioAssetSchema),
    refreshedAt: z.string().datetime(),
});
