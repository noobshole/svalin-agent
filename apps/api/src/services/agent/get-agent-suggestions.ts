import {
  agentSuggestionsResponseSchema,
  type Address,
  type AgentSuggestion,
  type AgentSuggestionsResponse,
  type PortfolioAsset,
} from "@svalin-agent/shared";

import { getPortfolioOverview } from "../portfolio/get-portfolio-overview.js";

function sortByValueDescending(assets: PortfolioAsset[]) {
  return [...assets].sort((left, right) => right.valueUsd - left.valueUsd);
}

function buildConcentrationSuggestion(
  largestAsset: PortfolioAsset,
): AgentSuggestion | null {
  const allocationPct = largestAsset.allocationBps / 100;

  if (allocationPct < 45) {
    return null;
  }

  return {
    id: `concentration-${largestAsset.symbol.toLowerCase()}`,
    kind: "concentration",
    title: `Trim ${largestAsset.symbol} concentration`,
    summary: `${largestAsset.symbol} represents ${allocationPct.toFixed(
      1,
    )}% of the portfolio. Consider spreading some of that exposure into stable or yield-bearing positions.`,
    actionLabel: "Review allocation",
    confidence: 84,
    chain: largestAsset.chain,
    createdAt: new Date().toISOString(),
  };
}

function buildStableBufferSuggestion(assets: PortfolioAsset[]): AgentSuggestion | null {
  const stableValue = assets
    .filter((asset) => asset.symbol === "USDC")
    .reduce((total, asset) => total + asset.valueUsd, 0);
  const totalValue = assets.reduce((total, asset) => total + asset.valueUsd, 0);
  const stablePct = totalValue === 0 ? 0 : (stableValue / totalValue) * 100;

  if (stablePct >= 20) {
    return null;
  }

  const preferredChain = assets[0]?.chain ?? "ethereum";

  return {
    id: "stable-buffer",
    kind: "risk",
    title: "Increase defensive stablecoin buffer",
    summary: `Only ${stablePct.toFixed(
      1,
    )}% of the portfolio is held in USDC. A larger buffer could reduce drawdown risk during volatile periods.`,
    actionLabel: "Raise buffer",
    confidence: 76,
    chain: preferredChain,
    createdAt: new Date().toISOString(),
  };
}

function buildYieldSuggestion(assets: PortfolioAsset[]): AgentSuggestion | null {
  const baseUsdc = assets.find(
    (asset) => asset.chain === "base" && asset.symbol === "USDC",
  );

  if (!baseUsdc || baseUsdc.valueUsd < 1000) {
    return null;
  }

  return {
    id: "base-usdc-yield",
    kind: "yield",
    title: "Deploy idle Base USDC into monitored yield",
    summary:
      "There is enough Base USDC to evaluate a low-complexity yield venue. Keep this read-only for now and surface candidate protocols before any transaction path is enabled.",
    actionLabel: "Scan strategies",
    confidence: 71,
    chain: "base",
    createdAt: new Date().toISOString(),
  };
}

function buildSolanaSuggestion(assets: PortfolioAsset[]): AgentSuggestion | null {
  const solHolding = assets.find(
    (asset) => asset.chain === "solana" && asset.symbol === "SOL",
  );

  if (!solHolding || solHolding.valueUsd < 1500) {
    return null;
  }

  return {
    id: "solana-core-yield",
    kind: "yield",
    title: "Review Solana staking and yield lanes",
    summary:
      "The portfolio now has meaningful SOL exposure. Surface validator staking, liquid staking, and monitored stablecoin deployment ideas in the Solana agent workflow before enabling any transaction automation.",
    actionLabel: "Open Solana strategies",
    confidence: 78,
    chain: "solana",
    createdAt: new Date().toISOString(),
  };
}

export async function getAgentSuggestions(
  wallet: Address,
): Promise<AgentSuggestionsResponse> {
  const overview = await getPortfolioOverview(wallet);
  const sortedAssets = sortByValueDescending(overview.assets);
  const largestAsset = sortedAssets[0];
  const suggestions = [
    largestAsset ? buildConcentrationSuggestion(largestAsset) : null,
    buildStableBufferSuggestion(sortedAssets),
    buildYieldSuggestion(sortedAssets),
    buildSolanaSuggestion(sortedAssets),
  ].filter((suggestion): suggestion is AgentSuggestion => suggestion !== null);

  return agentSuggestionsResponseSchema.parse({
    wallet,
    generatedAt: new Date().toISOString(),
    suggestions,
  });
}
