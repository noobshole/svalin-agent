export type Address = `0x${string}`;
export type ChainAddress = string;

export type SupportedChainKey = "ethereum" | "base" | "solana";

export type ChainFamily = "evm" | "solana";

export type AgentSuggestion = {
  id: string;
  kind: "rebalance" | "concentration" | "yield" | "risk";
  title: string;
  summary: string;
  actionLabel: string;
  confidence: number;
  chain: SupportedChainKey;
  createdAt: string;
};
