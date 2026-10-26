import type { Metadata } from "next";

import { DocPage } from "@/components/doc-page";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Roadmap — Svalin",
  description: "What Svalin does today, and what comes next: on-chain grades, an agent guard, and the same ratings on Solana.",
};

type Phase = {
  name: string;
  when: string;
  status: "live" | "planned" | "research";
  items: { title: string; body: string }[];
};

const phases: Phase[] = [
  {
    name: "Live",
    when: "Today",
    status: "live",
    items: [
      { title: "Wallet risk reports", body: "A score, a grade and plain findings for any Solana wallet or NEAR account." },
      {
        title: "Check Before Paying",
        body: "Allow, caution or block for a payee, including addresses and NEAR names made to look like ones you paid.",
      },
      {
        title: "Svalin Index",
        body: "Every NEAR token graded by the real money behind its price, in editions anyone can verify, with a public track record.",
      },
      { title: "Exit prices", body: "What selling any NEAR token, or everything in a NEAR wallet, would actually fetch now." },
      { title: "Pay per call and MCP", body: "USDC over x402, and an MCP server with spend caps. Payments run on test networks for now." },
      {
        title: "Payment guard",
        body: "Before an agent pays any x402 service: blocks a payee or price that changed since first seen, and checks the payee.",
      },
    ],
  },
  {
    name: "Next",
    when: "Q4 2026",
    status: "planned",
    items: [
      { title: "Early warnings", body: "The Index flags tokens whose real money is leaving their pools, before the price moves." },
      { title: "Famous-name check", body: "Check Before Paying catches look-alikes of well-known NEAR accounts, even on a first payment." },
      { title: "Who can move this money", body: "Wallet reports show the keys that could move its funds, and warn when a new one appears." },
      { title: "Hidden-instruction alarm", body: "Token names written to give an AI agent orders are flagged, not followed." },
      { title: "Stress test", body: "What a wallet would still fetch if prices fell and pools thinned." },
      {
        title: "Mainnet payments and Svalin Pro",
        body: "Paying per call on NEAR and Solana mainnet, svalin-mcp on npm, and Svalin Pro for people, paid in USDC.",
      },
      { title: "Svalin Registry", body: "Token grades published on NEAR, so any contract or agent can read them on-chain." },
      {
        title: "Svalin Guard",
        body: "Spending rules for an agent that the chain enforces: limits, approved payees, owner approval, and no tokens it could not sell back.",
      },
    ],
  },
  {
    name: "Then",
    when: "Q1 2027",
    status: "planned",
    items: [
      {
        title: "Solana Index",
        body: "The same real-backing grades and exit prices for Solana tokens and wallets, with the same verifiable editions.",
      },
      { title: "Pro by card", body: "Svalin Pro paid by card as well as in USDC." },
      { title: "Grades in Solana smart wallets", body: "Minimum-grade rules inside existing Solana smart wallets." },
      { title: "Track-record reports", body: "Regular tables of how grades held up over weeks and months." },
    ],
  },
  {
    name: "Exploring",
    when: "Later",
    status: "research",
    items: [
      { title: "Agent ratings", body: "Grades for AI agents and the paid services they use, not only tokens and wallets." },
      { title: "One guard for both chains", body: "A Guard on NEAR that protects a Solana wallet too, using NEAR Chain Signatures." },
    ],
  },
];

export default function RoadmapPage() {
  return (
    <DocPage
      eyebrow="Roadmap"
      lede="Svalin starts with ratings an agent can read, then puts them on-chain where contracts can enforce them, then brings the same method to more chains."
      title="What is live, and what comes next"
    >
      <ol className="!mb-0 mt-10 grid !gap-0 !pl-0" style={{ listStyle: "none" }}>
        {phases.map((phase, index) => (
          <li className="relative grid gap-4 pb-10 pl-8" key={phase.name}>
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-[5px] top-2 h-2.5 w-2.5 rounded-full border",
                phase.status === "live" && "border-riskLow bg-riskLow",
                phase.status === "planned" && "border-riskMedium bg-background",
                phase.status === "research" && "border-borderStrong bg-background",
              )}
            />
            {index < phases.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-5 w-px bg-border" /> : null}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="!m-0 !text-lg">{phase.name}</h2>
              <span className="font-mono text-xs text-subtleForeground">{phase.when}</span>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {phase.items.map((item) => (
                <div className="grid content-start gap-1 bg-surface p-4" key={item.title}>
                  <p className="!m-0 text-sm font-medium text-foreground">{item.title}</p>
                  <p className="!m-0 text-sm leading-6">{item.body}</p>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <p>
        Dates are targets, not promises, and the order can change as we learn from the people using Svalin. Svalin stays read-only throughout: the
        Guard belongs to its owner, and Svalin never holds a key to anyone&apos;s funds.
      </p>
    </DocPage>
  );
}
