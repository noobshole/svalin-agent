import { lookupToken } from "@svalin-agent/chain-config";
import { detectAddressFamily, isNearAccountId, type PortfolioOverview, type RiskReport } from "@svalin-agent/shared";
import type { FacilitatorClient } from "@x402/core/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { llmsTxt, openApiDocument, paidRoutes, serviceInfo } from "./catalog.js";
import type { AppConfig } from "./env.js";
import { createClientIpResolver } from "./lib/client-ip.js";
import { ApiError } from "./lib/errors.js";
import { DemoRateLimiter, type DemoLimiter } from "./lib/rate-limit.js";
import { TtlCache } from "./lib/ttl-cache.js";
import { AnthropicNarrator, TemplateNarrator, type Narrator } from "./narrate/narrator.js";
import { LogLedger, SupabaseLedger, type PaymentLedger } from "./payments/ledger.js";
import { createPaymentLayer } from "./payments/x402.js";
import { tokenExit } from "./ratings/exit-prices.js";
import { assessRecipient } from "./risk/check.js";
import { buildRiskReport } from "./risk/engine.js";
import { ChainRouterSource } from "./sources/chain-router-source.js";
import { HeliusPortfolioSource } from "./sources/helius-source.js";
import { RemoteIndexFeed, indexedToken, type IndexFeed } from "./sources/index-feed.js";
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
  /** Latest published Svalin Index edition; fetched from NEAR_INDEX_URL by default. */
  indexFeed?: IndexFeed;
};

const PAID_PREFIXES = Object.values(paidRoutes).map((route) => route.path.replace("{address}", ""));
const DEMO_PREFIXES = ["/v1/demo/risk/", "/v1/demo/check/", "/v1/demo/exit/"];
const CHECK_PREFIXES = ["/v1/check/", "/v1/demo/check/"];
const EXIT_PREFIXES = ["/v1/exit/", "/v1/demo/exit/"];

export function createApp(config: AppConfig, deps: AppDependencies = {}) {
  const indexFeed = deps.indexFeed ?? new RemoteIndexFeed(config.portfolio.nearIndexUrl);
  const source =
    deps.portfolioSource ??
    (config.portfolio.source === "live" && config.portfolio.heliusRpcUrl
      ? new ChainRouterSource({
          solana: new HeliusPortfolioSource(config.portfolio.heliusRpcUrl),
          near: new NearPortfolioSource({
            apiUrl: config.portfolio.fastnearApiUrl,
            rpcUrl: config.portfolio.nearRpcUrl,
            priceUrl: config.portfolio.nearPriceApiUrl,
            poolsUrl: config.portfolio.nearPoolsApiUrl,
            dclDepthUrl: config.portfolio.nearDclDepthUrl,
            indexRow: async (contract) => (await indexedToken(indexFeed, contract)).row,
            txApiUrl: config.portfolio.fastnearTxApiUrl,
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
  const demoLimiter = deps.demoLimiter ?? new DemoRateLimiter(config.demo.perDay, config.demo.perDayGlobal);
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
      exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE", "X-Free-Remaining"],
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
    const isDemo = DEMO_PREFIXES.some((prefix) => c.req.path.startsWith(prefix));
    if (!isPaid && !isDemo) return next();

    const address = lastPathSegment(c.req.path);
    if (EXIT_PREFIXES.some((prefix) => c.req.path.startsWith(prefix))) {
      // Exit prices need the token in the Index; a token that is not there is never charged for.
      await gradedToken(address);
      exitSaleQuery(c, isPaid);
    } else {
      assertServableAddress(address, source);
      if (CHECK_PREFIXES.some((prefix) => c.req.path.startsWith(prefix))) checkQuery(c, address);
    }

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
    await useFreeCall(c, "/v1/risk/{address}");
    const report = buildRiskReport(await getOverview(c.req.param("address")));
    return c.json(config.demo.lockNextSteps ? lockNextSteps(report) : report);
  });

  app.get("/v1/demo/check/:address", async (c) => {
    await useFreeCall(c, "/v1/check/{address}");
    return c.json(await checkRecipient(c, false));
  });

  // The Svalin Index: every NEAR token Ref Finance prices, graded by the real money behind it.
  app.get("/v1/index/near-tokens", async (c) => {
    const body = await indexFeed.latest();
    c.header("Cache-Control", "public, max-age=300");
    return c.body(body, 200, { "Content-Type": "application/json; charset=utf-8" });
  });

  app.get("/v1/demo/exit/:address", async (c) => {
    await useFreeCall(c, "/v1/exit/{address}");
    const { index, row } = await gradedToken(c.req.param("address"));
    return c.json(tokenExit(row, index));
  });

  /* --------------------------------- paid ---------------------------------- */

  app.get("/v1/portfolio/:address", async (c) => c.json(await getOverview(c.req.param("address"))));

  app.get("/v1/risk/:address", async (c) => c.json(buildRiskReport(await getOverview(c.req.param("address")))));

  app.get("/v1/brief/:address", async (c) => {
    const report = buildRiskReport(await getOverview(c.req.param("address")));
    return c.json(await narrator.narrate(report));
  });

  app.get("/v1/check/:address", async (c) => c.json(await checkRecipient(c)));

  app.get("/v1/exit/:address", async (c) => {
    const { index, row } = await gradedToken(c.req.param("address"));
    return c.json(tokenExit(row, index, exitSaleQuery(c, true)));
  });

  /**
   * Counts one of the visitor's free calls for today, shared by every free route, and says how many
   * are left (X-Free-Remaining). When none are left: 429, pointing at the paid route.
   */
  async function useFreeCall(c: Context, paidPath: string) {
    const { retryAfter, remaining } = await demoLimiter.check(clientIp(c));
    c.header("X-Free-Remaining", String(remaining));
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new ApiError(
        429,
        "demo_limit_reached",
        `You have used today's ${config.demo.perDay} free calls. They come back at 00:00 UTC.`,
        `Use the paid endpoint GET ${paidPath} via x402 for unlimited access.`,
      );
    }
  }

  /** A NEAR token in the latest Index edition, or the 4xx (or 503) that says why there is none. */
  async function gradedToken(raw: string) {
    const contract = raw.trim().toLowerCase();
    if (!isNearAccountId(contract)) {
      throw new ApiError(400, "invalid_contract", "Not a NEAR token contract.", "Exit prices cover NEAR tokens, for example token.v2.ref-finance.near.");
    }
    if (lookupToken("near", contract)) {
      throw new ApiError(
        404,
        "trusted_token",
        "This is one of the trusted tokens Svalin values others against, so it has no grade.",
        "wNEAR, stablecoins and liquid staking tokens count at full value in Svalin reports.",
      );
    }
    const { index, row } = await indexedToken(indexFeed, contract);
    if (!row) {
      throw new ApiError(
        404,
        "not_in_index",
        "This token is not in the latest Svalin Index edition.",
        "The Index grades every NEAR token Ref Finance prices. A token without a Ref price has no pool to sell into.",
      );
    }
    return { index, row };
  }

  /**
   * Is it safe to pay this address? The query was validated by the gate, before the paywall.
   * The free demo skips the payer's history, the costly part of a check, so free use cannot burn
   * the data budget.
   */
  async function checkRecipient(c: Context, withPayerHistory = true) {
    if (!source.inspectRecipient) {
      throw new ApiError(501, "chain_not_supported", "This instance cannot check recipients.");
    }
    const recipient = c.req.param("address") ?? "";
    const { payer, amountUsd } = checkQuery(c, recipient);
    const signals = await source.inspectRecipient(recipient, withPayerHistory ? payer : null);
    return assessRecipient({ ...signals, payer }, amountUsd, new Date(), { payerHistorySkipped: !withPayerHistory });
  }

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

/**
 * The free report without its next steps: the grade, the score, the exposure and what is wrong
 * stay, and how to fix it is the paid part. The text is left out, not hidden, so it cannot be read
 * from the response.
 */
export function lockNextSteps(report: RiskReport): RiskReport {
  if (report.findings.length === 0) return report;
  return {
    ...report,
    findings: report.findings.map((finding) => ({ ...finding, action: null })),
    locked: {
      nextSteps: true,
      unlock: "Next steps are in the paid report: GET /v1/risk/{address} via x402, or Svalin Pro on the Svalin website.",
    },
  };
}

/** The address in a route's last path segment. Broken percent-encoding is a bad address (400), not a crash. */
function lastPathSegment(path: string): string {
  try {
    return decodeURIComponent(path.split("/").pop() ?? "");
  } catch {
    throw new ApiError(400, "invalid_address", "Not a valid Solana address or NEAR account ID.");
  }
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

/**
 * The recipient check's query: an optional payer on the same chain as the recipient, and an
 * optional amount in USD. Invalid values are rejected with 400 before the paywall.
 */
function checkQuery(c: Context, recipient: string): { payer: string | null; amountUsd: number | null } {
  const payer = c.req.query("payer")?.trim() || null;
  if (payer !== null) {
    const family = detectAddressFamily(payer);
    if (!family) throw new ApiError(400, "invalid_payer", "payer is not a valid Solana address or NEAR account ID.");
    if (family !== detectAddressFamily(recipient)) {
      throw new ApiError(400, "chain_mismatch", "payer and recipient must be on the same chain.");
    }
  }
  const rawAmount = c.req.query("amountUsd")?.trim();
  const amountUsd = rawAmount ? Number(rawAmount) : null;
  if (amountUsd !== null && (!Number.isFinite(amountUsd) || amountUsd < 0 || amountUsd > 1e12)) {
    throw new ApiError(400, "invalid_amount", "amountUsd must be a number of US dollars, 0 or more.");
  }
  return { payer, amountUsd };
}

/**
 * Exit prices' optional extra sale size: more than 0 and at most $1 trillion. Your own size is a
 * paid feature; the free trial quotes the standard sizes only.
 */
function exitSaleQuery(c: Context, paid: boolean): number | undefined {
  const raw = c.req.query("amountUsd")?.trim();
  if (!raw) return undefined;
  if (!paid) {
    throw new ApiError(400, "amount_needs_paid_route", "The free trial quotes $1K, $10K and $100K only.", "For your own sale size use GET /v1/exit/{address}?amountUsd= via x402.");
  }
  const amountUsd = Number(raw);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1e12) {
    throw new ApiError(400, "invalid_amount", "amountUsd must be a number of US dollars, more than 0.");
  }
  return amountUsd;
}
