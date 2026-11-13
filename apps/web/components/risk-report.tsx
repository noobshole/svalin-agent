import type { RiskFinding, RiskGrade, RiskReport } from "@svalin-agent/shared";
import Link from "next/link";

import { cn } from "@/lib/utils/cn";
import { formatPct, formatUsd, typeset } from "@/lib/utils/formatting";

/** "26 Oct 2026, 06:30 UTC": when a report or check was made. */
export function checkedAt(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

/* Colour only carries meaning here: the grade and finding severity. */
export const gradeText: Record<RiskGrade, string> = {
  A: "text-riskLow",
  B: "text-riskLow",
  C: "text-riskMedium",
  D: "text-riskHigh",
  F: "text-riskHigh",
};
const gradeFill: Record<RiskGrade, string> = {
  A: "bg-riskLow",
  B: "bg-riskLow",
  C: "bg-riskMedium",
  D: "bg-riskHigh",
  F: "bg-riskHigh",
};
const severityStyle: Record<RiskFinding["severity"], { label: string; text: string }> = {
  high: { label: "High", text: "text-riskHigh" },
  medium: { label: "Medium", text: "text-riskMedium" },
  low: { label: "Low", text: "text-mutedForeground" },
  info: { label: "Info", text: "text-mutedForeground" },
};

function exposureSlices(metrics: RiskReport["metrics"]) {
  return [
    { label: "Native", value: metrics.nativePct, tone: "bg-exposure1" },
    { label: "Liquid staking", value: metrics.liquidStakingPct, tone: "bg-exposure2" },
    { label: "Majors", value: metrics.majorPct, tone: "bg-exposure3" },
    { label: "Stablecoins", value: metrics.stablecoinPct, tone: "bg-exposure4" },
    { label: "Memecoins", value: metrics.memePct, tone: "bg-riskMedium" },
    { label: "Long-tail", value: metrics.longTailPct, tone: "bg-riskHigh" },
  ];
}

/** The sentence that goes with a grade. */
export function gradeSentence(report: RiskReport) {
  const { level, score } = report;
  if (!level || score === null) return "Not rated. Nothing here has a price to score.";
  return `${level.charAt(0).toUpperCase()}${level.slice(1)} portfolio risk. Score ${score} of 100.`;
}

/** 0 (safest) to 100 (riskiest), with ticks at the grade boundaries. Empty when the wallet is not rated. */
function ScoreBar({ report }: { report: RiskReport }) {
  const { grade, score } = report;
  return (
    <div aria-label={score === null ? "Not rated" : `Risk score ${score} out of 100`} className="relative h-2 bg-surface2" role="img">
      {grade && score !== null ? <div className={cn("h-full", gradeFill[grade])} style={{ width: `${Math.max(score, 2)}%` }} /> : null}
      {[20, 40, 60, 80].map((tick) => (
        <span className="absolute top-0 h-full w-0.5 bg-background" key={tick} style={{ left: `${tick}%` }} />
      ))}
    </div>
  );
}

function FindingRow({ finding }: { finding: RiskFinding }) {
  const style = severityStyle[finding.severity];
  return (
    <article className="grid items-baseline gap-x-4 gap-y-1 border-t border-border py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <p className={cn("text-sm", style.text)}>{style.label}</p>
      <div className="grid gap-1.5">
        <h3 className="text-lg font-normal">{typeset(finding.title)}</h3>
        <p className="text-sm text-mutedForeground">{typeset(finding.summary)}</p>
        <p className="text-sm">
          <span className="text-mutedForeground">Next step: </span>
          {finding.action ? typeset(finding.action) : <LockedStep />}
        </p>
      </div>
    </article>
  );
}

/**
 * A next step the free report leaves out. The blurred words are a fixed placeholder, never the real
 * advice, which the API does not send in a free report.
 */
function LockedStep() {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span aria-hidden="true" className="select-none text-mutedForeground blur-[3px]">
        Trim this position over the coming weeks and keep a stable reserve
      </span>
      <Link className="link" href="/pricing">
        Unlock with Pro
      </Link>
    </span>
  );
}

/** The report's figures, exposure and findings. The page around it shows the seal and the address. */
export function RiskReportView({ report }: { report: RiskReport }) {
  const { metrics } = report;
  const stats = [
    { label: "Priced value", value: formatUsd(metrics.totalValueUsd) },
    ...(typeof metrics.exitValueUsd === "number" && typeof metrics.exitLossPct === "number"
      ? [
          {
            label: "If sold now",
            value: formatUsd(metrics.exitValueUsd),
            sub: metrics.exitLossPct >= 0.5 ? `${formatPct(metrics.exitLossPct)} less` : undefined,
          },
        ]
      : []),
    {
      label: "Largest volatile bet",
      value: metrics.largestVolatilePosition ? formatPct(metrics.largestVolatilePosition.pct) : "—",
      sub: metrics.largestVolatilePosition?.symbol,
    },
    { label: "Behaves like", value: `${metrics.effectivePositions.toFixed(1)} positions`, sub: "of equal size" },
    {
      label: "Data coverage",
      value: `${report.dataCoverage}%`,
      sub: `${metrics.unpricedAssetCount} unpriced token${metrics.unpricedAssetCount === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="grid gap-12">
      {report.dataSource === "mock" ? <p className="notice text-sm text-riskMedium">This API instance is running on sample data. Numbers are illustrative.</p> : null}

      <ScoreBar report={report} />

      <dl className="border-b border-border">
        {stats.map((stat) => (
          <div className="line" key={stat.label}>
            <dt className="text-mutedForeground">{stat.label}</dt>
            <dd>
              <span className="text-lg">{stat.value}</span>
              {stat.sub ? <span className="block text-sm text-mutedForeground [overflow-wrap:anywhere]">{stat.sub}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      <section className="grid gap-4">
        <h2 className="title">Exposure</h2>
        <div className="flex h-3 gap-0.5 bg-surface2">
          {exposureSlices(metrics).map((slice) =>
            slice.value > 0 ? <div className={slice.tone} key={slice.label} style={{ width: `${slice.value}%` }} title={`${slice.label} ${formatPct(slice.value)}`} /> : null,
          )}
        </div>
        <ul className="grid gap-x-[var(--gap)] sm:grid-cols-2">
          {exposureSlices(metrics).map((slice) => (
            <li className="line !grid-cols-[auto_minmax(0,1fr)_auto] !gap-x-2" key={slice.label}>
              <span aria-hidden="true" className={cn("h-2.5 w-2.5 self-center", slice.tone)} />
              <span className="text-mutedForeground">{slice.label}</span>
              <span>{formatPct(slice.value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4">
        <h2 className="title">
          Findings <span className="dim">{report.findings.length}</span>
        </h2>
        {report.findings.length === 0 ? (
          <p className="text-mutedForeground">No findings. This wallet clears every check.</p>
        ) : (
          <div className="border-b border-border">
            {report.findings.map((finding) => (
              <FindingRow finding={finding} key={finding.id} />
            ))}
          </div>
        )}
      </section>

      <p className="text-sm text-mutedForeground">Checked {checkedAt(report.generatedAt)}. Not financial advice; Svalin only reads public data and never moves funds.</p>
    </div>
  );
}
