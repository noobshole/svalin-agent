import { pathToFileURL } from "node:url";

import { createApiServer } from "./server/create-api-server.js";

export { getHealthRoute } from "./routes/health/get-health.js";
export { getAgentCapabilitiesRoute } from "./routes/agent/get-agent-capabilities.js";
export { getAgentSuggestionsRoute } from "./routes/agent/get-agent-suggestions.js";
export { getPortfolioAnalyticsRoute } from "./routes/analytics/get-portfolio-analytics.js";
export { getPortfolioOverviewRoute } from "./routes/portfolio/get-portfolio-overview.js";
export { getContractRegistryRoute } from "./routes/contracts/get-contract-registry.js";
export { apiStatus } from "./config/api-status.js";

export function startApiServer() {
  const port = Number(process.env.PORT ?? 4000);
  const server = createApiServer();

  server.listen(port, () => {
    console.log(`Svalin Agent API listening on http://localhost:${port}`);
  });

  return server;
}

const entryFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entryFile === import.meta.url) {
  startApiServer();
}
