import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ReportPreview } from "@/components/report-preview";
import { API_BASE_URL } from "@/lib/api";
import { exampleReport } from "@/lib/example-report";

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";
/** Hides the browser's own disclosure triangle (site-nav.tsx is a client module, so it is not imported here). */
const summaryReset = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

const tools = [
  {
    name: "Wallet Scan",
    body: "Grades any wallet from A to F by how its money is spread, says what is wrong, and what everything would really fetch if sold.",
    href: "/scan",
  },
  {
    name: "Check Before Paying",
    body: "Answers allow, caution or block before money goes to an address, and catches names made to look like ones you know.",
    href: "/check",
  },
  {
    name: "Svalin Index",
    body: "Every NEAR token graded by the real money in its pools, so a price nobody could actually sell at stands out.",
    href: "/ratings",
  },
];

const questions: { question: string; answer: ReactNode }[] = [
  {
    question: "Can Svalin move my money?",
    answer: "No. Svalin only reads public chain data. It never asks for keys, signatures or approvals, and none of its code can send funds.",
  },
  {
    question: "What does a grade mean?",
    answer: (
      <>
        A means the money is spread out, with some in stablecoins and little in tokens that are hard to sell. F means most of it sits in one
        token or in tokens that are hard to sell, with almost nothing in stablecoins. The whole method is public in the{" "}
        <Link className={linkClass} href="/whitepaper">
          whitepaper
        </Link>
        .
      </>
    ),
  },
  {
    question: "Which chains does it cover?",
    answer: "Solana and NEAR, for wallets and payments. The Svalin Index grades NEAR tokens today; Solana tokens are planned for early 2027.",
  },
  {
    question: "What does it cost?",
    answer: (
      <>
        5 checks a day are free, with no account. Agents pay per call in USDC, from $0.002, and Svalin Pro is $5 a month for 100 checks a day.
        See{" "}
        <Link className={linkClass} href="/pricing">
          pricing
        </Link>
        .
      </>
    ),
  },
  {
    question: "Where does the data come from?",
    answer:
      "Helius for Solana, and FastNEAR and Ref Finance for NEAR. Each Svalin Index edition is published with its inputs, so anyone can check the grades.",
  },
];

const exampleAnswer = `{
  "wallet": "root.near",
  "grade": "C",
  "level": "elevated",
  "findings": [
    {
      "severity": "high",
      "title": "66.8% sits in unvetted long-tail tokens",
      "action": "Review each long-tail position's liquidity…"
    }
  ]
}`;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 md:px-8">
      <section className="grid items-center gap-14 py-20 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:py-28">
        <div className="grid justify-items-start gap-7">
          <h1 className="max-w-xl text-5xl font-medium leading-[1.05] tracking-tight md:text-6xl" style={{ textWrap: "balance" }}>
            Know the risk before your agent acts.
          </h1>
          <p className="max-w-md text-lg leading-8 text-mutedForeground">
            Risk ratings for wallets, tokens and payments on NEAR and Solana. Read-only, so it can never move your money.
          </p>
          <div className="grid justify-items-start gap-3">
            <Link
              className="rounded-full bg-primary px-6 py-3 text-base font-medium text-primaryForeground transition-opacity hover:opacity-90"
              href="/scan"
            >
              Scan a wallet free
            </Link>
            <p className="text-sm text-subtleForeground">5 free scans a day. No account, and no wallet to connect.</p>
          </div>
        </div>
        <ReportPreview report={exampleReport} />
      </section>

      <Section title="Three checks, one question: is this money safe?">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {tools.map((tool) => (
            <Link className="group grid content-start gap-3 bg-background p-6 transition-colors hover:bg-surface" href={tool.href} key={tool.name}>
              <h3 className="flex items-center justify-between gap-3 text-lg font-medium tracking-tight">
                {tool.name}
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-subtleForeground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </h3>
              <p className="text-[15px] leading-7 text-mutedForeground">{tool.body}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="How it works">
        <p className="max-w-3xl text-lg leading-8 text-mutedForeground">
          You send an address: a Solana wallet or a NEAR account. Svalin reads the chain, meaning the balances, the prices and, on NEAR, how much
          real money stands behind each token, without ever asking for a key, a signature or a wallet connection. You get a grade from A to F,
          what is wrong in plain words, and a next step. The same holdings always get the same answer.
        </p>
      </Section>

      <Section title="Built for AI agents">
        <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-4 text-[15px] leading-7 text-mutedForeground">
            <p>
              Agents call the same checks over plain HTTP or through the MCP server, and get JSON back. They pay per call in USDC over x402 on
              Solana or NEAR, with no account, or buy a pass and send its key.
            </p>
            <p>
              Before an agent pays anyone, Check Before Paying can stop it sending money to an address made to look like a familiar one.
            </p>
            <p className="flex flex-wrap gap-x-5 gap-y-2">
              <Link className={linkClass} href="/docs">
                Read the docs
              </Link>
              <a className={linkClass} href={`${API_BASE_URL}/llms.txt`}>
                llms.txt
              </a>
              <a className={linkClass} href={`${API_BASE_URL}/openapi.json`}>
                OpenAPI
              </a>
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <pre className="overflow-x-auto border-b border-border px-5 py-4 font-mono text-[13px] leading-6 text-foreground">
              <code>{`curl ${API_BASE_URL}/v1/demo/risk/root.near`}</code>
            </pre>
            <p className="px-5 pt-4 text-xs text-subtleForeground">Answer, trimmed</p>
            <pre className="overflow-x-auto px-5 pb-4 pt-2 font-mono text-[13px] leading-6 text-mutedForeground">
              <code>{exampleAnswer}</code>
            </pre>
          </div>
        </div>
      </Section>

      <Section title="Questions">
        <div className="border-t border-border">
          {questions.map((entry) => (
            <details className="group border-b border-border" key={entry.question}>
              <summary className={`${summaryReset} flex items-center justify-between gap-6 py-5 text-base font-medium`}>
                {entry.question}
                <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-subtleForeground transition-transform group-open:rotate-45" />
              </summary>
              <p className="max-w-2xl pb-6 text-[15px] leading-7 text-mutedForeground">{entry.answer}</p>
            </details>
          ))}
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-10 border-t border-border py-20">
      <h2 className="max-w-2xl text-3xl font-medium tracking-tight" style={{ textWrap: "balance" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}
