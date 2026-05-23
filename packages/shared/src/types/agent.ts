import type { Address, ChainFamily, SupportedChainKey } from "./core.js";
import type { AgentSuggestion } from "./core.js";

export type AgentSuggestionsResponse = {
  wallet: Address;
  generatedAt: string;
  suggestions: AgentSuggestion[];
};

export type AgentAction =
  | "portfolio-analysis"
  | "risk-review"
  | "yield-scan"
  | "staking-review"
  | "recommendations";

export type AgentCapability = {
  chain: SupportedChainKey;
  family: ChainFamily;
  status: "ready" | "partial" | "planned";
  supportedActions: AgentAction[];
  readOnly: boolean;
  autoTransactionsEnabled: boolean;
  notes: string[];
  updatedAt: string;
};

export type AgentCapabilitiesResponse = {
  generatedAt: string;
  capabilities: AgentCapability[];
};
