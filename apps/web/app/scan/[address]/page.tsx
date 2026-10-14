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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-24 pt-4 md:px-10">
      <div className="space-y-3">
        <p className="text-sm text-mutedForeground">Risk scan</p>
        <h1 className="break-all font-mono text-lg md:text-2xl">{address}</h1>
      </div>

      {result.ok ? (
        <RiskReportView report={result.report} />
      ) : (
        <div className="rounded-3xl border border-red-400/30 bg-red-400/10 p-6">
          <p className="font-medium text-red-100">{result.message}</p>
          {result.hint ? <p className="mt-2 text-sm text-red-100/80">{result.hint}</p> : null}
        </div>
      )}

      <div className="rounded-3xl border border-border bg-card/60 p-6">
        <p className="mb-3 text-sm text-mutedForeground">Scan another wallet</p>
        <ScanForm />
      </div>

      <p className="text-sm text-mutedForeground">
        Need this in an agent or at volume?{" "}
        <Link className="text-primary underline-offset-4 hover:underline" href="/#agents">
          Use the paid API or the MCP server.
        </Link>
      </p>
    </main>
  );
}
