import { z } from "zod";
export declare const supportedChainKeySchema: z.ZodEnum<["ethereum", "base", "solana"]>;
export declare const portfolioAssetSchema: z.ZodObject<{
    chain: z.ZodEnum<["ethereum", "base", "solana"]>;
    tokenAddress: z.ZodType<`0x${string}`, z.ZodTypeDef, `0x${string}`>;
    symbol: z.ZodString;
    name: z.ZodString;
    balance: z.ZodString;
    priceUsd: z.ZodNumber;
    valueUsd: z.ZodNumber;
    allocationBps: z.ZodNumber;
    change24hPct: z.ZodNullable<z.ZodNumber>;
    isCoreHolding: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    chain: "ethereum" | "base" | "solana";
    tokenAddress: `0x${string}`;
    name: string;
    balance: string;
    priceUsd: number;
    valueUsd: number;
    allocationBps: number;
    change24hPct: number | null;
    isCoreHolding: boolean;
}, {
    symbol: string;
    chain: "ethereum" | "base" | "solana";
    tokenAddress: `0x${string}`;
    name: string;
    balance: string;
    priceUsd: number;
    valueUsd: number;
    allocationBps: number;
    change24hPct: number | null;
    isCoreHolding: boolean;
}>;
export declare const portfolioOverviewSchema: z.ZodObject<{
    wallet: z.ZodType<`0x${string}`, z.ZodTypeDef, `0x${string}`>;
    totalValueUsd: z.ZodNumber;
    dayChangePct: z.ZodNullable<z.ZodNumber>;
    riskScore: z.ZodNullable<z.ZodNumber>;
    assets: z.ZodArray<z.ZodObject<{
        chain: z.ZodEnum<["ethereum", "base", "solana"]>;
        tokenAddress: z.ZodType<`0x${string}`, z.ZodTypeDef, `0x${string}`>;
        symbol: z.ZodString;
        name: z.ZodString;
        balance: z.ZodString;
        priceUsd: z.ZodNumber;
        valueUsd: z.ZodNumber;
        allocationBps: z.ZodNumber;
        change24hPct: z.ZodNullable<z.ZodNumber>;
        isCoreHolding: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        chain: "ethereum" | "base" | "solana";
        tokenAddress: `0x${string}`;
        name: string;
        balance: string;
        priceUsd: number;
        valueUsd: number;
        allocationBps: number;
        change24hPct: number | null;
        isCoreHolding: boolean;
    }, {
        symbol: string;
        chain: "ethereum" | "base" | "solana";
        tokenAddress: `0x${string}`;
        name: string;
        balance: string;
        priceUsd: number;
        valueUsd: number;
        allocationBps: number;
        change24hPct: number | null;
        isCoreHolding: boolean;
    }>, "many">;
    refreshedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    wallet: `0x${string}`;
    totalValueUsd: number;
    dayChangePct: number | null;
    riskScore: number | null;
    assets: {
        symbol: string;
        chain: "ethereum" | "base" | "solana";
        tokenAddress: `0x${string}`;
        name: string;
        balance: string;
        priceUsd: number;
        valueUsd: number;
        allocationBps: number;
        change24hPct: number | null;
        isCoreHolding: boolean;
    }[];
    refreshedAt: string;
}, {
    wallet: `0x${string}`;
    totalValueUsd: number;
    dayChangePct: number | null;
    riskScore: number | null;
    assets: {
        symbol: string;
        chain: "ethereum" | "base" | "solana";
        tokenAddress: `0x${string}`;
        name: string;
        balance: string;
        priceUsd: number;
        valueUsd: number;
        allocationBps: number;
        change24hPct: number | null;
        isCoreHolding: boolean;
    }[];
    refreshedAt: string;
}>;
