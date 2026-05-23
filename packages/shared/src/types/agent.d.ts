import type { Address } from "./core.js";
import type { AgentSuggestion } from "./core.js";
export type AgentSuggestionsResponse = {
    wallet: Address;
    generatedAt: string;
    suggestions: AgentSuggestion[];
};
