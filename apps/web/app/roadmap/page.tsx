import type { Metadata } from "next";

import { DocPage } from "@/components/doc-page";

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
      { title: "Pay per call and MCP", body: "USDC over x402, and an MCP server with spend caps. Each chain moves to real USDC on its own." },
      {
        title: "Payment guard",
        body: "Before an agent pays any x402 service: blocks a changed payee or price, and warns before paying the same request twice.",
      },
      { title: "Famous-name check", body: "Check Before Paying catches look-alikes of well-known NEAR accounts, even on a first payment." },
      { title: "Hidden-instruction alarm", body: "Token names written to give an AI agent orders are hidden and flagged, never passed on." },
      {
        title: "Svalin Pro and Business",
        body: "One pass for people and agents: Pro by QR code, an exact amount on NEAR or over x402, and Business for heavy agent use. On test USDC until each chain takes real USDC.",
      },
    ],
  },
  {
    name: "Next",
    when: "Q4 2026",
    status: "planned",
    items: [
      { title: "Early warnings", body: "The Index flags tokens whose real money is leaving their pools, before the price moves." },
      { title: "Who can move this money", body: "Wallet reports show the keys that could move its funds, and warn when a new one appears." },
      { title: "Stress test", body: "What a wallet would still fetch if prices fell and pools thinned." },
      {
        title: "Real USDC",
        body: "Payments, Pro and keys move to real USDC chain by chain (Solana first, NEAR next), and svalin-mcp goes on npm.",
      },
      { title: "Svalin Registry on mainnet", body: "Token grades sealed on NEAR, so any contract can check them. It runs on NEAR’s test network today." },
      {
        title: "Svalin Guard on mainnet",
        body: "Spending rules for an agent that the chain enforces, on NEAR and Solana. It runs on test networks today.",
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
    ],
  },
];

export default function RoadmapPage() {
  return (
    <DocPage
      contents={phases.map((phase) => [phase.name.toLowerCase(), phase.name])}
      path="/roadmap"
      lede="Svalin starts with ratings an agent can read, then puts them on-chain where contracts can enforce them, then brings the same method to more chains."
      title="What is live, and what comes next"
    >
      {phases.map((phase) => (
        <section key={phase.name}>
          <h2 id={phase.name.toLowerCase()}>
            {phase.name} <span className="dim">{phase.when}</span>
          </h2>
          <div className="mb-4 grid gap-x-[var(--gap)] sm:grid-cols-2">
            {phase.items.map((item) => (
              <div className="grid content-start gap-1 border-t border-border py-4" key={item.title}>
                <h3 className="!m-0 !text-lg">{item.title}</h3>
                <p className="!m-0 text-sm text-mutedForeground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="mt-10">
        Dates are targets, not promises, and the order can change as we learn from the people using Svalin. Svalin stays read-only throughout: the
        Guard belongs to its owner, and Svalin never holds a key to anyone’s funds.
      </p>
    </DocPage>
  );
}
