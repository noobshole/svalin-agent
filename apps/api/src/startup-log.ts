import { paymentNetworks } from "./catalog.js";
import type { AppConfig } from "./env.js";
import { facilitatorClients } from "./payments/x402.js";

/** What the API is running with, logged once at startup. Names and modes only, never keys. */
export function startupSummary(config: AppConfig) {
  return {
    env: config.nodeEnv,
    portfolioSource: config.portfolio.source,
    payments: config.payments.mode,
    paymentEnvironments: config.payments.networks,
    paymentNetworks: paymentNetworks(config).map((network) => network.label),
    facilitators: config.payments.mode === "x402" ? facilitatorClients(config).map((entry) => entry.name) : [],
    narrator: config.narrator.anthropicApiKey ? `llm:${config.narrator.model}` : "template",
    webVisitorForwarding: config.demo.forwardingSecret ? "on" : "off",
  };
}
