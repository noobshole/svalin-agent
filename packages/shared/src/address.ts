import { z } from "zod";

export type ChainFamily = "solana" | "near";
export type SupportedChainKey = "solana" | "near";

// Base58 alphabet (no 0, O, I, l). Solana public keys are 32 bytes -> 32..44 chars.
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// NEAR account IDs: 2-64 lowercase characters, parts of [a-z0-9] joined by "-" or "_",
// separated by dots. Covers named ("alice.near"), implicit (64 hex) and eth-implicit
// ("0x" + 40 hex) accounts.
const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isSolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS.test(value);
}

export function isNearAccountId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && NEAR_ACCOUNT_ID.test(value);
}

/**
 * Returns the chain family an address belongs to, or null when it is neither.
 * A string that is valid on both is resolved by case: NEAR account IDs are always
 * lowercase, while Solana addresses (random base58) practically always contain capitals.
 */
export function detectAddressFamily(value: string): ChainFamily | null {
  if (isSolanaAddress(value) && /[A-Z]/.test(value)) return "solana";
  if (isNearAccountId(value)) return "near";
  if (isSolanaAddress(value)) return "solana";
  return null;
}

export const chainFamilySchema = z.enum(["solana", "near"]);
export const supportedChainKeySchema = z.enum(["solana", "near"]);

export const solanaAddressSchema = z.string().regex(SOLANA_ADDRESS, "Invalid Solana address");
export const nearAccountIdSchema = z.string().refine(isNearAccountId, { message: "Invalid NEAR account ID" });

/** Any wallet address Svalin understands (Solana base58 or a NEAR account ID). */
export const walletAddressSchema = z
  .string()
  .refine((value) => detectAddressFamily(value) !== null, {
    message: "Expected a Solana (base58) address or a NEAR account ID",
  });

/** Token / mint address on any supported chain (NEAR token contracts are account IDs). */
export const tokenAddressSchema = walletAddressSchema;
