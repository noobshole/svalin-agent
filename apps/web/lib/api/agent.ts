import {
  agentCapabilitiesResponseSchema,
  agentSuggestionsResponseSchema,
  type Address,
  type AgentCapabilitiesResponse,
  type AgentSuggestionsResponse,
} from "@svalin-agent/shared";
import { getApiBaseUrl } from "@/lib/api/base-url";

export async function fetchAgentCapabilities(): Promise<AgentCapabilitiesResponse> {
  const response = await fetch(`${getApiBaseUrl()}/agent/capabilities`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch agent capabilities.");
  }

  return agentCapabilitiesResponseSchema.parse(await response.json());
}

export async function fetchAgentSuggestions(
  wallet: Address,
): Promise<AgentSuggestionsResponse> {
  const response = await fetch(`${getApiBaseUrl()}/agent/suggestions/${wallet}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch agent suggestions.");
  }

  return agentSuggestionsResponseSchema.parse(await response.json());
}
