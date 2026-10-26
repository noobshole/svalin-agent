import type { RiskReport } from "@svalin-agent/shared";

import { ExposureBar, FindingRow, GradeMark, ScoreBar } from "@/components/risk-report";
import { formatPct, formatUsd } from "@/lib/utils/formatting";

/** A compact report card for the landing page. */
export function ReportPreview({ report }: { report: RiskReport }) {
  const { metrics } = report;
  const stats = [
    { label: "Value", value: formatUsd(metrics.totalValueUsd) },
    {
      label: "Largest bet",
      value: metrics.largestVolatilePosition ? `${metrics.largestVolatilePosition.symbol} ${formatPct(metrics.largestVolatilePosition.pct)}` : "—",
    },
    { label: "Coverage", value: `${report.dataCoverage}%` },
  ];
  const topFinding = report.findings[0];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-3">
        <span className="block truncate font-mono text-xs">{report.wallet}</span>
      </div>
      <div className="grid gap-5 p-5">
        <GradeMark report={report} size="md" />
        <ScoreBar report={report} />
        <dl className="grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div className="grid gap-1" key={stat.label}>
              <dt className="text-xs text-mutedForeground">{stat.label}</dt>
              <dd className="truncate font-mono text-sm">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-2">
          <p className="text-xs text-mutedForeground">Exposure</p>
          <ExposureBar metrics={metrics} />
        </div>
      </div>
      {topFinding ? (
        <div className="border-t border-border px-5">
          <FindingRow compact finding={topFinding} />
        </div>
      ) : null}
    </div>
  );
}
