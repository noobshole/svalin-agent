import { createServer, type ServerResponse } from "node:http";
import { URL } from "node:url";

import type { Address } from "@svalin-agent/shared";

import { getAgentCapabilitiesRoute } from "../routes/agent/get-agent-capabilities.js";
import { getAgentSuggestionsRoute } from "../routes/agent/get-agent-suggestions.js";
import { getPortfolioAnalyticsRoute } from "../routes/analytics/get-portfolio-analytics.js";
import { getContractRegistryRoute } from "../routes/contracts/get-contract-registry.js";
import { getHealthRoute } from "../routes/health/get-health.js";
import { getPortfolioOverviewRoute } from "../routes/portfolio/get-portfolio-overview.js";

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

function getAllowedOrigins() {
  const configuredOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(
    configuredOrigins && configuredOrigins.length > 0
      ? configuredOrigins
      : defaultAllowedOrigins,
  );
}

function getCorsOrigin(requestOrigin?: string) {
  const allowedOrigins = getAllowedOrigins();

  if (!requestOrigin) {
    return defaultAllowedOrigins[0];
  }

  return allowedOrigins.has(requestOrigin) ? requestOrigin : null;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  corsOrigin?: string,
) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": corsOrigin ?? defaultAllowedOrigins[0],
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(body));
}

const walletPattern = /^0x[a-fA-F0-9]{40}$/;

export function createApiServer() {
  return createServer(async (request, response) => {
    try {
      if (!request.url || !request.method) {
        sendJson(response, 400, { error: "Invalid request." });
        return;
      }

      const corsOrigin = getCorsOrigin(request.headers.origin);

      if (!corsOrigin) {
        sendJson(response, 403, { error: "Origin is not allowed." });
        return;
      }

      if (request.method === "OPTIONS") {
        sendJson(response, 204, null, corsOrigin);
        return;
      }

      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, getHealthRoute(), corsOrigin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/contracts") {
        sendJson(response, 200, getContractRegistryRoute(), corsOrigin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/agent/capabilities") {
        sendJson(response, 200, getAgentCapabilitiesRoute(), corsOrigin);
        return;
      }

      const analyticsMatch = url.pathname.match(
        /^\/analytics\/portfolio\/(0x[a-fA-F0-9]{40})$/,
      );

      if (request.method === "GET" && analyticsMatch) {
        const wallet = analyticsMatch[1];

        if (!walletPattern.test(wallet)) {
          sendJson(response, 400, { error: "Invalid wallet address." }, corsOrigin);
          return;
        }

        const analytics = await getPortfolioAnalyticsRoute(wallet as Address);
        sendJson(response, 200, analytics, corsOrigin);
        return;
      }

      const agentMatch = url.pathname.match(/^\/agent\/suggestions\/(0x[a-fA-F0-9]{40})$/);

      if (request.method === "GET" && agentMatch) {
        const wallet = agentMatch[1];

        if (!walletPattern.test(wallet)) {
          sendJson(response, 400, { error: "Invalid wallet address." }, corsOrigin);
          return;
        }

        const suggestions = await getAgentSuggestionsRoute(wallet as Address);
        sendJson(response, 200, suggestions, corsOrigin);
        return;
      }

      const portfolioMatch = url.pathname.match(
        /^\/portfolio\/(0x[a-fA-F0-9]{40})$/,
      );

      if (request.method === "GET" && portfolioMatch) {
        const wallet = portfolioMatch[1];

        if (!walletPattern.test(wallet)) {
          sendJson(response, 400, { error: "Invalid wallet address." }, corsOrigin);
          return;
        }

        const portfolioOverview = await getPortfolioOverviewRoute(
          wallet as Address,
        );
        sendJson(response, 200, portfolioOverview, corsOrigin);
        return;
      }

      sendJson(response, 404, { error: "Route not found." }, corsOrigin);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: "Internal server error." });
    }
  });
}
