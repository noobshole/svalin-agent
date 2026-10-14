import type { PortfolioOverview } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { buildRiskReport, confidence, gradeFor, levelFor } from "../src/risk/engine.js";
import { MockPortfolioSource } from "../src/sources/mock-source.js";
import { finaliseAssets } from "../src/sources/portfolio-source.js";
import { SOLANA_WALLET } from "./helpers.js";

const NOW = new Date("2026-10-13T00:00:00.000Z");

function overview(
  holdings: { symbol: string; category: PortfolioOverview["assets"][number]["category"]; valueUsd: number; address?: string }[],
  unpricedAssetCount = 0,
): PortfolioOverview {
  const { assets, totalValueUsd } = finaliseAssets(
    holdings.map((holding, index) => ({
      chain: "solana",
      tokenAddress: holding.address ?? `Token${String(index).padStart(2, "0")}1111111111111111111111111111`,
      symbol: holding.symbol,
      name: holding.symbol,
      balance: "1",
      priceUsd: holding.valueUsd,
      valueUsd: holding.valueUsd,
      category: holding.category,
    })),
  );
  return {
    wallet: SOLANA_WALLET,
    chain: "solana",
    totalValueUsd,
    assets,
    unpricedAssetCount,
    dataSource: "mock",
    refreshedAt: NOW.toISOString(),
  };
}

describe("risk engine", () => {
  it("scores a balanced portfolio as low risk with no material findings", () => {
    const report = buildRiskReport(
      overview([
        { symbol: "SOL", category: "native", valueUsd: 3000 },
        { symbol: "USDC", category: "stablecoin", valueUsd: 3000 },
        { symbol: "JUP", category: "major", valueUsd: 2000 },
        { symbol: "JTO", category: "major", valueUsd: 2000 },
      ]),
      NOW,
    );
    expect(report.score).toBeLessThanOrEqual(20);
    expect(report.grade).toBe("A");
    expect(report.findings.filter((finding) => finding.severity !== "info")).toEqual([]);
  });

  it("treats SOL and liquid-staked SOL as one exposure", () => {
    const report = buildRiskReport(
      overview([
        { symbol: "SOL", category: "native", valueUsd: 4000 },
        { symbol: "JitoSOL", category: "liquid-staking", valueUsd: 4000 },
        { symbol: "USDC", category: "stablecoin", valueUsd: 2000 },
      ]),
      NOW,
    );
    expect(report.metrics.largestPosition?.pct).toBe(40);
    expect(report.metrics.largestVolatilePosition).toEqual({ symbol: "SOL (incl. staked)", pct: 80 });
    const concentration = report.findings.find((finding) => finding.kind === "concentration");
    expect(concentration?.severity).toBe("high");
    expect(concentration?.action).toContain("Consider capping SOL exposure");
  });

  it("does not flag concentration in stablecoins", () => {
    const report = buildRiskReport(
      overview([
        { symbol: "USDC", category: "stablecoin", valueUsd: 9000 },
        { symbol: "SOL", category: "native", valueUsd: 1000 },
      ]),
      NOW,
    );
    expect(report.findings.some((finding) => finding.kind === "concentration")).toBe(false);
    expect(report.findings.some((finding) => finding.kind === "idle-stablecoins")).toBe(true);
  });

  it("flags heavy long-tail and meme exposure and grades it badly", () => {
    const report = buildRiskReport(
      overview([
        { symbol: "RUGZ", category: "long-tail", valueUsd: 5000 },
        { symbol: "BONK", category: "meme", valueUsd: 3000 },
        { symbol: "WIF", category: "meme", valueUsd: 2000 },
      ]),
      NOW,
    );
    expect(report.grade === "D" || report.grade === "F").toBe(true);
    expect(report.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["long-tail-exposure", "meme-exposure", "stable-buffer", "concentration"]),
    );
    expect(report.findings[0].severity).toBe("high");
  });

  it("handles an empty wallet without inventing a score", () => {
    const report = buildRiskReport(overview([], 3), NOW);
    expect(report.score).toBe(0);
    expect(report.metrics.totalValueUsd).toBe(0);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe("small-portfolio");
    expect(report.dataCoverage).toBe(0);
  });

  it("is deterministic", async () => {
    const source = new MockPortfolioSource(() => NOW);
    const data = await source.getOverview(SOLANA_WALLET);
    expect(buildRiskReport(data, NOW)).toEqual(buildRiskReport(data, NOW));
  });

  it("derives confidence from distance past threshold and data coverage", () => {
    expect(confidence(40, 40, 100)).toBe(60);
    expect(confidence(80, 40, 100)).toBe(100);
    expect(confidence(80, 40, 0)).toBe(70);
    expect(confidence(60, 40, 100)).toBeGreaterThan(confidence(45, 40, 100));
  });

  it("maps scores to grades and levels at the boundaries", () => {
    expect([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(gradeFor).join("")).toBe("AABBCCDDFF");
    expect([25, 26, 50, 51, 75, 76].map(levelFor)).toEqual(["low", "moderate", "moderate", "elevated", "elevated", "high"]);
  });

  it("allocations always sum to 10,000 bps", () => {
    const { assets } = finaliseAssets(
      [1, 1, 1].map((value, index) => ({
        chain: "solana" as const,
        tokenAddress: `Token${index}11111111111111111111111111111111`,
        symbol: `T${index}`,
        name: `T${index}`,
        balance: "1",
        priceUsd: value,
        valueUsd: value,
        category: "major" as const,
      })),
    );
    expect(assets.reduce((sum, asset) => sum + asset.allocationBps, 0)).toBe(10_000);
  });
});
