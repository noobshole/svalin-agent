import {
  agentCapabilitiesResponseSchema,
  type AgentCapabilitiesResponse,
} from "@svalin-agent/shared";

import { getAgentCapabilities } from "../../services/agent/get-agent-capabilities.js";

export function getAgentCapabilitiesRoute(): AgentCapabilitiesResponse {
  return agentCapabilitiesResponseSchema.parse(getAgentCapabilities());
}
