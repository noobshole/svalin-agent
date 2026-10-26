import { z } from "zod";

const envSchema = z.object({
  SVALIN_API_URL: z
    .string({ required_error: "Set SVALIN_API_URL to your Svalin API base URL (e.g. https://your-svalin-api.example.com)" })
    .url(),
  SVALIN_SOLANA_PRIVATE_KEY: z.string().optional(),
  SVALIN_SOLANA_RPC_URL: z.string().url().optional(),
  SVALIN_NEAR_ACCOUNT_ID: z
    .string()
    .max(64)
    .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "SVALIN_NEAR_ACCOUNT_ID must be a NEAR account ID, e.g. alice.near")
    .optional(),
  // ed25519 only: NEAR's secp256k1 keys sign through the `elliptic` package, whose ECDSA can leak
  // the key in rare cases (GHSA-848j-6mx2-7j84, no fix released).
  SVALIN_NEAR_PRIVATE_KEY: z
    .string()
    .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/, "SVALIN_NEAR_PRIVATE_KEY must be an ed25519 key, like ed25519:…")
    .optional(),
  SVALIN_NEAR_RPC_URL: z.string().url().optional(),
  SVALIN_PREFERRED_NETWORK: z.enum(["solana", "near"]).default("solana"),
  SVALIN_MAX_PRICE_USD: z.coerce.number().positive().default(0.05),
  SVALIN_BUDGET_USD: z.coerce.number().positive().default(1),
  /** Where the payment guard remembers each service's payee and price (default ~/.svalin/payees.json). */
  SVALIN_PAYEE_MEMORY: z.string().optional(),
}).refine((env) => Boolean(env.SVALIN_NEAR_ACCOUNT_ID) === Boolean(env.SVALIN_NEAR_PRIVATE_KEY), {
  message: "Set both SVALIN_NEAR_ACCOUNT_ID and SVALIN_NEAR_PRIVATE_KEY, or neither.",
});

export type McpConfig = z.infer<typeof envSchema>;

export function loadMcpConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const cleaned = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  return envSchema.parse(cleaned);
}
