import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { SvalinClient } from "./client.js";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const isWallet = (value: string) =>
  SOLANA_ADDRESS.test(value) || (value.length >= 2 && value.length <= 64 && NEAR_ACCOUNT_ID.test(value));
const addressInput = {
  address: z
    .string()
    .refine(isWallet, "Expected a Solana wallet address (base58) or a NEAR account ID (e.g. alice.near)")
    .describe("Solana wallet address or NEAR account ID to analyse"),
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export const VERSION = "1.0.0";

export function createSvalinMcpServer(client: SvalinClient) {
  const server = new McpServer({ name: "svalin", version: VERSION });

  async function call(path: string): Promise<ToolResult> {
    let response: Response;
    try {
      response = await client.fetch(`${client.apiUrl.replace(/\/+$/, "")}${path}`, { headers: { accept: "application/json" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return text(`Svalin request was not made: ${message}`, true);
    }

    if (response.status === 402) {
      return text(
        client.canPay
          ? "Payment was required but not completed (check the wallet has USDC on the selected network)."
          : "This tool is paid per call over x402. Set SVALIN_SOLANA_PRIVATE_KEY, or SVALIN_NEAR_ACCOUNT_ID and SVALIN_NEAR_PRIVATE_KEY (a dedicated wallet holding a few USDC), to enable it, or use svalin_risk_scan for the free demo.",
        true,
      );
    }
    const body = await response.text();
    if (!response.ok) return text(`Svalin returned ${response.status}: ${body.slice(0, 500)}`, true);
    return text(body);
  }

  server.registerTool(
    "svalin_risk_scan",
    {
      title: "Free wallet risk scan",
      description:
        "FREE, rate-limited. Risk report for a Solana wallet or NEAR account: 0-100 score, grade A-F (none for a wallet with nothing priced), concentration/stablecoin/meme/long-tail exposure and findings with suggested actions. Read-only.",
      inputSchema: addressInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ address }) => call(`/v1/demo/risk/${address}`),
  );

  server.registerTool(
    "svalin_risk_report",
    {
      title: "Risk report (paid)",
      description:
        "PAID per call in USDC via x402. Same report as svalin_risk_scan without rate limits. Use for repeated or automated checks. The API sets the price (a fraction of a cent to a few cents) and this server refuses any price above SVALIN_MAX_PRICE_USD. Read-only.",
      inputSchema: addressInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ address }) => call(`/v1/risk/${address}`),
  );

  server.registerTool(
    "svalin_portfolio",
    {
      title: "Priced holdings (paid)",
      description:
        "PAID per call in USDC via x402. Live priced holdings of a Solana wallet or NEAR account: balances, USD value, allocation and risk category per token. The API sets the price (a fraction of a cent to a few cents) and this server refuses any price above SVALIN_MAX_PRICE_USD. Read-only.",
      inputSchema: addressInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ address }) => call(`/v1/portfolio/${address}`),
  );

  server.registerTool(
    "svalin_brief",
    {
      title: "Portfolio brief (paid)",
      description:
        "PAID per call in USDC via x402. Headline, 2-4 sentence summary and up to 3 actions for a Solana wallet or NEAR account, plus the full risk report. Best single call for an agent that must explain a wallet to a user. The API sets the price (a fraction of a cent to a few cents) and this server refuses any price above SVALIN_MAX_PRICE_USD. Read-only.",
      inputSchema: addressInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ address }) => call(`/v1/brief/${address}`),
  );

  server.registerTool(
    "svalin_spend_status",
    {
      title: "Spend status",
      description: "Shows which wallet pays for Svalin calls and how much of the session budget has been used. Free.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      text(
        JSON.stringify(
          { apiUrl: client.apiUrl, payments: client.canPay ? "enabled" : "disabled (free demo only)", payers: client.payers, ...client.budget.status() },
          null,
          2,
        ),
      ),
  );

  return server;
}

function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) };
}
