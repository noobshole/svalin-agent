import { createFacilitatorConfig } from "@coinbase/x402";
import { defaultFacilitatorUrl, defaultNearFacilitatorUrl } from "@svalin-agent/chain-config";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactNearScheme } from "@x402/near/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { MiddlewareHandler } from "hono";

import { ADDRESS_PATTERN, paidRoutes, paymentNetworks, type PaidRouteKey } from "../catalog.js";
import type { AppConfig } from "../env.js";
import { ApiError } from "../lib/errors.js";
import type { PaymentLedger } from "./ledger.js";

export type PaymentLayerOptions = {
  /** Injected in tests so no network call is made to a real facilitator. */
  facilitator?: FacilitatorClient;
  ledger: PaymentLedger;
  /**
   * When the facilitators' supported payment kinds are fetched. "startup" (the default) fetches
   * them when the server starts. "first-paid-request" fetches them inside the first paid
   * request: Cloudflare Workers needs this, because I/O started in one request cannot be awaited
   * by another.
   */
  initialization?: "startup" | "first-paid-request";
  /**
   * Bazaar discovery metadata on paid routes (default true). Its schema validation compiles code
   * at runtime, which Cloudflare Workers forbid. Bazaar listing only applies with CDP keys.
   */
  discovery?: boolean;
};

const outputExamples: Record<PaidRouteKey, unknown> = {
  portfolio: { wallet: "<address>", chain: "solana", totalValueUsd: 12873.4, assets: [{ symbol: "SOL", valueUsd: 8310.7, allocationBps: 6456, category: "native" }] },
  risk: { score: 58, grade: "C", level: "elevated", findings: [{ kind: "concentration", severity: "medium", title: "SOL (incl. staked) is 79.3% of the portfolio" }] },
  brief: { headline: "Grade C: elevated risk (58/100). SOL (incl. staked) is 79.3% of the portfolio", actions: ["Consider capping SOL near 40%…"] },
  check: {
    verdict: "block",
    kind: "wallet",
    reasons: [{ code: "lookalike", severity: "block", message: "This address imitates 7xKX…AsU, which this wallet paid recently…" }],
  },
  exit: {
    contract: "token.v2.ref-finance.near",
    grade: "B",
    exit: { quotes: [{ saleUsd: 10000, fetchesUsd: 9292.95, lossPct: 7.07 }], within1PctUsd: 1327.61, wholeSupplyUsd: 128493.1 },
  },
};

/**
 * Facilitators in priority order: x402ResourceServer routes each network to the first one that
 * supports it, and skips any that fail at startup.
 * - CDP (with keys) settles Solana first, since settling through it lists the API in Coinbase's
 *   x402 Bazaar.
 * - The NEAR facilitator (when a NEAR payTo is set) settles NEAR; its API key goes in X-API-Key.
 * - The default facilitator (PayAI on mainnet, x402.org on testnet) covers Solana otherwise.
 */
export function facilitatorClients(config: AppConfig): { name: string; client: FacilitatorClient }[] {
  const { cdp, environment, facilitatorUrl, payToNear, nearFacilitator } = config.payments;
  const clients: { name: string; client: FacilitatorClient }[] = [];

  if (cdp) {
    clients.push({ name: "cdp", client: new HTTPFacilitatorClient(createFacilitatorConfig(cdp.apiKeyId, cdp.apiKeySecret)) });
  }

  if (payToNear) {
    const apiKey = nearFacilitator.apiKey;
    const auth = apiKey ? { "X-API-Key": apiKey } : undefined;
    clients.push({
      name: "near",
      client: new HTTPFacilitatorClient({
        url: nearFacilitator.url ?? defaultNearFacilitatorUrl[environment],
        ...(auth ? { createAuthHeaders: async () => ({ verify: auth, settle: auth }) } : {}),
      }),
    });
  }

  clients.push({
    name: facilitatorUrl ? "custom" : environment === "mainnet" ? "payai" : "x402.org",
    client: new HTTPFacilitatorClient({ url: facilitatorUrl ?? defaultFacilitatorUrl[environment] }),
  });

  return clients;
}

/**
 * Builds the x402 paywall for /v1/portfolio, /v1/risk and /v1/brief. Every paid route
 * accepts USDC on every configured network (Solana and/or NEAR), so any agent wallet can pay.
 */
export function createPaymentLayer(config: AppConfig, options: PaymentLayerOptions): MiddlewareHandler {
  const networks = paymentNetworks(config);
  if (networks.length === 0) {
    throw new Error("createPaymentLayer called without any configured payTo address.");
  }

  const facilitators = options.facilitator
    ? [options.facilitator]
    : facilitatorClients(config).map((entry) => entry.client);

  const server = new x402ResourceServer(facilitators);
  for (const network of networks) {
    server.register(
      network.caip2 as `${string}:${string}`,
      network.family === "solana" ? new ExactSvmScheme() : new ExactNearScheme(),
    );
  }
  const discovery = options.discovery ?? true;
  if (discovery) server.registerExtension(bazaarResourceServerExtension);

  server.onAfterSettle(async (context) => {
    const requirements = context.requirements;
    await options.ledger.record({
      route: String((context.paymentPayload as { resource?: { url?: string } }).resource?.url ?? "unknown"),
      network: String(context.result.network ?? requirements.network),
      payer: context.result.payer ? String(context.result.payer) : null,
      payTo: String(requirements.payTo),
      amount: String(requirements.amount),
      asset: String(requirements.asset),
      transaction: String(context.result.transaction ?? ""),
      settledAt: new Date().toISOString(),
    });
  });

  const routes = Object.fromEntries(
    (Object.keys(paidRoutes) as PaidRouteKey[]).map((key) => {
      const route = paidRoutes[key];
      // A named parameter (not "*") so Bazaar discovery lists it as "address", not "var1".
      const pattern = `GET ${route.path.replace("{address}", ":address")}`;
      return [
        pattern,
        {
          accepts: networks.map((network) => ({
            scheme: "exact",
            price: config.payments.prices[key],
            network: network.caip2 as `${string}:${string}`,
            payTo: network.payTo,
            maxTimeoutSeconds: 120,
          })),
          description: route.description,
          mimeType: "application/json",
          serviceName: "Svalin",
          tags: route.tags,
          ...(discovery && {
            extensions: declareDiscoveryExtension({
              pathParams: { address: route.address?.example ?? "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
              pathParamsSchema: {
                type: "object",
                properties: {
                  address: {
                    type: "string",
                    pattern: ADDRESS_PATTERN,
                    description: route.address?.description ?? "Solana wallet address (base58) or NEAR account ID to analyse",
                  },
                },
                required: ["address"],
              },
              output: { example: outputExamples[key] },
            }),
          }),
        },
      ];
    }),
  );

  if (options.initialization !== "first-paid-request") {
    return paymentMiddleware(routes, server);
  }

  // Fetch supported kinds inside the paid request that first needs them, so the request that
  // started the I/O is the one awaiting it. A failure is retried on the next paid request.
  const middleware = paymentMiddleware(routes, server, undefined, undefined, false);
  const paidPrefixes = Object.values(paidRoutes).map((route) => route.path.replace("{address}", ""));
  let ready: Promise<void> | undefined;
  return async (c, next) => {
    if (!paidPrefixes.some((prefix) => c.req.path.startsWith(prefix))) return next();
    try {
      await (ready ??= server.initialize().catch((error: unknown) => {
        ready = undefined;
        throw error;
      }));
    } catch {
      throw new ApiError(503, "facilitator_unavailable", "Payments are temporarily unavailable. Retry shortly.");
    }
    return middleware(c, next);
  };
}
