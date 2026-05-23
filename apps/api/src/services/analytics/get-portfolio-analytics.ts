import {
  portfolioAnalyticsSchema,
  type Address,
  type ChainExposureDatum,
  type PerformanceDatum,
  type PortfolioAnalytics,
} from "@svalin-agent/shared";

import { getPortfolioOverview } from "../portfolio/get-portfolio-overview.js";

function buildPerformanceSeries(totalValueUsd: number): PerformanceDatum[] {
  return [
    { label: "7d ago", valueUsd: Number((totalValueUsd * 0.91).toFixed(2)) },
    { label: "5d ago", valueUsd: Number((totalValueUsd * 0.94).toFixed(2)) },
    { label: "3d ago", valueUsd: Number((totalValueUsd * 0.97).toFixed(2)) },
    { label: "24h ago", valueUsd: Number((totalValueUsd * 0.986).toFixed(2)) },
    { label: "Now", valueUsd: Number(totalValueUsd.toFixed(2)) },
  ];
}

function buildChainExposure(
  assets: Awaited<ReturnType<typeof getPortfolioOverview>>["assets"],
): ChainExposureDatum[] {
  const totals = assets.reduce<Record<string, number>>((accumulator, asset) => {
    accumulator[asset.chain] = (accumulator[asset.chain] ?? 0) + asset.valueUsd;
    return accumulator;
  }, {});

  const portfolioTotal = assets.reduce((sum, asset) => sum + asset.valueUsd, 0);

  return Object.entries(totals).map(([chain, valueUsd]) => ({
    chain: chain as ChainExposureDatum["chain"],
    valueUsd: Number(valueUsd.toFixed(2)),
    allocationPct:
      portfolioTotal === 0
        ? 0
        : Number(((valueUsd / portfolioTotal) * 100).toFixed(2)),
  }));
}

export async function getPortfolioAnalytics(
  wallet: Address,
): Promise<PortfolioAnalytics> {
  const overview = await getPortfolioOverview(wallet);

  return portfolioAnalyticsSchema.parse({
    wallet,
    generatedAt: new Date().toISOString(),
    allocation: overview.assets.map((asset) => ({
      label: asset.symbol,
      valueUsd: asset.valueUsd,
      allocationPct: Number((asset.allocationBps / 100).toFixed(2)),
      chain: asset.chain,
    })),
    performance: buildPerformanceSeries(overview.totalValueUsd),
    chainExposure: buildChainExposure(overview.assets),
  });
}
