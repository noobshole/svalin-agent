import type { AgentSuggestionsResponse } from "@svalin-agent/shared";
import { ArrowUpRight, Bot, ShieldAlert, Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

type AgentSuggestionsPanelProps = {
  data: AgentSuggestionsResponse;
};

const icons = {
  rebalance: ArrowUpRight,
  concentration: ShieldAlert,
  yield: Sparkles,
  risk: Bot,
} as const;

export function AgentSuggestionsPanel({ data }: AgentSuggestionsPanelProps) {
  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">AI suggestions</h2>
            <p className="text-sm text-muted-foreground">
              Read-only recommendations generated from the current multi-chain portfolio shape.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </div>

        <div className="grid gap-3">
          {data.suggestions.length === 0 ? (
            <div className="rounded-2xl border border-border bg-background/50 px-4 py-5 text-sm text-muted-foreground">
              No urgent suggestions right now.
            </div>
          ) : (
            data.suggestions.map((suggestion) => {
              const Icon = icons[suggestion.kind];

              return (
                <div
                  className="rounded-2xl border border-border bg-background/50 p-4"
                  key={suggestion.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{suggestion.title}</h3>
                          <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            {suggestion.chain}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {suggestion.summary}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{suggestion.confidence}%</p>
                      <p className="text-xs text-muted-foreground">confidence</p>
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-primary">{suggestion.actionLabel}</div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
