import type { AgentCapabilitiesResponse } from "@svalin-agent/shared";
import { Bot, CheckCircle2, Lock, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

type AgentCapabilitiesPanelProps = {
  data: AgentCapabilitiesResponse;
};

const actionLabels: Record<string, string> = {
  "portfolio-analysis": "Portfolio",
  "risk-review": "Risk",
  "yield-scan": "Yield",
  "staking-review": "Staking",
  recommendations: "Recs",
};

export function AgentCapabilitiesPanel({ data }: AgentCapabilitiesPanelProps) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {data.capabilities.map((capability) => (
        <Card
          className="border-border bg-card/80"
          key={`${capability.chain}-${capability.status}`}
        >
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  {capability.family === "solana" ? (
                    <Bot className="h-5 w-5" />
                  ) : (
                    <ShieldCheck className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold capitalize">
                    {capability.chain}
                  </h3>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {capability.family}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {capability.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {capability.supportedActions.map((action) => (
                <span
                  className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground"
                  key={action}
                >
                  {actionLabels[action] ?? action}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm text-muted-foreground">
              <Lock className="h-4 w-4 text-primary" />
              {capability.autoTransactionsEnabled
                ? "Transaction mode enabled"
                : "Read-only guardrails active"}
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
