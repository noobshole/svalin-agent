import { z } from "zod";
export declare const agentSuggestionSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<["rebalance", "concentration", "yield", "risk"]>;
    title: z.ZodString;
    summary: z.ZodString;
    actionLabel: z.ZodString;
    confidence: z.ZodNumber;
    chain: z.ZodEnum<["ethereum", "base", "solana"]>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    chain: "ethereum" | "base" | "solana";
    id: string;
    kind: "rebalance" | "concentration" | "yield" | "risk";
    title: string;
    summary: string;
    actionLabel: string;
    confidence: number;
    createdAt: string;
}, {
    chain: "ethereum" | "base" | "solana";
    id: string;
    kind: "rebalance" | "concentration" | "yield" | "risk";
    title: string;
    summary: string;
    actionLabel: string;
    confidence: number;
    createdAt: string;
}>;
export declare const agentSuggestionsResponseSchema: z.ZodObject<{
    wallet: z.ZodType<`0x${string}`, z.ZodTypeDef, `0x${string}`>;
    generatedAt: z.ZodString;
    suggestions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<["rebalance", "concentration", "yield", "risk"]>;
        title: z.ZodString;
        summary: z.ZodString;
        actionLabel: z.ZodString;
        confidence: z.ZodNumber;
        chain: z.ZodEnum<["ethereum", "base", "solana"]>;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        chain: "ethereum" | "base" | "solana";
        id: string;
        kind: "rebalance" | "concentration" | "yield" | "risk";
        title: string;
        summary: string;
        actionLabel: string;
        confidence: number;
        createdAt: string;
    }, {
        chain: "ethereum" | "base" | "solana";
        id: string;
        kind: "rebalance" | "concentration" | "yield" | "risk";
        title: string;
        summary: string;
        actionLabel: string;
        confidence: number;
        createdAt: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    wallet: `0x${string}`;
    generatedAt: string;
    suggestions: {
        chain: "ethereum" | "base" | "solana";
        id: string;
        kind: "rebalance" | "concentration" | "yield" | "risk";
        title: string;
        summary: string;
        actionLabel: string;
        confidence: number;
        createdAt: string;
    }[];
}, {
    wallet: `0x${string}`;
    generatedAt: string;
    suggestions: {
        chain: "ethereum" | "base" | "solana";
        id: string;
        kind: "rebalance" | "concentration" | "yield" | "risk";
        title: string;
        summary: string;
        actionLabel: string;
        confidence: number;
        createdAt: string;
    }[];
}>;
