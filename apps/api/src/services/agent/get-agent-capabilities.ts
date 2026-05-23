import { contractRegistry, supportedChains } from "@svalin-agent/chain-config";
import {
  agentCapabilitiesResponseSchema,
  type AgentAction,
  type AgentCapabilitiesResponse,
} from "@svalin-agent/shared";

function getSupportedActions(chainKey: string): AgentAction[] {
  if (chainKey === "solana") {
    return [
      "portfolio-analysis",
      "risk-review",
      "yield-scan",
      "staking-review",
      "recommendations",
    ];
  }

  return ["portfolio-analysis", "risk-review", "yield-scan", "recommendations"];
}

export function getAgentCapabilities(): AgentCapabilitiesResponse {
  const generatedAt = new Date().toISOString();

  return agentCapabilitiesResponseSchema.parse({
    generatedAt,
    capabilities: supportedChains.map((chain) => {
      const hasAgentContract = contractRegistry.contracts.some(
        (contract) => contract.chain === chain.key && contract.name.includes("Agent"),
      );

      return {
        chain: chain.key,
        family: chain.family,
        status: chain.features.agent && hasAgentContract ? "ready" : "planned",
        supportedActions: getSupportedActions(chain.key),
        readOnly: true,
        autoTransactionsEnabled: false,
        notes:
          chain.key === "solana"
            ? [
                "Solana agent can evaluate SOL exposure, staking lanes, and yield ideas.",
                "Transaction execution remains disabled until explicit approval flows exist.",
              ]
            : [
                "EVM agent can evaluate allocation, concentration, and yield opportunities.",
                "Transaction execution remains disabled until explicit approval flows exist.",
              ],
        updatedAt: generatedAt,
      };
    }),
  });
}
