import { z } from "zod";
export declare const allocationDatumSchema: z.ZodObject<{
    label: z.ZodString;
    valueUsd: z.ZodNumber;
    allocationPct: z.ZodNumber;
    chain: z.ZodEnum<["ethereum", "base", "solana"]>;
}, "strip", z.ZodTypeAny, {
    chain: "ethereum" | "base" | "solana";
    valueUsd: number;
    label: string;
    allocationPct: number;
}, {
    chain: "ethereum" | "base" | "solana";
    valueUsd: number;
    label: string;
    allocationPct: number;
}>;
export declare const performanceDatumSchema: z.ZodObject<{
    label: z.ZodString;
    valueUsd: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    valueUsd: number;
    label: string;
}, {
    valueUsd: number;
    label: string;
}>;
export declare const chainExposureDatumSchema: z.ZodObject<{
    chain: z.ZodEnum<["ethereum", "base", "solana"]>;
    valueUsd: z.ZodNumber;
    allocationPct: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    chain: "ethereum" | "base" | "solana";
    valueUsd: number;
    allocationPct: number;
}, {
    chain: "ethereum" | "base" | "solana";
    valueUsd: number;
    allocationPct: number;
}>;
export declare const portfolioAnalyticsSchema: z.ZodObject<{
    wallet: z.ZodType<`0x${string}`, z.ZodTypeDef, `0x${string}`>;
    generatedAt: z.ZodString;
    allocation: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        valueUsd: z.ZodNumber;
        allocationPct: z.ZodNumber;
        chain: z.ZodEnum<["ethereum", "base", "solana"]>;
    }, "strip", z.ZodTypeAny, {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        label: string;
        allocationPct: number;
    }, {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        label: string;
        allocationPct: number;
    }>, "many">;
    performance: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        valueUsd: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        valueUsd: number;
        label: string;
    }, {
        valueUsd: number;
        label: string;
    }>, "many">;
    chainExposure: z.ZodArray<z.ZodObject<{
        chain: z.ZodEnum<["ethereum", "base", "solana"]>;
        valueUsd: z.ZodNumber;
        allocationPct: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        allocationPct: number;
    }, {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        allocationPct: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    wallet: `0x${string}`;
    generatedAt: string;
    allocation: {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        label: string;
        allocationPct: number;
    }[];
    performance: {
        valueUsd: number;
        label: string;
    }[];
    chainExposure: {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        allocationPct: number;
    }[];
}, {
    wallet: `0x${string}`;
    generatedAt: string;
    allocation: {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        label: string;
        allocationPct: number;
    }[];
    performance: {
        valueUsd: number;
        label: string;
    }[];
    chainExposure: {
        chain: "ethereum" | "base" | "solana";
        valueUsd: number;
        allocationPct: number;
    }[];
}>;
