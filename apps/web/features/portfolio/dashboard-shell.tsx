"use client";

import type { Address } from "@svalin-agent/shared";
import { AlertTriangle, ArrowRight, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useAccount } from "wagmi";

import { AgentSuggestionsPanel } from "@/components/agent/agent-suggestions-panel";
import { PortfolioAnalyticsPanel } from "@/components/analytics/portfolio-analytics-panel";
import { AssetAllocationList } from "@/components/portfolio/asset-allocation-list";
import { PortfolioSummaryCard } from "@/components/portfolio/portfolio-summary-card";
import { Card, CardContent } from "@/components/ui/card";
import { useAgentSuggestions } from "@/features/agent/use-agent-suggestions";
import { usePortfolioAnalytics } from "@/features/analytics/use-portfolio-analytics";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { usePortfolioOverview } from "@/features/portfolio/use-portfolio-overview";
import { formatAddress } from "@/lib/utils/formatting";

export function DashboardShell() {
  const { address, isConnected } = useAccount();
  const portfolioQuery = usePortfolioOverview(address as Address | undefined);
  const suggestionsQuery = useAgentSuggestions(address as Address | undefined);
  const analyticsQuery = usePortfolioAnalytics(address as Address | undefined);

  if (!isConnected || !address) {
    return (
      <div className="grid gap-6">
        <Card className="border-primary/20">
          <CardContent className="flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-primary">
                Dashboard locked
              </span>
              <div>
                <h1 className="text-3xl font-semibold">Connect an EVM wallet to continue</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  The portfolio dashboard is ready to consume your backend data, but
                  it needs a connected wallet address to scope the request.
                </p>
              </div>
            </div>
            <ConnectWalletButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-primary/20 bg-white/5">
          <CardContent className="space-y-5 p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Connected wallet</p>
                <h1 className="mt-2 text-3xl font-semibold">{formatAddress(address)}</h1>
              </div>
              <ConnectWalletButton />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border bg-background/50 p-4">
                <Wallet className="h-5 w-5 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">Read mode</p>
                <p className="mt-1 font-medium">No auto-transactions enabled</p>
              </div>
              <div className="rounded-2xl border border-border bg-background/50 p-4">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">Data status</p>
                <p className="mt-1 font-medium">Typed backend contract active</p>
              </div>
              <div className="rounded-2xl border border-border bg-background/50 p-4">
                <ArrowRight className="h-5 w-5 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">Next module</p>
                <p className="mt-1 font-medium">Agent suggestions panel</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
              Status
            </p>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Portfolio feed</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                The dashboard is calling the API route for the connected wallet and
                validating the response shape in shared code.
              </p>
            </div>
            <Link
              className="inline-flex items-center justify-center rounded-full border border-border bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10"
              href="/"
            >
              Back to landing
            </Link>
          </CardContent>
        </Card>
      </section>

      {portfolioQuery.isLoading ? (
        <Card>
          <CardContent className="p-8">
            <p className="text-sm text-muted-foreground">Loading portfolio...</p>
          </CardContent>
        </Card>
      ) : null}

      {portfolioQuery.isError ? (
        <Card className="border-red-500/30">
          <CardContent className="flex items-start gap-3 p-8">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" />
            <div>
              <h2 className="font-semibold">Portfolio request failed</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {(portfolioQuery.error as Error).message}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {portfolioQuery.data ? (
        <>
          <PortfolioSummaryCard overview={portfolioQuery.data} />
          {analyticsQuery.data ? (
            <PortfolioAnalyticsPanel analytics={analyticsQuery.data} />
          ) : null}
          {suggestionsQuery.data ? (
            <AgentSuggestionsPanel data={suggestionsQuery.data} />
          ) : null}
          <AssetAllocationList overview={portfolioQuery.data} />
        </>
      ) : null}
    </div>
  );
}
