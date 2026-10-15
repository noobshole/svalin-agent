import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { RiskReportView } from "@/components/risk-report";
import { ScanForm } from "@/components/scan-form";
import { getDemoRisk } from "@/lib/api";
import { shortAddress } from "@/lib/utils/formatting";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Risk scan ${shortAddress(address)} — Svalin`, robots: { index: false } };
}

export default async function ScanPage({ params }: Props) {
  const { address } = await params;
  const requestHeaders = await headers();
  const clientIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? requestHeaders.get("x-real-ip");
  const result = await getDemoRisk(address, clientIp);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-20 pt-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-end">
        <div className="grid min-w-0 gap-2">
          <p className="font-mono text-xs text-mutedForeground">
            risk scan{result.ok ? ` · ${result.report.chain}` : ""}
          </p>
          <h1 className="break-all font-mono text-xl tracking-tight md:text-2xl">{address}</h1>
        </div>
        <ScanForm />
      </div>

      {result.ok ? (
        <RiskReportView report={result.report} />
      ) : (
        <div className="rounded-lg border border-riskHigh/40 bg-surface p-6">
          <p className="font-medium text-riskHigh">{result.message}</p>
          {result.hint ? <p className="mt-2 text-sm text-mutedForeground">{result.hint}</p> : null}
        </div>
      )}

      <p className="text-sm text-mutedForeground">
        Need this in an agent or at volume?{" "}
        <Link className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/#agents">
          Use the paid API or the MCP server.
        </Link>
      </p>
    </main>
  );
}
