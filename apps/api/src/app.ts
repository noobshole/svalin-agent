import { detectAddressFamily, type PortfolioOverview } from "@svalin-agent/shared";
import type { FacilitatorClient } from "@x402/core/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { llmsTxt, openApiDocument, serviceInfo } from "./catalog.js";
import type { AppConfig } from "./env.js";
import { createClientIpResolver } from "./lib/client-ip.js";
import { ApiError } from "./lib/errors.js";
import { DemoRateLimiter, type DemoLimiter } from "./lib/rate-limit.js";
import { TtlCache } from "./lib/ttl-cache.js";
import { AnthropicNarrator, TemplateNarrator, type Narrator } from "./narrate/narrator.js";
import { LogLedger, SupabaseLedger, type PaymentLedger } from "./payments/ledger.js";
import { createPaymentLayer } from "./payments/x402.js";
import { buildRiskReport } from "./risk/engine.js";
import { ChainRouterSource } from "./sources/chain-router-source.js";
import { HeliusPortfolioSource } from "./sources/helius-source.js";
import { MockPortfolioSource } from "./sources/mock-source.js";
import { NearPortfolioSource } from "./sources/near-source.js";
import type { PortfolioSource } from "./sources/portfolio-source.js";

export type AppDependencies = {
  portfolioSource?: PortfolioSource;
  narrator?: Narrator;
  ledger?: PaymentLedger;
  facilitator?: FacilitatorClient;
  /** See PaymentLayerOptions: Cloudflare Workers use "first-paid-request" and no discovery. */
  paymentInitialization?: "startup" | "first-paid-request";
  paymentDiscovery?: boolean;
  /** Resolves the client IP for demo rate limiting. */
  clientIp?: (c: Context) => string;
  /** Shared demo limiter (Cloudflare Workers use a Durable Object); in memory by default. */
  demoLimiter?: DemoLimiter;
};

const PAID_PREFIXES = ["/v1/portfolio/", "/v1/risk/", "/v1/brief/"];

export function createApp(config: AppConfig, deps: AppDependencies = {}) {
  const source =
    deps.portfolioSource ??
    (config.portfolio.source === "live" && config.portfolio.heliusRpcUrl
      ? new ChainRouterSource({
          solana: new HeliusPortfolioSource(config.portfolio.heliusRpcUrl),
          near: new NearPortfolioSource({
            apiUrl: config.portfolio.fastnearApiUrl,
            rpcUrl: config.portfolio.nearRpcUrl,
            priceUrl: config.portfolio.nearPriceApiUrl,
          }),
        })
      : new MockPortfolioSource());

  const narrator =
    deps.narrator ??
    (config.narrator.anthropicApiKey
      ? new AnthropicNarrator(config.narrator.anthropicApiKey, config.narrator.model)
      : new TemplateNarrator());

  const ledger =
    deps.ledger ??
    (config.ledger.supabaseUrl && config.ledger.supabaseServiceRoleKey
      ? new SupabaseLedger(config.ledger.supabaseUrl, config.ledger.supabaseServiceRoleKey)
      : new LogLedger());

  const cache = new TtlCache<PortfolioOverview>(config.portfolio.cacheSeconds * 1000);
  const demoLimiter = deps.demoLimiter ?? new DemoRateLimiter(config.demo.perHour, config.demo.perDayGlobal);
  const clientIp =
    deps.clientIp ??
    createClientIpResolver({
      trustedProxyHops: config.demo.trustedProxyHops,
      forwardingSecret: config.demo.forwardingSecret,
    });

  const getOverview = (address: string) => cache.getOrCompute(address, () => source.getOverview(address));

  const app = new Hono();

  /* ------------------------------- middleware ------------------------------ */

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE", "X-PAYMENT"],
      exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"],
      maxAge: 600,
    }),
  );

  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    if (c.req.path === "/health") return;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "request",
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      }),
    );
  });

  // Validate the address BEFORE the paywall, so nobody is asked to pay for a request
  // that can only fail.
  app.use("/v1/*", async (c, next) => {
    const isPaid = PAID_PREFIXES.some((prefix) => c.req.path.startsWith(prefix));
    const isDemo = c.req.path.startsWith("/v1/demo/risk/");
    if (!isPaid && !isDemo) return next();

    const address = decodeURIComponent(c.req.path.split("/").pop() ?? "");
    assertServableAddress(address, source);

    if (isPaid && config.payments.mode === "disabled" && config.isProduction) {
      throw new ApiError(503, "payments_not_configured", "Paid endpoints are not available on this instance yet.");
    }
    return next();
  });

  if (config.payments.mode === "x402") {
    app.use(
      "/v1/*",
      createPaymentLayer(config, {
        facilitator: deps.facilitator,
        ledger,
        initialization: deps.paymentInitialization,
        discovery: deps.paymentDiscovery,
      }),
    );
  }

  /* --------------------------------- free ---------------------------------- */

  app.get("/", (c) => c.json(serviceInfo(config)));
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/openapi.json", (c) => c.json(openApiDocument(config)));
  app.get("/llms.txt", (c) => c.text(llmsTxt(config)));

  app.get("/v1/demo/risk/:address", async (c) => {
    const retryAfter = await demoLimiter.check(clientIp(c));
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new ApiError(
        429,
        "demo_limit_reached",
        "Free demo limit reached.",
        "Use the paid endpoint GET /v1/risk/{address} via x402 for unlimited access.",
      );
    }
    const report = buildRiskReport(await getOverview(c.req.param("address")));
    return c.json(report);
  });

  /* --------------------------------- paid ---------------------------------- */

  app.get("/v1/portfolio/:address", async (c) => c.json(await getOverview(c.req.param("address"))));

  app.get("/v1/risk/:address", async (c) => c.json(buildRiskReport(await getOverview(c.req.param("address")))));

  app.get("/v1/brief/:address", async (c) => {
    const report = buildRiskReport(await getOverview(c.req.param("address")));
    return c.json(await narrator.narrate(report));
  });

  /* -------------------------------- errors --------------------------------- */

  app.notFound((c) => c.json({ error: "Route not found.", code: "not_found", hint: "GET / lists every endpoint." }, 404));

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(error.toBody(), error.status);
    }
    console.error(JSON.stringify({ level: "error", msg: "unhandled", error: String(error), stack: (error as Error).stack }));
    return c.json({ error: "Internal server error.", code: "internal_error" }, 500);
  });

  return app;
}

function assertServableAddress(address: string, source: PortfolioSource) {
  const family = detectAddressFamily(address);
  if (!family) {
    throw new ApiError(400, "invalid_address", "Not a valid Solana address or NEAR account ID.");
  }
  if (!source.supports(family)) {
    throw new ApiError(
      501,
      "chain_not_supported",
      "This instance cannot analyse wallets on this chain.",
      "Svalin analyses Solana wallets and NEAR accounts.",
    );
  }
}
