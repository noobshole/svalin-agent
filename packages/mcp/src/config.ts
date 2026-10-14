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
  SVALIN_NEAR_PRIVATE_KEY: z
    .string()
    .regex(/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]+$/, "SVALIN_NEAR_PRIVATE_KEY must look like ed25519:…")
    .optional(),
  SVALIN_NEAR_RPC_URL: z.string().url().optional(),
  SVALIN_PREFERRED_NETWORK: z.enum(["solana", "near"]).default("solana"),
  SVALIN_MAX_PRICE_USD: z.coerce.number().positive().default(0.05),
  SVALIN_BUDGET_USD: z.coerce.number().positive().default(1),
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
