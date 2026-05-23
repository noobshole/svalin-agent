import { z } from "zod";
export declare const chainFamilySchema: z.ZodEnum<["evm", "solana"]>;
export declare const chainContractSchema: z.ZodObject<{
    id: z.ZodString;
    chain: z.ZodEnum<["ethereum", "base", "solana"]>;
    family: z.ZodEnum<["evm", "solana"]>;
    name: z.ZodString;
    address: z.ZodString;
    explorerUrl: z.ZodString;
    description: z.ZodString;
    isTestContract: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    chain: "ethereum" | "base" | "solana";
    name: string;
    id: string;
    family: "solana" | "evm";
    address: string;
    explorerUrl: string;
    description: string;
    isTestContract: boolean;
}, {
    chain: "ethereum" | "base" | "solana";
    name: string;
    id: string;
    family: "solana" | "evm";
    address: string;
    explorerUrl: string;
    description: string;
    isTestContract: boolean;
}>;
export declare const chainContractRegistrySchema: z.ZodObject<{
    generatedAt: z.ZodString;
    contracts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        chain: z.ZodEnum<["ethereum", "base", "solana"]>;
        family: z.ZodEnum<["evm", "solana"]>;
        name: z.ZodString;
        address: z.ZodString;
        explorerUrl: z.ZodString;
        description: z.ZodString;
        isTestContract: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        chain: "ethereum" | "base" | "solana";
        name: string;
        id: string;
        family: "solana" | "evm";
        address: string;
        explorerUrl: string;
        description: string;
        isTestContract: boolean;
    }, {
        chain: "ethereum" | "base" | "solana";
        name: string;
        id: string;
        family: "solana" | "evm";
        address: string;
        explorerUrl: string;
        description: string;
        isTestContract: boolean;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    generatedAt: string;
    contracts: {
        chain: "ethereum" | "base" | "solana";
        name: string;
        id: string;
        family: "solana" | "evm";
        address: string;
        explorerUrl: string;
        description: string;
        isTestContract: boolean;
    }[];
}, {
    generatedAt: string;
    contracts: {
        chain: "ethereum" | "base" | "solana";
        name: string;
        id: string;
        family: "solana" | "evm";
        address: string;
        explorerUrl: string;
        description: string;
        isTestContract: boolean;
    }[];
}>;
