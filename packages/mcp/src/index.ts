#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZodError } from "zod";

import { createSvalinClient } from "./client.js";
import { loadMcpConfig } from "./config.js";
import { createSvalinMcpServer } from "./server.js";

async function main() {
  const config = loadMcpConfig();
  const client = await createSvalinClient(config);
  const server = createSvalinMcpServer(client);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; diagnostics go to stderr.
  console.error(
    `svalin-mcp ready (api=${client.apiUrl}, payments=${client.canPay ? "on" : "off"}, budget=${client.budget.status().sessionCap})`,
  );
}

main().catch((error) => {
  const message =
    error instanceof ZodError
      ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`svalin-mcp failed to start: ${message}`);
  process.exit(1);
});
