import { z } from "zod";
import { supportedChainKeySchema } from "./portfolio.js";
export const chainFamilySchema = z.enum(["evm", "solana"]);
export const chainContractSchema = z.object({
    id: z.string().min(1),
    chain: supportedChainKeySchema,
    family: chainFamilySchema,
    name: z.string().min(1),
    address: z.string().min(1),
    explorerUrl: z.string().url(),
    description: z.string().min(1),
    isTestContract: z.boolean(),
});
export const chainContractRegistrySchema = z.object({
    generatedAt: z.string().datetime(),
    contracts: z.array(chainContractSchema),
});
