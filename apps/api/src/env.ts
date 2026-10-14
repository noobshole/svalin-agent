import { isNearAccountId, isSolanaAddress } from "@svalin-agent/shared";
import { z } from "zod";

const usdPrice = z
  .string()
  .regex(/^\$\d+(\.\d+)?$/, 'Prices look like "$0.01"');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BASE_URL: optionalString,
  ALLOWED_ORIGINS: optionalString,

  // "live": Helius for Solana and FastNEAR for NEAR. "mock": labelled sample data.
  PORTFOLIO_SOURCE: z.enum(["live", "mock"]).optional(),
  HELIUS_API_KEY: optionalString,
  HELIUS_RPC_URL: optionalString,
  FASTNEAR_API_URL: z.string().url().default("https://api.fastnear.com"),
  NEAR_RPC_URL: z.string().url().default("https://rpc.mainnet.fastnear.com"),
  NEAR_PRICE_API_URL: z.string().url().default("https://indexer.ref.finance/list-token-price"),
  PORTFOLIO_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(60),

  X402_ENV: z.enum(["mainnet", "testnet"]).optional(),
  X402_FACILITATOR_URL: optionalString,
  // Coinbase Developer Platform keys. When set, payments settle through the CDP facilitator
  // first, which is what lists the API in Coinbase's x402 Bazaar.
  CDP_API_KEY_ID: optionalString,
  CDP_API_KEY_SECRET: optionalString,
  PAY_TO_SOLANA: optionalString,
  PAY_TO_NEAR: optionalString,
  // NEAR payments settle through a NEAR facilitator. The default (FastNEAR reference
  // facilitator) issues one API key per network and payee.
  NEAR_FACILITATOR_URL: optionalString,
  NEAR_FACILITATOR_API_KEY: optionalString,
  PRICE_PORTFOLIO_USD: usdPrice.default("$0.002"),
  PRICE_RISK_USD: usdPrice.default("$0.004"),
  PRICE_BRIEF_USD: usdPrice.default("$0.02"),

  DEMO_REQUESTS_PER_HOUR: z.coerce.number().int().nonnegative().default(10),
  DEMO_REQUESTS_PER_DAY_GLOBAL: z.coerce.number().int().nonnegative().default(2000),
  // How many proxies your host puts in front of the API (Railway, Render and Fly.io: 1).
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  // Shared with the web app so it can pass each visitor's IP for the per-visitor demo limit.
  WEB_FORWARDING_SECRET: optionalString.refine((value) => !value || value.length >= 24, {
    message: "WEB_FORWARDING_SECRET must be at least 24 characters.",
  }),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-haiku-5-5"),

  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: Record<string, string | undefined> = process.env) {
  const env = envSchema.parse(source);
  const isProduction = env.NODE_ENV === "production";

  if (env.PAY_TO_SOLANA && !isSolanaAddress(env.PAY_TO_SOLANA)) {
    throw new Error("PAY_TO_SOLANA is not a valid Solana address.");
  }
  if (env.PAY_TO_NEAR && !isNearAccountId(env.PAY_TO_NEAR)) {
    throw new Error("PAY_TO_NEAR is not a valid NEAR account ID.");
  }

  const portfolioSource = env.PORTFOLIO_SOURCE ?? (env.HELIUS_API_KEY || env.HELIUS_RPC_URL ? "live" : "mock");

  if (portfolioSource === "live" && !env.HELIUS_API_KEY && !env.HELIUS_RPC_URL) {
    throw new Error("PORTFOLIO_SOURCE=live needs HELIUS_API_KEY (or HELIUS_RPC_URL) for Solana data.");
  }
  if (isProduction && portfolioSource === "mock") {
    // Never charge real money for sample data.
    throw new Error("Refusing to start in production with mock portfolio data. Set HELIUS_API_KEY.");
  }

  if (Boolean(env.CDP_API_KEY_ID) !== Boolean(env.CDP_API_KEY_SECRET)) {
    throw new Error("Set both CDP_API_KEY_ID and CDP_API_KEY_SECRET, or neither.");
  }

  const paymentsConfigured = Boolean(env.PAY_TO_SOLANA || env.PAY_TO_NEAR);

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, ""),
    allowedOrigins: env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
      : ["http://localhost:3000", "http://127.0.0.1:3000"],

    portfolio: {
      source: portfolioSource,
      heliusRpcUrl:
        env.HELIUS_RPC_URL ??
        (env.HELIUS_API_KEY
          ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`
          : undefined),
      fastnearApiUrl: env.FASTNEAR_API_URL.replace(/\/+$/, ""),
      nearRpcUrl: env.NEAR_RPC_URL,
      nearPriceApiUrl: env.NEAR_PRICE_API_URL,
      cacheSeconds: env.PORTFOLIO_CACHE_SECONDS,
    },

    payments: {
      /**
       * "x402"     → paid routes require a USDC payment.
       * "disabled" → no payTo configured. Paid routes are free in dev, 503 in production.
       */
      mode: paymentsConfigured ? ("x402" as const) : ("disabled" as const),
      environment: env.X402_ENV ?? (isProduction ? "mainnet" : "testnet"),
      facilitatorUrl: env.X402_FACILITATOR_URL,
      cdp:
        env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET
          ? { apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET }
          : undefined,
      payToSolana: env.PAY_TO_SOLANA,
      payToNear: env.PAY_TO_NEAR,
      nearFacilitator: {
        url: env.NEAR_FACILITATOR_URL,
        apiKey: env.NEAR_FACILITATOR_API_KEY,
      },
      prices: {
        portfolio: env.PRICE_PORTFOLIO_USD,
        risk: env.PRICE_RISK_USD,
        brief: env.PRICE_BRIEF_USD,
      },
    },

    demo: {
      perHour: env.DEMO_REQUESTS_PER_HOUR,
      perDayGlobal: env.DEMO_REQUESTS_PER_DAY_GLOBAL,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
      forwardingSecret: env.WEB_FORWARDING_SECRET,
    },

    narrator: {
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    },

    ledger: {
      supabaseUrl: env.SUPABASE_URL,
      supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };
}
