import { z } from "zod";

import type { Address } from "../types/core.js";
import { supportedChainKeySchema } from "./portfolio.js";

const addressSchema = z.custom<Address>(
  (value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value),
  {
    message: "Invalid address format",
  },
);

export const agentSuggestionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["rebalance", "concentration", "yield", "risk"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  actionLabel: z.string().min(1),
  confidence: z.number().min(0).max(100),
  chain: supportedChainKeySchema,
  createdAt: z.string().datetime(),
});

export const agentSuggestionsResponseSchema = z.object({
  wallet: addressSchema,
  generatedAt: z.string().datetime(),
  suggestions: z.array(agentSuggestionSchema),
});

export const agentActionSchema = z.enum([
  "portfolio-analysis",
  "risk-review",
  "yield-scan",
  "staking-review",
  "recommendations",
]);

export const agentCapabilitySchema = z.object({
  chain: supportedChainKeySchema,
  family: z.enum(["evm", "solana"]),
  status: z.enum(["ready", "partial", "planned"]),
  supportedActions: z.array(agentActionSchema).min(1),
  readOnly: z.boolean(),
  autoTransactionsEnabled: z.boolean(),
  notes: z.array(z.string().min(1)),
  updatedAt: z.string().datetime(),
});

export const agentCapabilitiesResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  capabilities: z.array(agentCapabilitySchema),
});
