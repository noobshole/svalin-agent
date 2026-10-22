import { z } from "zod";

import { supportedChainKeySchema, walletAddressSchema } from "./address.js";
import { dataSourceSchema } from "./portfolio.js";

export const RISK_METHODOLOGY_VERSION = "2026-10.5";

export const riskSeveritySchema = z.enum(["info", "low", "medium", "high"]);
export const riskLevelSchema = z.enum(["low", "moderate", "elevated", "high"]);
export const riskGradeSchema = z.enum(["A", "B", "C", "D", "F"]);

export const riskFindingKindSchema = z.enum([
  "concentration",
  "stable-buffer",
  "long-tail-exposure",
  "meme-exposure",
  "lst-opportunity",
  "idle-stablecoins",
  "unpriced-holdings",
  "small-portfolio",
]);

export const riskFindingSchema = z.object({
  id: z.string().min(1),
  kind: riskFindingKindSchema,
  severity: riskSeveritySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** A concrete, read-only next step. Svalin never executes it. */
  action: z.string().min(1),
  /** The measured value that triggered the finding (percent unless noted). */
  value: z.number(),
  /** The threshold the value was compared against. */
  threshold: z.number(),
  /**
   * 0-100. Derived, not hand-typed: data coverage x how far past the threshold
   * the measurement sits. See docs/RISK_METHODOLOGY.md.
   */
  confidence: z.number().int().min(0).max(100),
});

export const riskMetricsSchema = z.object({
  totalValueUsd: z.number().nonnegative(),
  pricedAssetCount: z.number().int().nonnegative(),
  unpricedAssetCount: z.number().int().nonnegative(),
  largestPosition: z
    .object({ symbol: z.string(), pct: z.number().min(0).max(100) })
    .nullable(),
  largestVolatilePosition: z
    .object({ symbol: z.string(), pct: z.number().min(0).max(100) })
    .nullable(),
  /** Herfindahl-Hirschman index over priced positions, 0-10,000. */
  hhi: z.number().min(0).max(10_000),
  /** 10,000 / HHI: how many equal-sized positions the portfolio behaves like. */
  effectivePositions: z.number().nonnegative(),
  stablecoinPct: z.number().min(0).max(100),
  nativePct: z.number().min(0).max(100),
  liquidStakingPct: z.number().min(0).max(100),
  majorPct: z.number().min(0).max(100),
  memePct: z.number().min(0).max(100),
  longTailPct: z.number().min(0).max(100),
});

export const riskScoreBreakdownSchema = z.object({
  concentration: z.number().min(0),
  stableBuffer: z.number().min(0),
  longTail: z.number().min(0),
});

export const riskReportSchema = z.object({
  wallet: walletAddressSchema,
  chain: supportedChainKeySchema,
  /** 0 (safest) to 100 (riskiest). Null, like grade and level, when nothing in the wallet could be priced. */
  score: z.number().int().min(0).max(100).nullable(),
  grade: riskGradeSchema.nullable(),
  level: riskLevelSchema.nullable(),
  breakdown: riskScoreBreakdownSchema,
  metrics: riskMetricsSchema,
  findings: z.array(riskFindingSchema),
  /** 0-100: share of holdings Svalin could price. Low coverage = less certain report. */
  dataCoverage: z.number().int().min(0).max(100),
  dataSource: dataSourceSchema,
  methodologyVersion: z.string(),
  generatedAt: z.string().datetime(),
});

export const briefSchema = z.object({
  wallet: walletAddressSchema,
  headline: z.string().min(1),
  summary: z.string().min(1),
  actions: z.array(z.string().min(1)).max(5),
  /** "template" or "llm:<model-id>" — who wrote the prose. Numbers always come from the engine. */
  narrator: z.string().min(1),
  risk: riskReportSchema,
  generatedAt: z.string().datetime(),
});

export type RiskSeverity = z.infer<typeof riskSeveritySchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type RiskGrade = z.infer<typeof riskGradeSchema>;
export type RiskFindingKind = z.infer<typeof riskFindingKindSchema>;
export type RiskFinding = z.infer<typeof riskFindingSchema>;
export type RiskMetrics = z.infer<typeof riskMetricsSchema>;
export type RiskReport = z.infer<typeof riskReportSchema>;
export type Brief = z.infer<typeof briefSchema>;
