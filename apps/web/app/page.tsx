import { Bot, Coins, Lock, ScanSearch } from "lucide-react";

import { ScanForm } from "@/components/scan-form";
import { getServiceInfo, publicApiUrl } from "@/lib/api";

const fallbackPrices = { portfolio: "$0.002", risk: "$0.004", brief: "$0.02" };

export const revalidate = 300;

export default async function HomePage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) =>
    info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;
  const apiUrl = publicApiUrl();
  const networks = info?.payments.networks.map((network) => network.label) ?? [];

  const plans = [
    { name: "Free scan", price: "Free", detail: `${info ? "Rate limited per IP" : "Rate limited"}. Full risk report, no wallet needed.`, path: "/v1/demo/risk/{address}" },
    { name: "Portfolio", price: price("/v1/portfolio/{address}", fallbackPrices.portfolio), detail: "Live priced holdings with allocation and risk category.", path: "/v1/portfolio/{address}" },
    { name: "Risk report", price: price("/v1/risk/{address}", fallbackPrices.risk), detail: "Score, grade, exposure metrics and findings. No rate limit.", path: "/v1/risk/{address}" },
    { name: "Agent brief", price: price("/v1/brief/{address}", fallbackPrices.brief), detail: "Headline, summary and next steps, plus the full report.", path: "/v1/brief/{address}" },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-6 pb-24 pt-8 md:px-10">
      <section className="grid gap-8 rounded-[2rem] border border-border bg-white/5 p-8 shadow-glow md:p-12">
        <span className="inline-flex w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-primary">
          Read-only by design
        </span>
        <div className="space-y-4">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
            Portfolio risk intelligence your agent can buy, and can't abuse.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-mutedForeground">
            Svalin turns any Solana wallet or NEAR account into a priced portfolio and a deterministic risk report. Agents pay per call in USDC over x402.
            No API keys, no accounts, and no way for Svalin to touch funds.
          </p>
        </div>
        <ScanForm />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { icon: ScanSearch, title: "Deterministic, explainable", body: "Every number comes from a published methodology, not a language model. Confidence is derived, not typed in." },
          { icon: Coins, title: "Pay per call", body: `USDC on ${networks.length > 0 ? networks.join(" or ") : "Solana or NEAR"} via x402. No subscription, no signup. Errors are never charged.` },
          { icon: Lock, title: "Cannot move funds", body: "Svalin never asks for keys, approvals or signatures from the wallet it analyses. It reads public data only." },
        ].map(({ icon: Icon, title, body }) => (
          <div className="rounded-3xl border border-border bg-card/70 p-6" key={title}>
            <Icon className="h-5 w-5 text-primary" />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-mutedForeground">{body}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6" id="pricing">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
          <p className="mt-2 text-sm text-mutedForeground">Per call, settled in USDC. Agents discover prices automatically from the 402 response.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {plans.map((plan) => (
            <div className="flex flex-col rounded-3xl border border-border bg-card/70 p-6" key={plan.name}>
              <p className="text-sm text-mutedForeground">{plan.name}</p>
              <p className="mt-2 text-3xl font-semibold">{plan.price}</p>
              <p className="mt-3 flex-1 text-sm leading-6 text-mutedForeground">{plan.detail}</p>
              <code className="mt-4 block truncate rounded-xl bg-background/70 px-3 py-2 text-xs text-primary">GET {plan.path}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2" id="agents">
        <div className="min-w-0 space-y-3">
          <Bot className="h-6 w-6 text-primary" />
          <h2 className="text-3xl font-semibold tracking-tight">Built for agents</h2>
          <p className="text-sm leading-6 text-mutedForeground">
            Drop the MCP server into Claude, Cursor or any MCP client. The free scan works immediately. Add a dedicated hot wallet with a few
            dollars of USDC to unlock paid tools, with a hard per-call cap and session budget.
          </p>
          <p className="text-sm leading-6 text-mutedForeground">
            Building your own agent? Any x402 client can call the API directly. Machine-readable docs live at{" "}
            <a className="text-primary underline-offset-4 hover:underline" href={`${apiUrl}/llms.txt`}>
              /llms.txt
            </a>{" "}
            and{" "}
            <a className="text-primary underline-offset-4 hover:underline" href={`${apiUrl}/openapi.json`}>
              /openapi.json
            </a>
            .
          </p>
        </div>
        <div className="grid min-w-0 gap-3">
          <Snippet title="MCP (Claude Code)" code={`claude mcp add svalin \\\n  -e SVALIN_API_URL=${apiUrl} \\\n  -- npx -y svalin-mcp`} />
          <Snippet
            title="Any x402 client (TypeScript)"
            code={`import { wrapFetchWithPayment, x402Client } from "@x402/fetch";\nimport { ExactSvmScheme } from "@x402/svm/exact/client";\n\nconst pay = wrapFetchWithPayment(fetch,\n  new x402Client().register("solana:*", new ExactSvmScheme(signer)));\n\nconst report = await (await pay(\`${apiUrl}/v1/risk/\${wallet}\`)).json();`}
          />
        </div>
      </section>
    </main>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 rounded-3xl border border-border bg-card/70 p-5">
      <p className="text-xs uppercase tracking-[0.15em] text-mutedForeground">{title}</p>
      <pre className="mt-3 overflow-x-auto text-xs leading-6 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
