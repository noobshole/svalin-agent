import Link from "next/link";

import { ReportPreview } from "@/components/report-preview";
import { API_BASE_URL } from "@/lib/api";
import { exampleReport } from "@/lib/example-report";

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

const tools = [
  {
    name: "Wallet Scan",
    body: "A grade from A to F for how risky the money in a wallet is, and what to do about it.",
    href: "/scan",
  },
  {
    name: "Check Before Paying",
    body: "Allow, caution or block before you send money to an address, with the reason.",
    href: "/check",
  },
  {
    name: "Svalin Index",
    body: "Every NEAR token graded by the real money behind its price.",
    href: "/ratings",
  },
];

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
          <Link
            className="rounded-full bg-primary px-6 py-3 text-base font-medium text-primaryForeground transition-opacity hover:opacity-90"
            href="/scan"
          >
            Scan a wallet free
          </Link>
        </div>
        <ReportPreview report={exampleReport} />
      </section>

      <section className="grid gap-10 border-t border-border py-16 md:grid-cols-3">
        {tools.map((tool) => (
          <Link className="group grid content-start gap-2" href={tool.href} key={tool.name}>
            <h2 className="text-lg font-medium tracking-tight group-hover:underline group-hover:decoration-border group-hover:underline-offset-4">
              {tool.name}
            </h2>
            <p className="text-sm leading-6 text-mutedForeground">{tool.body}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 border-t border-border py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
        <h2 className="text-2xl font-medium tracking-tight">Built for AI agents</h2>
        <p className="text-sm leading-6 text-mutedForeground">
          Agents call the same checks over HTTP or through the MCP server, and pay per call in USDC with x402: no account needed. People get 5 free
          checks a day, or <Link className={linkClass} href="/pricing">Svalin Pro</Link> for $5 a month. See the{" "}
          <Link className={linkClass} href="/docs">docs</Link>, or the machine-readable{" "}
          <a className={linkClass} href={`${API_BASE_URL}/llms.txt`}>
            llms.txt
          </a>
          .
        </p>
      </section>
    </main>
  );
}
