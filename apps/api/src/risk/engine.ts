import {
  RISK_METHODOLOGY_VERSION,
  riskReportSchema,
  type PortfolioAsset,
  type PortfolioOverview,
  type RiskFinding,
  type RiskGrade,
  type RiskLevel,
  type RiskReport,
  type RiskSeverity,
  type SupportedChainKey,
} from "@svalin-agent/shared";

const NATIVE_SYMBOL: Record<SupportedChainKey, string> = { solana: "SOL", near: "NEAR" };

const STAKING_OPTIONS: Record<SupportedChainKey, string> = {
  solana: "liquid-staking options (e.g. JitoSOL, mSOL, INF)",
  near: "liquid-staking options (e.g. stNEAR, LiNEAR, rNEAR) or a validator staking pool",
};

/**
 * Svalin's risk engine. Deterministic by design: every number in a report is computed
 * here from holdings, never produced by a language model. See docs/RISK_METHODOLOGY.md.
 */

export const THRESHOLDS = {
  concentrationPct: 40,
  stableBufferPct: 10,
  longTailPct: 20,
  memePct: 15,
  idleNativePct: 20,
  idleStablePct: 50,
  unpricedCount: 5,
  smallPortfolioUsd: 50,
  exitCostPct: 5,
} as const;

const WEIGHTS = { concentration: 45, stableBuffer: 20, longTail: 35 } as const;

type Exposure = { key: string; label: string; valueUsd: number; volatile: boolean };

export function buildRiskReport(overview: PortfolioOverview, now: Date = new Date()): RiskReport {
  const assets = overview.assets.filter((asset) => asset.priceUsd !== null && asset.valueUsd > 0);
  const total = assets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const pricedAssetCount = assets.length;
  const unpricedAssetCount = overview.unpricedAssetCount;
  const dataCoverage =
    pricedAssetCount + unpricedAssetCount === 0
      ? 0
      : Math.round((100 * pricedAssetCount) / (pricedAssetCount + unpricedAssetCount));

  const pctOf = (value: number) => (total === 0 ? 0 : (value / total) * 100);
  const categoryPct = (category: PortfolioAsset["category"]) =>
    pctOf(assets.filter((asset) => asset.category === category).reduce((sum, asset) => sum + asset.valueUsd, 0));

  const stablecoinPct = categoryPct("stablecoin");
  const nativePct = categoryPct("native");
  const liquidStakingPct = categoryPct("liquid-staking");
  const majorPct = categoryPct("major");
  const memePct = categoryPct("meme");
  const longTailPct = categoryPct("long-tail");

  const largest = assets[0] ?? null;
  const exposures = groupExposures(assets);
  const largestVolatile = exposures.filter((exposure) => exposure.volatile).sort((a, b) => b.valueUsd - a.valueUsd)[0];

  const hhi = assets.reduce((sum, asset) => sum + pctOf(asset.valueUsd) ** 2, 0);

  // Exit value needs every position's market depth; one unknown makes the total unknown.
  const exitKnown = total > 0 && assets.every((asset) => typeof asset.exitValueUsd === "number");
  const exit = exitKnown ? assets.reduce((sum, asset) => sum + (asset.exitValueUsd ?? 0), 0) : null;

  const metrics: RiskReport["metrics"] = {
    totalValueUsd: round(total, 2),
    pricedAssetCount,
    unpricedAssetCount,
    largestPosition: largest ? { symbol: largest.symbol, pct: round(pctOf(largest.valueUsd), 2) } : null,
    largestVolatilePosition: largestVolatile
      ? { symbol: largestVolatile.label, pct: round(pctOf(largestVolatile.valueUsd), 2) }
      : null,
    hhi: round(Math.min(hhi, 10_000), 0),
    effectivePositions: hhi > 0 ? round(10_000 / hhi, 2) : 0,
    stablecoinPct: round(stablecoinPct, 2),
    nativePct: round(nativePct, 2),
    liquidStakingPct: round(liquidStakingPct, 2),
    majorPct: round(majorPct, 2),
    memePct: round(memePct, 2),
    longTailPct: round(longTailPct, 2),
    exitValueUsd: exit === null ? null : round(Math.min(exit, total), 2),
    exitLossPct: exit === null ? null : round(Math.max(0, Math.min(100, pctOf(total - exit))), 2),
  };

  const breakdown =
    total === 0
      ? { concentration: 0, stableBuffer: 0, longTail: 0 }
      : {
          concentration: round(WEIGHTS.concentration * ramp(metrics.largestVolatilePosition?.pct ?? 0, 30, 80), 1),
          stableBuffer: round(WEIGHTS.stableBuffer * ramp(15 - stablecoinPct, 0, 15), 1),
          longTail: round(WEIGHTS.longTail * ramp(longTailPct + 0.6 * memePct, 0, 50), 1),
        };

  // A wallet with nothing priced has nothing to score. It gets no grade rather than an A, which
  // would read as "safe" for a fresh or spam-only wallet.
  const score = total === 0 ? null : clampInt(breakdown.concentration + breakdown.stableBuffer + breakdown.longTail, 0, 100);
  const findings = buildFindings({ metrics, total, dataCoverage, chain: overview.chain });

  return riskReportSchema.parse({
    wallet: overview.wallet,
    chain: overview.chain,
    score,
    grade: score === null ? null : gradeFor(score),
    level: score === null ? null : levelFor(score),
    breakdown,
    metrics,
    findings,
    dataCoverage,
    dataSource: overview.dataSource,
    methodologyVersion: RISK_METHODOLOGY_VERSION,
    generatedAt: now.toISOString(),
  });
}

/**
 * Native, wrapped and staked versions of the same asset are one economic exposure.
 * 40% SOL + 30% JitoSOL is a 70% SOL bet, not two 35% positions; likewise NEAR + stNEAR.
 */
function groupExposures(assets: PortfolioAsset[]): Exposure[] {
  const groups = new Map<string, Exposure & { staked: boolean }>();
  for (const asset of assets) {
    const pooled = asset.category === "native" || asset.category === "liquid-staking";
    const underlying = NATIVE_SYMBOL[asset.chain];
    const key = pooled ? `underlying:${underlying}` : `${asset.chain}:${asset.tokenAddress}`;
    const group = groups.get(key) ?? {
      key,
      label: pooled ? underlying : asset.symbol,
      valueUsd: 0,
      volatile: asset.category !== "stablecoin",
      staked: false,
    };
    group.valueUsd += asset.valueUsd;
    group.staked ||= asset.category === "liquid-staking";
    groups.set(key, group);
  }
  return [...groups.values()].map(({ staked, ...exposure }) => ({
    ...exposure,
    label: staked ? `${exposure.label} (incl. staked)` : exposure.label,
  }));
}

type FindingInput = {
  metrics: RiskReport["metrics"];
  total: number;
  dataCoverage: number;
  chain: PortfolioOverview["chain"];
};

function buildFindings({ metrics, total, dataCoverage, chain }: FindingInput): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const conf = (value: number, threshold: number) => confidence(value, threshold, dataCoverage);
  const pct = (value: number) => `${value.toFixed(1)}%`;

  if (total === 0) {
    // A wallet holding only unpriced tokens is usually a spam target, so say so.
    return [
      ...(metrics.unpricedAssetCount >= THRESHOLDS.unpricedCount ? [unpricedFinding(metrics, chain)] : []),
      {
        id: "small-portfolio",
        kind: "small-portfolio",
        severity: "info",
        title: "No priced holdings found",
        summary: "Svalin found no tokens with a reliable price in this wallet, so it has no score or grade.",
        action: "Check the address, or fund the wallet before requesting a risk report.",
        value: 0,
        threshold: THRESHOLDS.smallPortfolioUsd,
        confidence: 100,
      },
    ];
  }

  const top = metrics.largestVolatilePosition;
  if (top && top.pct >= THRESHOLDS.concentrationPct) {
    findings.push({
      id: "concentration",
      kind: "concentration",
      severity: top.pct >= 70 ? "high" : top.pct >= 55 ? "medium" : "low",
      title: `${top.symbol} is ${pct(top.pct)} of the portfolio`,
      summary: `A single volatile exposure above ${THRESHOLDS.concentrationPct}% means one price move dominates the outcome. The portfolio behaves like ${metrics.effectivePositions.toFixed(1)} equal-sized positions.`,
      action: `Consider capping ${top.symbol.replace(" (incl. staked)", "")} exposure near ${THRESHOLDS.concentrationPct}% by rotating part into stablecoins or a second, uncorrelated major.`,
      value: top.pct,
      threshold: THRESHOLDS.concentrationPct,
      confidence: conf(top.pct, THRESHOLDS.concentrationPct),
    });
  }

  if (metrics.longTailPct >= THRESHOLDS.longTailPct) {
    findings.push({
      id: "long-tail-exposure",
      kind: "long-tail-exposure",
      severity: severityBands(metrics.longTailPct, [30, 40]),
      title: `${pct(metrics.longTailPct)} sits in unvetted long-tail tokens`,
      summary:
        "These tokens are outside Svalin's curated list of stablecoins, liquid-staking tokens and majors. Thin liquidity, unlock schedules and rug risk are common here.",
      action: "Review each long-tail position's liquidity and holder concentration before adding more; size them as if they can go to zero.",
      value: metrics.longTailPct,
      threshold: THRESHOLDS.longTailPct,
      confidence: conf(metrics.longTailPct, THRESHOLDS.longTailPct),
    });
  }

  if (metrics.memePct >= THRESHOLDS.memePct) {
    findings.push({
      id: "meme-exposure",
      kind: "meme-exposure",
      severity: severityBands(metrics.memePct, [30, 50]),
      title: `${pct(metrics.memePct)} is in memecoins`,
      summary: "Large-cap memecoins are liquid but routinely draw down 50-80% within weeks.",
      action: "Decide on a maximum meme allocation in advance and take profits back to it when it is exceeded.",
      value: metrics.memePct,
      threshold: THRESHOLDS.memePct,
      confidence: conf(metrics.memePct, THRESHOLDS.memePct),
    });
  }

  if (metrics.stablecoinPct < THRESHOLDS.stableBufferPct && total >= 100) {
    findings.push({
      id: "stable-buffer",
      kind: "stable-buffer",
      severity: metrics.stablecoinPct < 5 ? "medium" : "low",
      // Below 0.05% the share would print as "0.0%", which reads like a glitch.
      title:
        metrics.stablecoinPct === 0
          ? "No stablecoins held"
          : metrics.stablecoinPct < 0.05
            ? "Almost nothing held in stablecoins"
            : `Only ${pct(metrics.stablecoinPct)} held in stablecoins`,
      summary: "With almost no stable buffer, there is no dry powder for drawdowns and every fee or opportunity forces a sale of volatile assets.",
      action: `Hold at least ${THRESHOLDS.stableBufferPct}% in a major stablecoin (USDC/USDT) as a buffer.`,
      value: metrics.stablecoinPct,
      threshold: THRESHOLDS.stableBufferPct,
      confidence: conf(metrics.stablecoinPct, THRESHOLDS.stableBufferPct),
    });
  }

  if (metrics.nativePct >= THRESHOLDS.idleNativePct && metrics.liquidStakingPct < metrics.nativePct * 0.25) {
    const native = NATIVE_SYMBOL[chain];
    findings.push({
      id: "lst-opportunity",
      kind: "lst-opportunity",
      severity: "info",
      title: `${pct(metrics.nativePct)} is unstaked ${native}`,
      summary: `Liquid staking tokens keep the same ${native} price exposure while earning staking rewards and staying transferable.`,
      action: `Compare ${STAKING_OPTIONS[chain]} for part of the idle ${native}. Svalin will not execute this for you.`,
      value: metrics.nativePct,
      threshold: THRESHOLDS.idleNativePct,
      confidence: conf(metrics.nativePct, THRESHOLDS.idleNativePct),
    });
  }

  if (metrics.stablecoinPct >= THRESHOLDS.idleStablePct) {
    findings.push({
      id: "idle-stablecoins",
      kind: "idle-stablecoins",
      severity: "info",
      title: `${pct(metrics.stablecoinPct)} is parked in stablecoins`,
      summary: "Low volatility, but idle stablecoins lose to inflation and earn nothing by default.",
      action: "If this capital is not needed soon, review audited lending markets or yield-bearing stablecoins and their risks.",
      value: metrics.stablecoinPct,
      threshold: THRESHOLDS.idleStablePct,
      confidence: conf(metrics.stablecoinPct, THRESHOLDS.idleStablePct),
    });
  }

  const exitLoss = metrics.exitLossPct;
  if (typeof exitLoss === "number" && typeof metrics.exitValueUsd === "number" && exitLoss >= THRESHOLDS.exitCostPct) {
    findings.push({
      id: "exit-cost",
      kind: "exit-cost",
      severity: severityBands(exitLoss, [10, 25]),
      title: `Selling everything now would fetch about ${usd(metrics.exitValueUsd)}, ${pct(exitLoss)} less`,
      summary:
        "Some positions are large next to the real money in their trading pools, so selling them would push the price down. This assumes each position is sold on its own, at today's pool depth.",
      action: "Count these positions at their exit value, not their quoted value, and sell large ones in parts if you need to.",
      value: exitLoss,
      threshold: THRESHOLDS.exitCostPct,
      confidence: conf(exitLoss, THRESHOLDS.exitCostPct),
    });
  }

  if (metrics.unpricedAssetCount >= THRESHOLDS.unpricedCount) {
    findings.push(unpricedFinding(metrics, chain));
  }

  if (total < THRESHOLDS.smallPortfolioUsd) {
    findings.push({
      id: "small-portfolio",
      kind: "small-portfolio",
      severity: "info",
      title: `Small portfolio ($${total.toFixed(2)})`,
      summary: "Percentages swing sharply on small balances, so treat this report as indicative.",
      action: "Re-run the report once the wallet holds more value.",
      value: round(total, 2),
      threshold: THRESHOLDS.smallPortfolioUsd,
      confidence: 100,
    });
  }

  const order: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return findings.sort((left, right) => order[left.severity] - order[right.severity]);
}

function unpricedFinding(metrics: RiskReport["metrics"], chain: PortfolioOverview["chain"]): RiskFinding {
  return {
    id: "unpriced-holdings",
    kind: "unpriced-holdings",
    severity: "low",
    title: `${metrics.unpricedAssetCount} tokens have no market price`,
    summary:
      "Unpriced tokens are usually airdropped spam. Interacting with them (swapping, visiting linked sites) is a common wallet-drainer vector.",
    action:
      chain === "solana"
        ? "Do not interact with unknown tokens. Burning them and closing their token accounts reclaims the rent deposit."
        : "Do not interact with unknown tokens or call the contracts and sites they link to.",
    value: metrics.unpricedAssetCount,
    threshold: THRESHOLDS.unpricedCount,
    confidence: 100,
  };
}

/**
 * confidence = coverageFactor x distanceFactor
 *  - distanceFactor: 0.6 right at the threshold, rising to 1.0 once the value is a full
 *    threshold-width away from it.
 *  - coverageFactor: 0.7 + 0.3 x dataCoverage, so unpriced spam can dent but not erase it.
 */
export function confidence(value: number, threshold: number, dataCoverage: number): number {
  const distance = threshold === 0 ? 1 : Math.min(1, Math.abs(value - threshold) / threshold);
  const coverageFactor = 0.7 + 0.3 * (dataCoverage / 100);
  return clampInt(100 * coverageFactor * (0.6 + 0.4 * distance), 0, 100);
}

function severityBands(value: number, [medium, high]: [number, number]): RiskSeverity {
  if (value >= high) return "high";
  if (value >= medium) return "medium";
  return "low";
}

export function gradeFor(score: number): RiskGrade {
  if (score <= 20) return "A";
  if (score <= 40) return "B";
  if (score <= 60) return "C";
  if (score <= 80) return "D";
  return "F";
}

export function levelFor(score: number): RiskLevel {
  if (score <= 25) return "low";
  if (score <= 50) return "moderate";
  if (score <= 75) return "elevated";
  return "high";
}

/** Linear 0..1 ramp between `from` and `to`. */
function ramp(value: number, from: number, to: number) {
  if (value <= from) return 0;
  if (value >= to) return 1;
  return (value - from) / (to - from);
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function usd(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
