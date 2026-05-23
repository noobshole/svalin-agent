import { z } from "zod";
import { supportedChainKeySchema } from "./portfolio.js";
const addressSchema = z.custom((value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value), {
    message: "Invalid address format",
});
export const allocationDatumSchema = z.object({
    label: z.string().min(1),
    valueUsd: z.number().nonnegative(),
    allocationPct: z.number().min(0).max(100),
    chain: supportedChainKeySchema,
});
export const performanceDatumSchema = z.object({
    label: z.string().min(1),
    valueUsd: z.number().nonnegative(),
});
export const chainExposureDatumSchema = z.object({
    chain: supportedChainKeySchema,
    valueUsd: z.number().nonnegative(),
    allocationPct: z.number().min(0).max(100),
});
export const portfolioAnalyticsSchema = z.object({
    wallet: addressSchema,
    generatedAt: z.string().datetime(),
    allocation: z.array(allocationDatumSchema),
    performance: z.array(performanceDatumSchema),
    chainExposure: z.array(chainExposureDatumSchema),
});
