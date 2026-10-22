import type { ReactNode } from "react";

import { ReportPreview } from "@/components/report-preview";
import { ScanForm } from "@/components/scan-form";
import { API_BASE_URL, getServiceInfo } from "@/lib/api";
import { exampleReport } from "@/lib/example-report";

const fallbackPrices = { portfolio: "$0.002", risk: "$0.004", brief: "$0.02" };

export default async function HomePage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) =>
    info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;
  const apiUrl = API_BASE_URL;
  const networks = info?.payments.networks.map((network) => network.label) ?? [];
  const riskPrice = price("/v1/risk/{address}", fallbackPrices.risk);

  const plans = [
    { name: "Free scan", path: "/v1/demo/risk/{address}", returns: "Full risk report, 10 per hour", price: "Free" },
    { name: "Portfolio", path: "/v1/portfolio/{address}", returns: "Priced holdings with a risk category per token", price: price("/v1/portfolio/{address}", fallbackPrices.portfolio) },
    { name: "Risk report", path: "/v1/risk/{address}", returns: "Score, grade, exposure metrics and findings", price: riskPrice },
    { name: "Agent brief", path: "/v1/brief/{address}", returns: "Headline, summary and up to 3 actions, plus the report", price: price("/v1/brief/{address}", fallbackPrices.brief) },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 md:px-8">
      <section className="grid items-center gap-12 py-16 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:py-24" id="scan">
        <div className="grid gap-6">
          <p className="font-mono text-xs text-mutedForeground">read-only · solana + near · x402</p>
          <h1 className="max-w-xl text-4xl font-medium leading-[1.08] tracking-tight md:text-[3.25rem]">
            Know the risk before your agent acts.
          </h1>
          <p className="max-w-lg text-base leading-7 text-mutedForeground">
            Svalin turns a Solana wallet or a NEAR account into a priced portfolio and a deterministic portfolio risk report. Agents pay per call in USDC.
            No keys, no accounts, and no way to move funds.
          </p>
          <div className="max-w-lg">
            <ScanForm showExamples />
          </div>
        </div>
        <ReportPreview label="example" report={exampleReport} />
      </section>

      <section className="grid border-y border-border md:grid-cols-3">
        {[
          { title: "Cannot move funds", body: "No keys, approvals or signatures from the wallet it analyses. Public data only." },
          { title: "Never charged for errors", body: "Bad input is rejected before payment, and failed calls never settle." },
          { title: "Deterministic", body: "Same holdings, same report. No language model computes a number." },
        ].map((item, index) => (
          <div className={`grid gap-1.5 py-6 md:px-6 ${index > 0 ? "border-t border-border md:border-l md:border-t-0" : "md:pl-0"}`} key={item.title}>
            <h2 className="text-sm font-medium">{item.title}</h2>
            <p className="text-sm leading-6 text-mutedForeground">{item.body}</p>
          </div>
        ))}
      </section>

      <Section eyebrow="how it works" id="how" title="One call, one answer, nothing executed.">
        <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {[
            { step: "01", title: "Ask", body: "Your agent requests a report for any Solana wallet or NEAR account.", code: "GET /v1/risk/{address}" },
            {
              step: "02",
              title: "Pay",
              body: `The API answers 402 with the price: ${riskPrice} in USDC on ${networks.length > 0 ? networks.join(" or ") : "Solana or NEAR"}. The client pays and retries.`,
              code: "402 → PAYMENT-SIGNATURE",
            },
            { step: "03", title: "Act", body: "Grade, metrics and findings with a next step. Your agent or a human decides; Svalin never executes.", code: "200 → risk report" },
          ].map((item) => (
            <li className="grid content-start gap-3 bg-surface p-6" key={item.step}>
              <span className="font-mono text-xs text-subtleForeground">{item.step}</span>
              <h3 className="font-medium">{item.title}</h3>
              <p className="text-sm leading-6 text-mutedForeground">{item.body}</p>
              <code className="font-mono text-xs text-foreground">{item.code}</code>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="use cases" title="The read-only risk step in an agent workflow.">
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Agent guardrails", body: "Check the grade before a swap or rebalance, and ask a human when it is poor." },
            { title: "Wallet copilots", body: "Explain a wallet in plain English, on request or on a schedule." },
            { title: "Treasuries and DAOs", body: "Concentration limits and stablecoin buffer checks for each treasury wallet." },
            { title: "Research and analytics", body: "Score many wallets in one format across Solana and NEAR." },
            { title: "Agent tool catalogs", body: "Self-describing with OpenAPI and llms.txt, and a one-line MCP install." },
          ].map((item) => (
            <div className="grid gap-1.5 border-l border-border pl-4" key={item.title}>
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="text-sm leading-6 text-mutedForeground">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="pricing" id="pricing" title="Pay per call, in USDC.">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {plans.map((plan, index) => (
            <div
              className={`grid gap-1 px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-6 ${index > 0 ? "border-t border-border" : ""}`}
              key={plan.name}
            >
              <p className="text-sm font-medium">{plan.name}</p>
              <div className="min-w-0">
                <p className="text-sm text-mutedForeground">{plan.returns}</p>
                <code className="block truncate font-mono text-xs text-subtleForeground">GET {plan.path}</code>
              </div>
              <p className="font-mono text-sm">{plan.price}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-mutedForeground">
          No subscription or sign-up. Agents read prices from the 402 response, and failed calls are never charged.
        </p>
      </Section>

      <Section eyebrow="for agents" id="agents" title="Built to be called by agents.">
        <div className="grid gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid content-start gap-4 text-sm leading-6 text-mutedForeground">
            <p>
              Add the MCP server to Claude, Cursor or any MCP client. The free scan works straight away. Add a dedicated wallet with a few dollars
              of USDC for the paid tools, with a hard per-call cap and a session budget.
            </p>
            <p>
              Building your own agent? Any x402 client can call the API directly. Machine-readable docs:{" "}
              <a className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href={`${apiUrl}/llms.txt`}>
                llms.txt
              </a>{" "}
              and{" "}
              <a className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href={`${apiUrl}/openapi.json`}>
                openapi.json
              </a>
              .
            </p>
          </div>
          <div className="grid min-w-0 gap-3">
            <Snippet code={`claude mcp add svalin \\\n  -e SVALIN_API_URL=${apiUrl} \\\n  -- npx -y svalin-mcp`} title="mcp · claude code" />
            <Snippet
              code={`import { wrapFetchWithPayment, x402Client } from "@x402/fetch";\nimport { ExactSvmScheme } from "@x402/svm/exact/client";\n\nconst pay = wrapFetchWithPayment(fetch,\n  new x402Client().register("solana:*", new ExactSvmScheme(signer)));\n\nconst report = await (await pay(\`${apiUrl}/v1/risk/\${wallet}\`)).json();`}
              title="any x402 client · typescript"
            />
          </div>
        </div>
      </Section>
    </main>
  );
}

function Section({ eyebrow, title, id, children }: { eyebrow: string; title: string; id?: string; children: ReactNode }) {
  return (
    <section className="grid scroll-mt-20 gap-8 py-16 md:py-20" id={id}>
      <div className="grid gap-3">
        <p className="font-mono text-xs text-mutedForeground">{eyebrow}</p>
        <h2 className="max-w-2xl text-2xl font-medium tracking-tight md:text-3xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      <p className="border-b border-border px-4 py-2 font-mono text-xs text-subtleForeground">{title}</p>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6">
        <code>{code}</code>
      </pre>
    </div>
  );
}
