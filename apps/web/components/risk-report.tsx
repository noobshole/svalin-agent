import type { RiskFinding, RiskReport } from "@svalin-agent/shared";

import { cn } from "@/lib/utils/cn";
import { formatPct, formatUsd } from "@/lib/utils/formatting";

/* Colour only carries meaning here: the grade and finding severity. Everything else is grey. */
const gradeText: Record<RiskReport["grade"], string> = {
  A: "text-riskLow",
  B: "text-riskLow",
  C: "text-riskMedium",
  D: "text-riskHigh",
  F: "text-riskHigh",
};
const gradeFill: Record<RiskReport["grade"], string> = {
  A: "bg-riskLow",
  B: "bg-riskLow",
  C: "bg-riskMedium",
  D: "bg-riskHigh",
  F: "bg-riskHigh",
};
const severityStyle: Record<RiskFinding["severity"], { label: string; dot: string; text: string }> = {
  high: { label: "High", dot: "bg-riskHigh", text: "text-riskHigh" },
  medium: { label: "Medium", dot: "bg-riskMedium", text: "text-riskMedium" },
  low: { label: "Low", dot: "bg-riskMedium/50", text: "text-mutedForeground" },
  info: { label: "Info", dot: "bg-riskInfo", text: "text-mutedForeground" },
};

export function exposureSlices(metrics: RiskReport["metrics"]) {
  return [
    { label: "Native", value: metrics.nativePct, tone: "bg-exposure1" },
    { label: "Liquid staking", value: metrics.liquidStakingPct, tone: "bg-exposure2" },
    { label: "Majors", value: metrics.majorPct, tone: "bg-exposure3" },
    { label: "Stablecoins", value: metrics.stablecoinPct, tone: "bg-exposure4" },
    { label: "Memecoins", value: metrics.memePct, tone: "bg-riskMedium" },
    { label: "Long-tail", value: metrics.longTailPct, tone: "bg-riskHigh" },
  ];
}

export function GradeMark({ report, size = "lg" }: { report: RiskReport; size?: "lg" | "md" }) {
  return (
    <div className="flex items-end gap-4">
      <span className={cn("font-medium leading-none tracking-tight", gradeText[report.grade], size === "lg" ? "text-7xl" : "text-5xl")}>
        {report.grade}
      </span>
      <div className="pb-1">
        <p className="text-sm font-medium">
          {report.level.charAt(0).toUpperCase()}
          {report.level.slice(1)} risk
        </p>
        <p className="font-mono text-xs text-mutedForeground">score {report.score}/100</p>
      </div>
    </div>
  );
}

/** 0 (safest) to 100 (riskiest), with ticks at the grade boundaries. */
export function ScoreBar({ report }: { report: RiskReport }) {
  return (
    <div aria-label={`Risk score ${report.score} out of 100`} className="relative h-1.5 rounded-full bg-surface2" role="img">
      <div className={cn("h-full rounded-full", gradeFill[report.grade])} style={{ width: `${Math.max(report.score, 2)}%` }} />
      {[20, 40, 60, 80].map((tick) => (
        <span className="absolute top-0 h-full w-px bg-background" key={tick} style={{ left: `${tick}%` }} />
      ))}
    </div>
  );
}

export function ExposureBar({ metrics }: { metrics: RiskReport["metrics"] }) {
  return (
    <div className="flex h-2 gap-px overflow-hidden rounded-full bg-surface2">
      {exposureSlices(metrics).map((slice) =>
        slice.value > 0 ? (
          <div className={slice.tone} key={slice.label} style={{ width: `${slice.value}%` }} title={`${slice.label} ${formatPct(slice.value)}`} />
        ) : null,
      )}
    </div>
  );
}

export function FindingRow({ finding, compact = false }: { finding: RiskFinding; compact?: boolean }) {
  const style = severityStyle[finding.severity];
  return (
    <article className={cn("grid gap-1.5", compact ? "py-3" : "px-5 py-4")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-medium leading-6">{finding.title}</h3>
            <span className={cn("font-mono text-xs", style.text)}>{style.label}</span>
            {compact ? null : <span className="ml-auto font-mono text-xs text-subtleForeground">confidence {finding.confidence}%</span>}
          </div>
          {compact ? null : <p className="mt-1 text-sm leading-6 text-mutedForeground">{finding.summary}</p>}
          <p className={cn("text-sm leading-6", compact ? "text-mutedForeground" : "mt-1")}>
            <span className="text-mutedForeground">Next step: </span>
            {finding.action}
          </p>
        </div>
      </div>
    </article>
  );
}

export function RiskReportView({ report }: { report: RiskReport }) {
  const { metrics } = report;
  const stats = [
    { label: "Priced value", value: formatUsd(metrics.totalValueUsd) },
    {
      label: "Largest volatile bet",
      value: metrics.largestVolatilePosition ? formatPct(metrics.largestVolatilePosition.pct) : "—",
      sub: metrics.largestVolatilePosition?.symbol,
    },
    { label: "Behaves like", value: `${metrics.effectivePositions.toFixed(1)} positions`, sub: `HHI ${metrics.hhi}` },
    {
      label: "Data coverage",
      value: `${report.dataCoverage}%`,
      sub: `${metrics.unpricedAssetCount} unpriced token${metrics.unpricedAssetCount === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="grid gap-6">
      {report.dataSource === "mock" ? (
        <p className="rounded-lg border border-riskMedium/40 px-4 py-3 text-sm text-riskMedium">
          This API instance is running on sample data. Numbers are illustrative.
        </p>
      ) : null}

      <section className="grid overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="grid content-between gap-6 border-b border-border p-6 md:border-b-0 md:border-r">
          <GradeMark report={report} />
          <ScoreBar report={report} />
        </div>
        <dl className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              className={cn(
                "grid content-start gap-1 border-border p-5",
                index % 2 === 0 ? "border-r" : "",
                index < 2 ? "border-b lg:border-b-0" : "",
                index === 1 ? "lg:border-r" : "",
                index === 2 ? "lg:border-r" : "",
              )}
              key={stat.label}
            >
              <dt className="text-xs text-mutedForeground">{stat.label}</dt>
              <dd className="font-mono text-xl tracking-tight">{stat.value}</dd>
              {stat.sub ? <dd className="truncate font-mono text-xs text-subtleForeground">{stat.sub}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-4 rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-medium">Exposure</h2>
        <ExposureBar metrics={metrics} />
        <ul className="grid grid-cols-1 gap-x-10 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {exposureSlices(metrics).map((slice) => (
            <li className="flex items-center gap-2" key={slice.label}>
              <span className={cn("h-2 w-2 rounded-sm", slice.tone)} />
              <span className="text-mutedForeground">{slice.label}</span>
              <span className="ml-auto font-mono">{formatPct(slice.value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">
          Findings <span className="font-mono text-xs text-subtleForeground">{report.findings.length}</span>
        </h2>
        {report.findings.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-5 text-sm text-mutedForeground">No findings. This wallet clears every check.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {report.findings.map((finding) => (
              <FindingRow finding={finding} key={finding.id} />
            ))}
          </div>
        )}
      </section>

      <p className="font-mono text-xs leading-5 text-subtleForeground">
        methodology {report.methodologyVersion} · source {report.dataSource} · {new Date(report.generatedAt).toUTCString()}
        <br />
        Not financial advice. Svalin is read-only and never moves funds.
      </p>
    </div>
  );
}
