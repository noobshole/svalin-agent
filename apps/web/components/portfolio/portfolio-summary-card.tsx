import type { PortfolioOverview } from "@svalin-agent/shared";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/formatting";

type PortfolioSummaryCardProps = {
  overview: PortfolioOverview;
};

export function PortfolioSummaryCard({
  overview,
}: PortfolioSummaryCardProps) {
  return (
    <Card className="border-primary/20">
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-sm text-muted-foreground">Portfolio value</p>
          <p className="mt-2 text-3xl font-semibold">
            {formatCurrency(overview.totalValueUsd)}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">24h change</p>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {formatPercent(overview.dayChangePct)}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Risk score</p>
          <p className="mt-2 text-2xl font-semibold">
            {overview.riskScore ?? "--"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              / 100
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
