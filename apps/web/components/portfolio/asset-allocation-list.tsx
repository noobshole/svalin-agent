import type { PortfolioOverview } from "@svalin-agent/shared";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/formatting";

type AssetAllocationListProps = {
  overview: PortfolioOverview;
};

export function AssetAllocationList({ overview }: AssetAllocationListProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Asset allocation</h2>
            <p className="text-sm text-muted-foreground">
              Live contract shape from the typed portfolio endpoint.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Refreshed {new Date(overview.refreshedAt).toLocaleTimeString()}
          </p>
        </div>

        <div className="space-y-3">
          {overview.assets.map((asset) => (
            <div
              className="grid gap-3 rounded-2xl border border-border bg-background/50 px-4 py-4 md:grid-cols-[1.4fr_1fr_1fr_0.8fr]"
              key={`${asset.chain}:${asset.tokenAddress}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{asset.symbol}</p>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {asset.chain}
                  </span>
                  {asset.isCoreHolding ? (
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">
                      Core
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{asset.name}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Balance</p>
                <p className="mt-1 font-medium">{asset.balance}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Value</p>
                <p className="mt-1 font-medium">{formatCurrency(asset.valueUsd)}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">24h</p>
                <p className="mt-1 font-medium">{formatPercent(asset.change24hPct)}</p>
                <p className="text-xs text-muted-foreground">
                  {(asset.allocationBps / 100).toFixed(2)}% alloc
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
