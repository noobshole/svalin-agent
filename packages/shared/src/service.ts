import { z } from "zod";

import { chainFamilySchema, supportedChainKeySchema } from "./address.js";
import { tokenGradeSchema } from "./token-index.js";

export const endpointSchema = z.object({
  method: z.enum(["GET", "POST"]),
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
  /** "mainnet" takes real USDC; "testnet" takes free test USDC. Each chain is set on its own. */
  environment: z.enum(["mainnet", "testnet"]).optional(),
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

/** The token a scanned address turned out to be, returned instead of a wallet report. */
export const tokenNoticeSchema = z.object({
  chain: chainFamilySchema,
  address: z.string(),
  symbol: z.string().nullable(),
  /** Svalin Index grade. Null for the trusted tokens others are valued against, and on Solana. */
  grade: tokenGradeSchema.nullable(),
  /** Trusted money in the token's pools, in USD. Null when it has no grade. */
  backingUsd: z.number().nullable(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  hint: z.string().optional(),
  /** Set with code "token_address": the address is a token, not a wallet. */
  token: tokenNoticeSchema.optional(),
});

export type Endpoint = z.infer<typeof endpointSchema>;
export type PaymentNetwork = z.infer<typeof paymentNetworkSchema>;
export type ChainSupport = z.infer<typeof chainSupportSchema>;
export type ServiceInfo = z.infer<typeof serviceInfoSchema>;
export type TokenNotice = z.infer<typeof tokenNoticeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
