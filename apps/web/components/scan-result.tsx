"use client";

import type { TokenNotice } from "@svalin-agent/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FreeCallsLeft, FreeLimitReached } from "@/components/free-calls";
import { ProReminder } from "@/components/pro-status";
import { ReportPreview } from "@/components/report-preview";
import { RiskReportView } from "@/components/risk-report";
import { ScanForm } from "@/components/scan-form";
import { gradeTone } from "@/components/token-index";
import { getDemoRisk, type DemoResult } from "@/lib/api";
import { exampleReport } from "@/lib/example-report";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/formatting";

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
    document.title = address ? `Wallet Scan ${address} — Svalin` : "Wallet Scan — Svalin";
  }, [address]);

  if (!address) return <ScanIntro />;

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-20 pt-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-end">
        <div className="grid min-w-0 gap-2">
          <p className="eyebrow">Wallet Scan</p>
          <h1 className="break-all font-mono text-xl tracking-tight md:text-2xl">{address}</h1>
        </div>
        <ScanForm key={address} />
      </div>

      <ProReminder />

      {result === null ? (
        <ReportSkeleton />
      ) : result.ok ? (
        <div className="grid gap-3">
          <RiskReportView report={result.report} />
          <FreeCallsLeft usage={result} />
        </div>
      ) : result.token ? (
        <TokenNoticeView hint={result.hint} message={result.message} token={result.token} />
      ) : result.status === 429 ? (
        <FreeLimitReached message={result.message} />
      ) : (
        <div className="rounded-lg border border-riskHigh/40 bg-surface p-6">
          <p className="font-medium text-riskHigh">{result.message}</p>
          {result.hint ? <p className="mt-2 text-sm text-mutedForeground">{result.hint}</p> : null}
        </div>
      )}

      <p className="text-sm text-mutedForeground">
        About to send money to this address? A scan rates what the wallet holds, not who owns it.{" "}
        <Link className={linkClass} href={`/check?address=${encodeURIComponent(address)}`}>
          Check it before paying
        </Link>{" "}
        instead.
      </p>
    </main>
  );
}

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

/** The Wallet Scan page before an address is entered: what a scan answers, and an example. */
function ScanIntro() {
  return (
    <main className="mx-auto grid w-full max-w-6xl items-start gap-12 px-4 pb-20 pt-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:px-8 md:pt-20">
      <div className="grid gap-6">
        <h1 className="text-3xl font-medium leading-tight tracking-tight md:text-4xl">How risky is the money in this wallet?</h1>
        <p className="max-w-lg text-base leading-7 text-mutedForeground">
          Wallet Scan grades any Solana wallet or NEAR account from A to F by how its money is spread: too much in one token, too little in
          stablecoins, too much in tokens that are hard to sell. It lists what is wrong, and on NEAR, what everything would really fetch if sold
          today.
        </p>
        <div className="max-w-lg">
          <ScanForm showExamples />
        </div>
        <p className="max-w-lg text-sm leading-6 text-mutedForeground">
          A scan judges the holdings, not the owner. To find out whether an address is safe to send money to, use{" "}
          <Link className={linkClass} href="/check">
            Check Before Paying
          </Link>
          .
        </p>
      </div>
      <ReportPreview report={exampleReport} />
    </main>
  );
}

/** The scanned address is a token: say so, and for a graded NEAR token show its Svalin Index grade. */
function TokenNoticeView({ token, message, hint }: { token: TokenNotice; message: string; hint?: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface p-6">
      <p className="font-medium">{message}</p>
      {token.grade !== null && token.backingUsd !== null ? (
        <>
          <p className="text-sm text-mutedForeground">
            Svalin Index grade <span className={cn("font-mono font-medium", gradeTone[token.grade])}>{token.grade}</span>, with{" "}
            {formatUsd(token.backingUsd)} of real backing in its pools.
          </p>
          <Link
            className="w-fit text-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            href={`/ratings?q=${encodeURIComponent(token.address)}`}
          >
            See it in the Svalin Index
          </Link>
        </>
      ) : hint ? (
        <p className="text-sm text-mutedForeground">{hint}</p>
      ) : null}
    </div>
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
