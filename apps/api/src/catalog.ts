import { x402Networks } from "@svalin-agent/chain-config";
import { serviceInfoSchema, type Endpoint, type ServiceInfo } from "@svalin-agent/shared";

import type { AppConfig } from "./env.js";

export const API_VERSION = "1.0.0";
export const TAGLINE =
  "Read-only portfolio risk intelligence for AI agents. Pay per call in USDC over x402. Svalin can never move funds.";

export const REPOSITORY_URL = "https://github.com/noobshole/svalin-agent";

/** How an agent should use the API, published as info.x-guidance in the OpenAPI document. */
const X_GUIDANCE =
  "Svalin returns read-only risk reports for Solana wallets and NEAR accounts. Call GET /v1/risk/{address}, " +
  "/v1/portfolio/{address} or /v1/brief/{address} with a Solana base58 address or a NEAR account ID such as " +
  "alice.near. Paid routes answer 402 with x402 v2 USDC payment requirements: pay, then retry with the payment " +
  "header. Invalid addresses are rejected with 400 before any payment, and failed calls are never charged. " +
  "A token or program address gets 422 instead of a report; for a token the body carries its Svalin Index grade. " +
  "GET /v1/demo/risk/{address} is free and rate limited.";

const TOKEN_ADDRESS_RESPONSE =
  'Not a wallet (not charged). Code "token_address" for a token, with a `token` object holding its Svalin Index grade; "not_a_wallet" for a Solana token account or program.';

/** "$0.004" → "0.004000": discovery metadata states prices as decimal USD. */
function usdAmount(price: string) {
  return Number(price.replace(/^\$/, "")).toFixed(6);
}

export type PaidRouteKey = "portfolio" | "risk" | "brief";

/** JSON Schema pattern for a Solana base58 address or a NEAR account ID. */
export const ADDRESS_PATTERN = String.raw`^([1-9A-HJ-NP-Za-km-z]{32,44}|(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+)$`;

export const paidRoutes: Record<PaidRouteKey, { path: string; description: string; returns: string; tags: string[] }> = {
  portfolio: {
    path: "/v1/portfolio/{address}",
    description:
      "Use when you need a Solana wallet's or NEAR account's current holdings in USD: balances, prices, allocation and a risk category per token (stablecoin, native, liquid staking, major, meme, long-tail). Read-only.",
    returns: "PortfolioOverview",
    tags: ["solana", "portfolio", "wallet", "defi"],
  },
  risk: {
    path: "/v1/risk/{address}",
    description:
      "Use before acting on, advising about or trusting a Solana wallet or NEAR account: a deterministic 0-100 risk score, A-F grade, exposure metrics (concentration, HHI, stablecoin/meme/long-tail share) and findings with concrete actions. Same input, same output. Read-only.",
    returns: "RiskReport",
    tags: ["solana", "risk", "portfolio", "agent"],
  },
  brief: {
    path: "/v1/brief/{address}",
    description:
      "Use when you must explain a Solana wallet's or NEAR account's risk to a person: a headline, a short summary and up to 3 actions, plus the full risk report. Numbers always come from the deterministic engine. Read-only.",
    returns: "Brief",
    tags: ["solana", "risk", "summary", "agent", "llm"],
  },
};

/** CDP's facilitator rejects verify/settle when a route description is longer than this. */
export const MAX_ROUTE_DESCRIPTION_LENGTH = 500;

export function endpoints(config: AppConfig): Endpoint[] {
  const { prices } = config.payments;
  return [
    { method: "GET", path: "/", description: "Service manifest (this document).", price: null, returns: "ServiceInfo" },
    { method: "GET", path: "/health", description: "Liveness probe.", price: null, returns: "{ ok: true }" },
    {
      method: "GET",
      path: "/v1/demo/risk/{address}",
      description: `Free trial of the risk report. Rate limited to ${config.demo.perHour} calls per hour per IP.`,
      price: null,
      returns: "RiskReport",
    },
    {
      method: "GET",
      path: "/v1/index/near-tokens",
      description:
        "Svalin Index: every NEAR token Ref Finance prices, graded A-F by the real money in its pools, with market cap, top-10 holder share and holder count where known. Free, refreshed every few hours.",
      price: null,
      returns: "NearTokenIndex",
    },
    ...(Object.keys(paidRoutes) as PaidRouteKey[]).map((key) => ({
      method: "GET" as const,
      path: paidRoutes[key].path,
      description: paidRoutes[key].description,
      price: prices[key],
      returns: paidRoutes[key].returns,
    })),
    { method: "GET", path: "/openapi.json", description: "OpenAPI 3.1 description.", price: null, returns: "OpenAPI" },
    { method: "GET", path: "/llms.txt", description: "Plain-text guide for LLM agents.", price: null, returns: "text/plain" },
  ];
}

export function paymentNetworks(config: AppConfig) {
  if (config.payments.mode !== "x402") return [];
  return x402Networks[config.payments.environment].flatMap((network) => {
    const payTo = network.family === "solana" ? config.payments.payToSolana : config.payments.payToNear;
    return payTo ? [{ ...network, payTo }] : [];
  });
}

export function serviceInfo(config: AppConfig): ServiceInfo {
  return serviceInfoSchema.parse({
    name: "Svalin",
    version: API_VERSION,
    tagline: TAGLINE,
    readOnly: true,
    canMoveFunds: false,
    payments: {
      protocol: "x402",
      enabled: config.payments.mode === "x402",
      networks: paymentNetworks(config).map((network) => ({
        network: network.caip2,
        label: network.label,
        asset: "USDC",
        payTo: network.payTo,
      })),
    },
    chains: [
      {
        chain: "solana",
        family: "solana",
        status: config.portfolio.source === "live" ? "live" : "sample-data",
        note:
          config.portfolio.source === "live"
            ? "Live balances and prices via Helius DAS."
            : "Sample data — this instance has no live data source configured.",
      },
      {
        chain: "near",
        family: "near",
        status: config.portfolio.source === "live" ? "live" : "sample-data",
        note:
          config.portfolio.source === "live"
            ? "Live balances via FastNEAR, prices and pools via Ref Finance, validator stakes via NEAR RPC. Tokens outside the curated registry are valued at no more than their pools could pay out."
            : "Sample data — this instance has no live data source configured.",
      },
    ],
    endpoints: endpoints(config),
    links: {
      docs: "https://github.com/noobshole/svalin-agent#readme",
      openapi: `${config.publicBaseUrl}/openapi.json`,
      llms: `${config.publicBaseUrl}/llms.txt`,
      mcp: "https://github.com/noobshole/svalin-agent/tree/main/packages/mcp#readme",
    },
  });
}

export function openApiDocument(config: AppConfig) {
  const addressParam = {
    name: "address",
    in: "path",
    required: true,
    description: "Solana wallet address (base58) or NEAR account ID (e.g. alice.near).",
    schema: { type: "string", pattern: ADDRESS_PATTERN },
  };
  const paid = (key: PaidRouteKey) => ({
    get: {
      summary: paidRoutes[key].description,
      tags: ["paid"],
      parameters: [addressParam],
      // Discovery metadata (x402scan / IETF payment info): decimal USD here, atomic units at runtime.
      "x-payment-info": {
        price: { mode: "fixed", currency: "USD", amount: usdAmount(config.payments.prices[key]) },
        protocols: [{ x402: {} }],
      },
      responses: {
        "200": { description: paidRoutes[key].returns },
        "400": { description: "Invalid or unsupported address (not charged)." },
        "404": { description: "NEAR account does not exist (not charged)." },
        "422": { description: TOKEN_ADDRESS_RESPONSE },
        "402": { description: "Payment required. See the PAYMENT-REQUIRED header (x402 v2)." },
        "502": { description: "Upstream data provider failure (not charged)." },
      },
    },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Svalin API",
      version: API_VERSION,
      description: TAGLINE,
      "x-guidance": X_GUIDANCE,
      contact: { name: "Svalin", url: REPOSITORY_URL },
    },
    servers: [{ url: config.publicBaseUrl }],
    paths: {
      "/v1/demo/risk/{address}": {
        get: {
          summary: "Free, rate-limited risk report.",
          tags: ["free"],
          parameters: [addressParam],
          responses: {
            "200": { description: "RiskReport" },
            "422": { description: TOKEN_ADDRESS_RESPONSE },
            "429": { description: "Demo limit reached." },
          },
        },
      },
      "/v1/index/near-tokens": {
        get: {
          summary: "Svalin Index: NEAR tokens graded by the real money behind their price. Free.",
          tags: ["free"],
          responses: {
            "200": { description: "NearTokenIndex: rows of [contract, symbol, priceUsd, backingUsd, grade, marketCapUsd, top10Pct, holders]." },
            "503": { description: "Index temporarily unavailable." },
          },
        },
      },
      "/v1/portfolio/{address}": paid("portfolio"),
      "/v1/risk/{address}": paid("risk"),
      "/v1/brief/{address}": paid("brief"),
    },
  };
}

export function llmsTxt(config: AppConfig) {
  const { prices } = config.payments;
  const networks = paymentNetworks(config);
  return `# Svalin

> ${TAGLINE}

Svalin turns a Solana wallet or NEAR account into a priced portfolio and a deterministic risk report
(score 0-100, grade A-F, concentration / stablecoin / meme / long-tail exposure, and
findings with actions). It is read-only: it never asks for keys, approvals or signatures.

## Endpoints

{address} is a Solana address (base58) or a NEAR account ID (e.g. alice.near). A token address
gets HTTP 422 with code "token_address" and, for NEAR tokens, the token's Svalin Index grade.

- GET ${config.publicBaseUrl}/v1/demo/risk/{address} — free, ${config.demo.perHour}/hour per IP
- GET ${config.publicBaseUrl}/v1/index/near-tokens — free: every NEAR token graded A-F by the real money behind its price
- GET ${config.publicBaseUrl}/v1/portfolio/{address} — ${prices.portfolio} USDC
- GET ${config.publicBaseUrl}/v1/risk/{address} — ${prices.risk} USDC
- GET ${config.publicBaseUrl}/v1/brief/{address} — ${prices.brief} USDC

## Paying

Paid endpoints use x402 v2. Call the endpoint; on HTTP 402 read the PAYMENT-REQUIRED
header, sign the USDC payment, and retry with the PAYMENT-SIGNATURE header. Any x402
client works (e.g. @x402/fetch). You are not charged when the response is 4xx/5xx.
Accepted networks: ${networks.length > 0 ? networks.map((network) => `${network.label} (${network.caip2})`).join(", ") : "payments not enabled on this instance"}.

## MCP

Use Svalin from Claude, Cursor or any MCP client with the svalin-mcp server, which pays
per call from a wallet you control with a hard spend cap:
https://github.com/noobshole/svalin-agent/tree/main/packages/mcp

## Docs

- OpenAPI: ${config.publicBaseUrl}/openapi.json
- Methodology: https://github.com/noobshole/svalin-agent/blob/main/docs/RISK_METHODOLOGY.md
`;
}
