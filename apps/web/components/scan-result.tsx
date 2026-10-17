"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { RiskReportView } from "@/components/risk-report";
import { ScanForm } from "@/components/scan-form";
import { getDemoRisk, type DemoResult } from "@/lib/api";

export function ScanResult() {
  const address = useSearchParams().get("address")?.trim() ?? "";
  const [result, setResult] = useState<DemoResult | null>(null);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    setResult(null);
    getDemoRisk(address, controller.signal).then(setResult, () => undefined);
    return () => controller.abort();
  }, [address]);

  useEffect(() => {
    document.title = address ? `Risk scan ${address} — Svalin` : "Risk scan — Svalin";
  }, [address]);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-20 pt-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-end">
        <div className="grid min-w-0 gap-2">
          <p className="font-mono text-xs text-mutedForeground">risk scan{result?.ok ? ` · ${result.report.chain}` : ""}</p>
          <h1 className="break-all font-mono text-xl tracking-tight md:text-2xl">{address || "Scan a wallet"}</h1>
        </div>
        <ScanForm key={address} />
      </div>

      {!address ? (
        <p className="text-sm text-mutedForeground">Paste a Solana address or a NEAR account above.</p>
      ) : result === null ? (
        <ReportSkeleton />
      ) : result.ok ? (
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

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report" className="grid gap-6">
      <div className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
      <div className="h-28 animate-pulse rounded-lg border border-border bg-surface" />
      <div className="h-36 animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}
