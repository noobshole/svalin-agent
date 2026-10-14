import type { RiskFinding, RiskReport } from "@svalin-agent/shared";

import { cn } from "@/lib/utils/cn";
import { formatPct, formatUsd } from "@/lib/utils/formatting";

const gradeTone: Record<RiskReport["grade"], string> = {
  A: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  B: "text-teal-300 border-teal-400/40 bg-teal-400/10",
  C: "text-amber-300 border-amber-400/40 bg-amber-400/10",
  D: "text-orange-300 border-orange-400/40 bg-orange-400/10",
  F: "text-red-300 border-red-400/40 bg-red-400/10",
};

const severityTone: Record<RiskFinding["severity"], string> = {
  high: "bg-red-400/15 text-red-200 border-red-400/30",
  medium: "bg-orange-400/15 text-orange-200 border-orange-400/30",
  low: "bg-amber-300/10 text-amber-100 border-amber-300/25",
  info: "bg-sky-400/10 text-sky-200 border-sky-400/25",
};

export function RiskReportView({ report }: { report: RiskReport }) {
  const { metrics } = report;
  const exposure = [
    { label: "Stablecoins", value: metrics.stablecoinPct, tone: "bg-emerald-400" },
    { label: "Native", value: metrics.nativePct, tone: "bg-teal-400" },
    { label: "Liquid staking", value: metrics.liquidStakingPct, tone: "bg-cyan-400" },
    { label: "Majors", value: metrics.majorPct, tone: "bg-sky-400" },
    { label: "Memecoins", value: metrics.memePct, tone: "bg-amber-400" },
    { label: "Long-tail", value: metrics.longTailPct, tone: "bg-red-400" },
  ];

  return (
    <div className="grid gap-6">
      {report.dataSource === "mock" ? (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          This API instance is running on sample data (no Helius key configured). Numbers are illustrative.
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className={cn("flex min-w-44 flex-col items-center justify-center rounded-3xl border p-6", gradeTone[report.grade])}>
          <span className="text-7xl font-semibold leading-none">{report.grade}</span>
          <span className="mt-3 text-sm uppercase tracking-[0.2em]">{report.level} risk</span>
          <span className="mt-1 text-xs opacity-80">score {report.score}/100</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Priced value" value={formatUsd(metrics.totalValueUsd)} />
          <Stat
            label="Largest volatile bet"
            value={metrics.largestVolatilePosition ? formatPct(metrics.largestVolatilePosition.pct) : "—"}
            sub={metrics.largestVolatilePosition?.symbol}
          />
          <Stat label="Behaves like" value={`${metrics.effectivePositions.toFixed(1)} positions`} sub={`HHI ${metrics.hhi}`} />
          <Stat
            label="Data coverage"
            value={`${report.dataCoverage}%`}
            sub={`${metrics.unpricedAssetCount} unpriced token${metrics.unpricedAssetCount === 1 ? "" : "s"}`}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card/70 p-6">
        <h2 className="text-sm uppercase tracking-[0.2em] text-mutedForeground">Exposure</h2>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
          {exposure.map((slice) =>
            slice.value > 0 ? (
              <div className={slice.tone} key={slice.label} style={{ width: `${slice.value}%` }} title={`${slice.label} ${formatPct(slice.value)}`} />
            ) : null,
          )}
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-x-10 gap-y-2 text-sm sm:grid-cols-2 md:grid-cols-3">
          {exposure.map((slice) => (
            <li className="flex items-center gap-2" key={slice.label}>
              <span className={cn("h-2.5 w-2.5 rounded-full", slice.tone)} />
              <span className="text-mutedForeground">{slice.label}</span>
              <span className="ml-auto font-mono">{formatPct(slice.value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-mutedForeground">Findings</h2>
        {report.findings.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card/60 p-5 text-sm text-mutedForeground">No findings. This wallet clears every check.</p>
        ) : (
          report.findings.map((finding) => (
            <article className="rounded-2xl border border-border bg-card/70 p-5" key={finding.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full border px-2.5 py-0.5 text-xs uppercase tracking-wider", severityTone[finding.severity])}>
                  {finding.severity}
                </span>
                <h3 className="font-medium">{finding.title}</h3>
                <span className="ml-auto text-xs text-mutedForeground">confidence {finding.confidence}%</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-mutedForeground">{finding.summary}</p>
              <p className="mt-2 text-sm leading-6">
                <span className="text-primary">Next step: </span>
                {finding.action}
              </p>
            </article>
          ))
        )}
      </section>

      <p className="text-xs text-mutedForeground">
        Methodology {report.methodologyVersion} · data source {report.dataSource} · generated {new Date(report.generatedAt).toUTCString()}. Not
        financial advice. Svalin is read-only and never moves funds.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <p className="text-xs uppercase tracking-[0.15em] text-mutedForeground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      {sub ? <p className="mt-1 truncate text-xs text-mutedForeground">{sub}</p> : null}
    </div>
  );
}
