import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { paymentNetworks } from "./catalog.js";
import { loadConfig } from "./env.js";
import { facilitatorClients } from "./payments/x402.js";

// Local development reads the repo-root .env. Variables already set (as hosts do) take precedence.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment.
}

const config = loadConfig();
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  const networks = paymentNetworks(config).map((network) => network.label);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "svalin_api_started",
      port: info.port,
      env: config.nodeEnv,
      portfolioSource: config.portfolio.source,
      payments: config.payments.mode,
      paymentEnvironment: config.payments.environment,
      paymentNetworks: networks,
      facilitators: config.payments.mode === "x402" ? facilitatorClients(config).map((entry) => entry.name) : [],
      narrator: config.narrator.anthropicApiKey ? `llm:${config.narrator.model}` : "template",
      webVisitorForwarding: config.demo.forwardingSecret ? "on" : "off",
    }),
  );
});
