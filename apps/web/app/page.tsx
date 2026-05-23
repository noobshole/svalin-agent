import { defaultChain, supportedChains } from "@svalin-agent/chain-config";
import { ShieldCheck, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { AgentCapabilitiesPanel } from "@/components/agent/agent-capabilities-panel";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { fetchAgentCapabilities } from "@/lib/api/agent";

const pillars = [
  {
    icon: Wallet,
    title: "Wallet-first portfolio reads",
    description:
      "EVM wallet connectivity stays live today, while the shared portfolio model and agent surface now include Solana-aware positions.",
  },
  {
    icon: ShieldCheck,
    title: "Analytics-ready architecture",
    description:
      "Shared contracts now define the shape for balances, allocations, and risk-aware portfolio summaries.",
  },
  {
    icon: Sparkles,
    title: "Agent suggestions layer",
    description:
      "The backend now emits read-only recommendations across Ethereum, Base, and Solana without enabling auto-transactions yet.",
  },
];

export default async function HomePage() {
  const agentCapabilities = await fetchAgentCapabilities();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-10 md:px-10">
      <section className="grid gap-8 rounded-[2rem] border border-border bg-white/5 p-8 shadow-glow md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-primary">
            Phase 3 foundation
          </span>
          <div className="space-y-3">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight md:text-6xl">
              Svalin Agent keeps Web3 portfolios visible, legible, and AI-ready.
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">
              The app shell now has a dark UI baseline, chain-aware shared contracts,
              and an agent layer that can reason across Ethereum, Base, and Solana.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ConnectWalletButton />
            <Link
              className="inline-flex items-center justify-center rounded-full border border-border bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10"
              href="/dashboard"
            >
              Open dashboard
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-full border border-border bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10"
              href="/contracts"
            >
              View contracts
            </Link>
          </div>
        </div>

        <Card className="border-primary/20 bg-card/90">
          <CardContent className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground">Default chain</p>
              <p className="mt-2 text-2xl font-semibold">{defaultChain.name}</p>
            </div>
            <div className="grid gap-3">
              {supportedChains.map((chain) => (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border bg-background/70 px-4 py-3"
                  key={chain.id}
                >
                  <div>
                    <p className="font-medium">{chain.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {chain.family === "evm" ? `Chain ID ${chain.id}` : "Program chain"}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                    {chain.features.agent ? "Agent ready" : "Registry ready"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {pillars.map((pillar) => {
          const Icon = pillar.icon;

          return (
            <Card key={pillar.title}>
              <CardContent className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold">{pillar.title}</h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {pillar.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <AgentCapabilitiesPanel data={agentCapabilities} />
    </main>
  );
}
