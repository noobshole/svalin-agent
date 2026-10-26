import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, Status } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Svalin Pro — Svalin",
  description: "Unlimited wallet scans and every next step, for $5 a month, paid in USDC.",
};

export default function ProPage() {
  return (
    <DocPage eyebrow="Svalin Pro" lede="Unlimited scans and every next step in your reports, for $5 a month." title="For people who check before they spend.">
      <div className="not-prose my-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <div className="grid content-start gap-2 bg-surface p-6">
          <p className="eyebrow">Free</p>
          <p className="font-mono text-3xl tracking-tight text-foreground">$0</p>
          <ul className="!my-0 !pl-4 text-sm leading-6">
            <li>5 free calls a day: scans, checks and exit prices</li>
            <li>The grade, the score and what is wrong</li>
            <li>Every safety warning in Check Before Paying</li>
            <li>The Svalin Index, with exit prices for every token</li>
          </ul>
        </div>
        <div className="grid content-start gap-2 bg-surface p-6">
          <p className="eyebrow">
            Pro <Status kind="planned" />
          </p>
          <p className="font-mono text-3xl tracking-tight text-foreground">
            $5<span className="text-base text-mutedForeground"> a month</span>
          </p>
          <p className="!m-0 text-sm">or $48 a year: two months free.</p>
          <ul className="!my-0 !pl-4 text-sm leading-6">
            <li>Unlimited scans and checks</li>
            <li>Every next step in your reports</li>
            <li>Exit prices at any sale size</li>
            <li>Later: an alert when a token you hold starts losing its real money</li>
          </ul>
          <span className="mt-2 w-fit rounded-full border border-border px-4 py-2 text-sm text-mutedForeground">Checkout opens soon</span>
        </div>
      </div>

      <h2>How you pay</h2>
      <p>
        Pro is paid in USDC on Solana. The checkout shows a QR code: you scan it with your own wallet app, check the amount and Svalin&apos;s
        address there, and pay. Svalin never connects to your wallet and never asks you to sign anything.
      </p>
      <p>
        You then get a <strong>Pro code</strong>, which is your pass. It stays in your browser, and you can copy it to use Pro on another device.
        Keep it somewhere safe: Svalin cannot recover a lost code. USDC on NEAR comes next, and card payments in early 2027.
      </p>

      <h2>What stays free</h2>
      <p>
        Everyone gets 5 free calls a day, back at 00:00 UTC. A free scan always shows the grade and what is wrong, and a free check always shows
        every safety warning: Svalin never hides &quot;do not pay this address&quot; behind a paywall. Pro adds the next steps and takes the
        limit away.
      </p>

      <h2>For developers and agents</h2>
      <p>
        Agents pay per call in USDC over x402, with no account. See the <Link href="/docs">docs</Link> and the MCP server.
      </p>
    </DocPage>
  );
}
