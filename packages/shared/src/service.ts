import { z } from "zod";

import { chainFamilySchema, supportedChainKeySchema } from "./address.js";

export const endpointSchema = z.object({
  method: z.literal("GET"),
  path: z.string(),
  description: z.string(),
  /** USD price per call, e.g. "$0.01". null = free. */
  price: z.string().nullable(),
  returns: z.string(),
});

export const paymentNetworkSchema = z.object({
  /** CAIP-2 identifier, e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp". */
  network: z.string(),
  label: z.string(),
  asset: z.literal("USDC"),
  payTo: z.string(),
});

export const chainSupportSchema = z.object({
  chain: supportedChainKeySchema,
  family: chainFamilySchema,
  status: z.enum(["live", "sample-data", "unsupported"]),
  note: z.string(),
});

export const serviceInfoSchema = z.object({
  name: z.literal("Svalin"),
  version: z.string(),
  tagline: z.string(),
  readOnly: z.literal(true),
  /** Svalin can never sign, approve or move funds. This is a design guarantee, not a setting. */
  canMoveFunds: z.literal(false),
  payments: z.object({
    protocol: z.literal("x402"),
    enabled: z.boolean(),
    networks: z.array(paymentNetworkSchema),
  }),
  chains: z.array(chainSupportSchema),
  endpoints: z.array(endpointSchema),
  links: z.object({
    docs: z.string(),
    openapi: z.string(),
    llms: z.string(),
    mcp: z.string(),
  }),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  hint: z.string().optional(),
});

export type Endpoint = z.infer<typeof endpointSchema>;
export type PaymentNetwork = z.infer<typeof paymentNetworkSchema>;
export type ChainSupport = z.infer<typeof chainSupportSchema>;
export type ServiceInfo = z.infer<typeof serviceInfoSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
