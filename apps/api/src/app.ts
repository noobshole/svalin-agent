import { lookupToken } from "@svalin-agent/chain-config";
import {
  AGENT_KEY_PREFIX,
  PRO_CODE_PREFIX,
  SVALIN_KEY_PATTERN,
  detectAddressFamily,
  isNearAccountId,
  isProCode,
  keyPlanSchema,
  newSvalinKey,
  proPlanSchema,
  proReference,
  type NearCheckout,
  type PortfolioOverview,
  type ProOffer,
  type ProPlan,
  type RiskReport,
} from "@svalin-agent/shared";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { keyPlans, llmsTxt, openApiDocument, paidRoutes, paymentNetworks, proOffer, serviceInfo } from "./catalog.js";
import type { AppConfig } from "./env.js";
import { createClientIpResolver } from "./lib/client-ip.js";
import { ApiError } from "./lib/errors.js";
import {
  KeyStoreCore,
  MemoryStorage,
  NEAR_RESERVATIONS_PER_DAY,
  keyId,
  passStatus,
  type KeyStore,
  type NearReservation,
  type PassRecord,
  type PassRules,
  type UseResult,
} from "./lib/key-store.js";
import { DemoRateLimiter, HourlyCounter, type DemoLimiter } from "./lib/rate-limit.js";
import { TtlCache } from "./lib/ttl-cache.js";
import { AnthropicNarrator, TemplateNarrator, type Narrator } from "./narrate/narrator.js";
import { LogLedger, SupabaseLedger, type PaymentLedger } from "./payments/ledger.js";
import {
  nearPaymentsReceived,
  solanaPaymentsByReference,
  usdcAtomic,
  usdcDecimal,
  type FoundPayment,
  type UnreadFilter,
} from "./payments/pro-payments.js";
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
  /** Svalin keys and Pro codes (Cloudflare Workers use a Durable Object); in memory by default. */
  keyStore?: KeyStore;
  /** Looks up Pro payments on-chain; tests inject their own. */
  proPayments?: ProPaymentFinder;
};

/**
 * Pro payments on each chain: the transactions made with a code's Solana Pay reference, and
 * Svalin's NEAR transactions since a checkout began. Each returns the transactions it read, with
 * what they paid, and skips those `unread` drops.
 */
export type ProPaymentFinder = {
  solana(offer: NonNullable<ProOffer["solana"]>, reference: string, unread: UnreadFilter): Promise<FoundPayment[]>;
  near(offer: NonNullable<ProOffer["near"]>, since: number, unread: UnreadFilter): Promise<FoundPayment[]>;
};

type Variables = { paidByKey?: boolean };

/** Lookups of Pro payments per caller per hour (a checkout polls every 10 s), and for everyone per day. */
const PRO_LOOKUPS_PER_HOUR = 120;
const PRO_LOOKUPS_PER_DAY = 5000;
/** New exact NEAR amounts per caller per hour: a buyer needs one or two. */
const NEAR_AMOUNTS_PER_HOUR = 10;
/**
 * Refused keys (unknown, ended or out of calls) per caller per hour before the API stops asking the
 * key store, whose Durable Object the free plan allows 100,000 requests a day.
 */
const REFUSED_KEYS_PER_HOUR = 30;

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

  const keyStore = deps.keyStore ?? new KeyStoreCore(new MemoryStorage());
  // This isolate's memory of refusals, so a caller who keeps asking does not keep reaching the store.
  const throttled = new HourlyCounter();
  const refusedKeys = new HourlyCounter();
  const proPayments: ProPaymentFinder = deps.proPayments ?? {
    solana: (offer, reference, unread) =>
      solanaPaymentsByReference({ rpcUrl: config.pro.solanaRpcUrl, network: offer.network, reference, payTo: offer.payTo, mint: offer.mint, unread }),
    near: (offer, since, unread) =>
      nearPaymentsReceived({ txApiUrl: config.pro.nearTxApiUrl, network: offer.network, payTo: offer.payTo, token: offer.token, since, unread }),
  };
  /** Only payments on the networks Svalin takes now count, so test-network passes end at the switch. */
  const passRules = (): PassRules => ({
    networks: paymentNetworks(config).map((network) => network.caip2),
    proCallsPerDay: config.pro.callsPerDay,
  });
  const proPlanDays = { month: config.pro.plans.month.days, year: config.pro.plans.year.days };

  const app = new Hono<{ Variables: Variables }>();

  /* ------------------------------- middleware ------------------------------ */

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "PAYMENT-SIGNATURE", "X-PAYMENT"],
      exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE", "X-Free-Remaining", "X-Calls-Left"],
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

  // Before the paywall: no payment for a pass that cannot be sold, or a renewal of a key that does
  // not exist or is another kind of pass.
  app.use("/v1/keys/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    if (config.payments.mode !== "x402") {
      throw new ApiError(503, "payments_not_configured", "Svalin passes are not sold on this instance yet.");
    }
    const plan = keyPlanSchema.safeParse(c.req.path.split("/").pop());
    const authorization = c.req.header("Authorization");
    if (plan.success && authorization !== undefined) {
      guardKeys(c);
      const id = await keyId(bearerSecret(authorization));
      const status = await keys(() => keyStore.status(id, Date.now(), passRules()));
      if (!status) throw refuseKey(c, keyRefusal({ ok: false, reason: "unknown", until: null }, config.pro.callsPerDay));
      if (status.plan !== plan.data) {
        throw new ApiError(409, "other_plan", `This key is Svalin ${status.plan === "pro" ? "Pro" : "Business"}; renew it at POST /v1/keys/${status.plan}.`);
      }
    }
    return next();
  });

  // A Svalin key or Pro code pays for the call instead of x402. It runs after the gate, so a bad
  // address never uses a call, and a call that fails gives its call back.
  app.use("/v1/*", async (c, next) => {
    const authorization = c.req.header("Authorization");
    if (authorization === undefined || config.payments.mode !== "x402") return next();
    if (!PAID_PREFIXES.some((prefix) => c.req.path.startsWith(prefix))) return next();
    guardKeys(c);
    const id = await keyId(bearerSecret(authorization));
    const result = await keys(() => keyStore.use(id, Date.now(), passRules()));
    if (!result.ok) throw refuseKey(c, keyRefusal(result, config.pro.callsPerDay));
    c.set("paidByKey", true);
    c.header("X-Calls-Left", String(result.callsLeft));
    await next();
    if (c.res.status >= 400) await keys(() => keyStore.refund(id, Date.now())).catch(() => undefined);
  });

  if (config.payments.mode === "x402") {
    const paywall = createPaymentLayer(config, {
      facilitator: deps.facilitator,
      ledger,
      initialization: deps.paymentInitialization,
      discovery: deps.paymentDiscovery,
    });
    app.use("/v1/*", (c, next) => (c.get("paidByKey") ? next() : paywall(c, next)));
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

  /* ------------------------------ Svalin keys ------------------------------ */

  app.get("/v1/keys/me", async (c) => {
    const authorization = c.req.header("Authorization");
    if (authorization === undefined) {
      throw new ApiError(401, "missing_key", "Send your Svalin key as Authorization: Bearer <key>.");
    }
    guardKeys(c);
    const id = await keyId(bearerSecret(authorization));
    const status = await keys(() => keyStore.status(id, Date.now(), passRules()));
    if (!status) throw refuseKey(c, keyRefusal({ ok: false, reason: "unknown", until: null }, config.pro.callsPerDay));
    return c.json(status);
  });

  // Paid over x402. A new key reaches the buyer only once the payment settles: if settling fails,
  // the paywall replaces this response, and the key is never seen by anyone. With a key in the
  // Authorization header (checked before the paywall), the payment renews that key instead.
  app.post("/v1/keys/:plan", async (c) => {
    const plan = keyPlanSchema.safeParse(c.req.param("plan"));
    if (!plan.success) {
      throw new ApiError(404, "unknown_plan", "There is no such Svalin pass.", "Passes: pro and business. GET / lists their prices.");
    }
    const now = Date.now();
    const { calls, days } = keyPlans[plan.data];
    const price = Number(config.payments.keyPrices[plan.data].replace(/^\$/, ""));
    const payment = { tx: `x402-${crypto.randomUUID()}`, network: paidNetwork(c) ?? "unknown", atomic: usdcAtomic(price), at: now, days };

    const authorization = c.req.header("Authorization");
    if (authorization !== undefined) {
      const key = bearerSecret(authorization);
      const id = await keyId(key);
      if (!(await keys(() => keyStore.extend(id, plan.data, payment, calls)))) {
        throw new ApiError(503, "keys_unavailable", "The key could not be renewed. Try again; you are not charged.");
      }
      const status = await keys(() => keyStore.status(id, now, passRules()));
      console.log(JSON.stringify({ level: "info", msg: "pass_renewed", plan: plan.data, network: payment.network }));
      return c.json({ key, status, note: "Renewed: the new days start where the current ones end." });
    }

    const record: PassRecord =
      plan.data === "pro"
        ? { kind: "pro", plan: "pro", payments: [payment], used: 0, usedSince: 0 }
        : { kind: "key", plan: plan.data, payments: [payment], calls, used: 0, usedSince: now };
    const key = newSvalinKey(plan.data === "pro" ? PRO_CODE_PREFIX : AGENT_KEY_PREFIX);
    const id = await keyId(key);
    if (!(await keys(() => keyStore.issue(id, record)))) {
      throw new ApiError(503, "keys_unavailable", "The key could not be made. Try again; you are not charged.");
    }
    console.log(JSON.stringify({ level: "info", msg: "pass_sold", plan: plan.data, network: payment.network }));
    return c.json({
      key,
      status: passStatus(record, now, passRules()),
      note: "Store this key now: Svalin keeps only a fingerprint of it and cannot show it again. Send it as Authorization: Bearer <key>.",
    });
  });

  /* ------------------------------ Svalin Pro ------------------------------- */

  app.get("/v1/pro", (c) => c.json(proOffer(config)));

  // NEAR wallets cannot attach a reference to a payment, so each checkout gets its own exact
  // amount, and the payment is matched by it.
  app.post("/v1/pro/near", async (c) => {
    const { code, plan } = await proRequest(c, true);
    const offer = proOffer(config).near;
    if (!offer) throw new ApiError(404, "near_not_accepted", "This instance takes no NEAR payments.", "Pay with Solana Pay instead.");
    await throttle(c, "near-amount", NEAR_AMOUNTS_PER_HOUR, NEAR_RESERVATIONS_PER_DAY);
    const id = await keyId(code);
    const price = usdcAtomic(config.pro.plans[plan].usd);
    const reservation = await keys(() => keyStore.reserveNear(id, plan, offer.network, price, Date.now()));
    if (!reservation) throw new ApiError(503, "checkout_busy", "No exact amount is free right now. Try again in a minute.");
    return c.json(nearCheckout(reservation, offer));
  });

  app.post("/v1/pro/activate", async (c) => {
    const { code } = await proRequest(c, false);
    await throttle(c, "lookup", PRO_LOOKUPS_PER_HOUR, PRO_LOOKUPS_PER_DAY);
    const id = await keyId(code);
    const offer = proOffer(config);
    let found = 0;
    let failure: unknown;

    if (offer.solana) {
      const network = offer.solana.network;
      try {
        const read = await proPayments.solana(offer.solana, await proReference(code), unreadOn(network));
        const payments = read.flatMap((payment) => {
          const days = proDaysFor(payment.atomic);
          return days > 0 ? [{ ...payment, days }] : [];
        });
        if (payments.length > 0) found += await keys(() => keyStore.claim(id, payments));
        await markRead(network, read);
      } catch (error) {
        failure = error;
      }
    }

    const near = offer.near;
    const nearPending = async () => (near ? (await keys(() => keyStore.pending(id, Date.now()))).filter((entry) => entry.network === near.network) : []);
    let pending = await nearPending();
    if (near && pending.length > 0) {
      try {
        const since = Math.min(...pending.map((entry) => entry.createdAt));
        const read = await proPayments.near(near, since, unreadOn(near.network));
        const payments = read.filter((payment) => proDaysFor(payment.atomic) > 0);
        if (payments.length > 0) {
          const mine = (await keys(() => keyStore.claimNear(payments, proPlanDays))).filter((owner) => owner === id).length;
          found += mine;
          if (mine > 0) pending = await nearPending();
        }
        // Read once, whatever they were: a transaction no checkout matched now never matches later.
        await markRead(near.network, read);
      } catch (error) {
        failure ??= error;
      }
    }

    const status = await keys(() => keyStore.status(id, Date.now(), passRules()));
    // A chain that could not be read only matters when nothing else is known about the code.
    if (!status && pending.length === 0 && failure) throw failure;
    if (found > 0) console.log(JSON.stringify({ level: "info", msg: "pro_payment_found", found }));
    return c.json({ status, found, pending: pending.map((entry) => nearCheckout(entry, near!)) });
  });

  /** A store that does not answer is a 503, never a free call. */
  async function keys<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error(JSON.stringify({ level: "error", msg: "key_store_unavailable", error: String(error) }));
      throw new ApiError(503, "keys_unavailable", "Svalin keys cannot be checked right now. Try again in a minute.");
    }
  }

  const unreadOn =
    (network: string): UnreadFilter =>
    (txs) =>
      keys(() => keyStore.unread(network, txs));

  async function markRead(network: string, read: FoundPayment[]) {
    if (read.length > 0) await keys(() => keyStore.markRead(network, read.map((payment) => payment.tx)));
  }

  /**
   * Lookups read the chain and NEAR amounts are scarce, so each caller gets a few an hour, and
   * everyone a daily total. Once the store has refused a caller, this isolate refuses them for the
   * rest of the hour without asking it again.
   */
  async function throttle(c: Context, bucket: "lookup" | "near-amount", perHour: number, perDay: number) {
    const caller = clientIp(c);
    const local = `${bucket}:${caller}`;
    const allowed = throttled.count(local, Date.now()) === 0 && (await keys(() => keyStore.throttle(bucket, caller, Date.now(), perHour, perDay)));
    if (!allowed) {
      throttled.add(local, Date.now());
      throw new ApiError(429, "too_many_requests", "Too many checkout requests right now. Try again in an hour.");
    }
  }

  /** A caller whose keys were refused too often this hour is answered here, before the key store. */
  function guardKeys(c: Context) {
    if (refusedKeys.count(clientIp(c), Date.now()) >= REFUSED_KEYS_PER_HOUR) {
      throw new ApiError(429, "too_many_refused_keys", "Too many refused Svalin keys from this address. Try again in an hour.");
    }
  }

  function refuseKey(c: Context, error: ApiError): ApiError {
    refusedKeys.add(clientIp(c), Date.now());
    return error;
  }

  /** Days a Pro payment of this size buys: the yearly price buys a year, the monthly price a month. */
  function proDaysFor(atomic: string): number {
    const paid = BigInt(atomic);
    if (paid >= BigInt(usdcAtomic(config.pro.plans.year.usd))) return config.pro.plans.year.days;
    if (paid >= BigInt(usdcAtomic(config.pro.plans.month.usd))) return config.pro.plans.month.days;
    return 0;
  }

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

/** The Svalin key in an `Authorization: Bearer` header; anything else is a 401, so a typo is never paid for. */
function bearerSecret(authorization: string): string {
  const secret = /^Bearer\s+(\S+)\s*$/i.exec(authorization)?.[1];
  if (!secret || !SVALIN_KEY_PATTERN.test(secret)) {
    throw new ApiError(
      401,
      "invalid_key",
      "The Authorization header does not hold a Svalin key.",
      "Send Authorization: Bearer svk_… (or an active Pro code, svp_…), or leave the header out and pay per call over x402.",
    );
  }
  return secret;
}

function keyRefusal(result: Extract<UseResult, { ok: false }>, proCallsPerDay: number): ApiError {
  switch (result.reason) {
    case "unknown":
      return new ApiError(
        401,
        "unknown_key",
        "This Svalin key is not known.",
        "A Pro code works once its payment is found (POST /v1/pro/activate). Passes are sold at POST /v1/keys/pro and /v1/keys/business.",
      );
    case "expired":
      return new ApiError(
        401,
        "key_ended",
        result.until === null
          ? "This Svalin key was not paid on the networks Svalin takes payments on now."
          : `This Svalin key ended on ${new Date(result.until).toISOString().slice(0, 10)}.`,
        "Renew Svalin Pro on the Svalin website, or buy a new key at POST /v1/keys/{plan}.",
      );
    case "used_up":
      return new ApiError(
        429,
        "key_used_up",
        "This Svalin key has used all its calls.",
        "Buy a new key at POST /v1/keys/{plan}, or leave the Authorization header out and pay per call over x402.",
      );
    case "daily_limit":
      return new ApiError(429, "pro_daily_limit", `This Pro code has made today's ${proCallsPerDay} calls. They come back at 00:00 UTC.`);
  }
}

/** The network a key purchase was paid on, from the payment the paywall has already verified. */
function paidNetwork(c: Context): string | null {
  const header = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
  if (!header) return null;
  try {
    return decodePaymentSignatureHeader(header).accepted.network;
  } catch {
    return null;
  }
}

/** The JSON body of a Pro request: a Pro code, and a plan where one is needed. Small, and checked before any lookup. */
async function proRequest(c: Context, withPlan: true): Promise<{ code: string; plan: ProPlan }>;
async function proRequest(c: Context, withPlan: false): Promise<{ code: string }>;
async function proRequest(c: Context, withPlan: boolean): Promise<{ code: string; plan?: ProPlan }> {
  const text = await smallBody(c.req.raw, 1024);
  let body: { code?: unknown; plan?: unknown } = {};
  try {
    if (text !== null) body = JSON.parse(text) as typeof body;
  } catch {
    // Reported below as a missing code.
  }
  if (typeof body.code !== "string" || !isProCode(body.code)) {
    throw new ApiError(400, "invalid_code", 'Send a JSON body with "code": the Pro code made on the Svalin website (svp_…).');
  }
  if (!withPlan) return { code: body.code };
  const plan = proPlanSchema.safeParse(body.plan);
  if (!plan.success) throw new ApiError(400, "invalid_plan", 'Send "plan": "month" or "year".');
  return { code: body.code, plan: plan.data };
}

/** The request body as text, or null once it passes `max` bytes: a large body is never read into memory. */
async function smallBody(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > max || !request.body) return request.body ? null : "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function nearCheckout(reservation: NearReservation, offer: NonNullable<ProOffer["near"]>): NearCheckout {
  return {
    plan: reservation.plan,
    network: reservation.network,
    payTo: offer.payTo,
    token: offer.token,
    amount: usdcDecimal(reservation.atomic),
    expiresAt: new Date(reservation.expiresAt).toISOString(),
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
