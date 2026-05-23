"use client";

import type { PortfolioAnalytics } from "@svalin-agent/shared";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatting";

type PortfolioAnalyticsPanelProps = {
  analytics: PortfolioAnalytics;
};

const allocationColors = ["#2dd4bf", "#38bdf8", "#f59e0b", "#fb7185", "#818cf8"];

export function PortfolioAnalyticsPanel({
  analytics,
}: PortfolioAnalyticsPanelProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <CardContent className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold">Portfolio momentum</h2>
            <p className="text-sm text-muted-foreground">
              Lightweight trend series generated from the current portfolio total.
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer height="100%" width="100%">
              <AreaChart data={analytics.performance}>
                <defs>
                  <linearGradient id="momentumFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
                <XAxis dataKey="label" stroke="#94a3b8" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#94a3b8"
                  tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    borderRadius: "16px",
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Area
                  dataKey="valueUsd"
                  fill="url(#momentumFill)"
                  stroke="#2dd4bf"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold">Allocation mix</h2>
            <p className="text-sm text-muted-foreground">
              Symbol-level allocation from the backend analytics route.
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer height="100%" width="100%">
              <PieChart>
                <Pie
                  data={analytics.allocation}
                  dataKey="valueUsd"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={3}
                >
                  {analytics.allocation.map((entry, index) => (
                    <Cell
                      fill={allocationColors[index % allocationColors.length]}
                      key={`${entry.label}-${entry.chain}`}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    borderRadius: "16px",
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2">
            {analytics.allocation.map((entry, index) => (
              <div
                className="flex items-center justify-between rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm"
                key={`${entry.label}-${entry.chain}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor:
                        allocationColors[index % allocationColors.length],
                    }}
                  />
                  <span>{entry.label}</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {entry.chain}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {entry.allocationPct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
