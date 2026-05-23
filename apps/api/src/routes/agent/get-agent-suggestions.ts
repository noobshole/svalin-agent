import {
  agentSuggestionsResponseSchema,
  type Address,
  type AgentSuggestionsResponse,
} from "@svalin-agent/shared";

import { getAgentSuggestions } from "../../services/agent/get-agent-suggestions.js";

export async function getAgentSuggestionsRoute(
  wallet: Address,
): Promise<AgentSuggestionsResponse> {
  const suggestions = await getAgentSuggestions(wallet);

  return agentSuggestionsResponseSchema.parse(suggestions);
}
