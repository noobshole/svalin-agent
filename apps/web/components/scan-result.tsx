"use client";

import type { TokenNotice } from "@svalin-agent/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FreeCallsLeft, FreeLimitReached } from "@/components/free-calls";
import { ProReminder } from "@/components/pro-status";
import { RiskReportView, checkedAt, gradeSentence, gradeText } from "@/components/risk-report";
import { ScanForm } from "@/components/scan-form";
import { Seal } from "@/components/seal";
import { gradeTone } from "@/components/token-index";
import { getDemoRisk, type DemoResult } from "@/lib/api";
import { gradeSealTone } from "@/lib/seal";
import { cn } from "@/lib/utils/cn";
import { formatUsd, shortAddress, typeset } from "@/lib/utils/formatting";

/** Keeps a seal small enough that it and the form below it fit on one screen. */
const SEAL_WIDTH = "w-full max-w-[min(100%,58vh)]";

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

  const report = result?.ok ? result.report : null;
  const token = result && !result.ok ? result.token : undefined;
  const grade = report?.grade ?? token?.grade ?? null;

  return (
    <main className="page main">
      <div className="grid4 items-start">
        <div className="contents lg:sticky lg:top-8 lg:col-span-2 lg:grid lg:content-start lg:gap-8">
          <div className={cn("order-1 lg:order-none", SEAL_WIDTH)}>
            <Seal address={address} tone={result ? gradeSealTone(grade) : "soft"}>
              {grade ? <span className={cn("text-[20cqw] font-light leading-none", gradeText[grade])}>{grade}</span> : null}
            </Seal>
          </div>
          <div className={cn("order-3 lg:order-none", SEAL_WIDTH)}>
            <ScanForm key={address} />
          </div>
        </div>

        <div className="order-2 grid min-w-0 gap-8 lg:order-none lg:col-span-2">
          <header className="grid gap-2">
            <h1 className="title break-all [text-wrap:wrap]">{address}</h1>
            <p className="lede">{report ? gradeSentence(report) : result ? null : "Reading the chain…"}</p>
          </header>

          <ProReminder />

          {result === null ? (
            <ReportSkeleton />
          ) : result.ok ? (
            <div className="grid gap-6">
              <RiskReportView report={result.report} />
              <FreeCallsLeft usage={result} />
            </div>
          ) : result.token ? (
            <TokenNoticeView hint={result.hint} message={result.message} token={result.token} />
          ) : result.status === 429 ? (
            <FreeLimitReached message={result.message} />
          ) : (
            <div className="notice !border-riskHigh">
              <p className="text-riskHigh">{typeset(result.message)}</p>
              {result.hint ? <p className="text-sm text-mutedForeground">{typeset(result.hint)}</p> : null}
            </div>
          )}

          <p className="border-t border-border pt-4 text-sm text-mutedForeground">
            About to send money to this address? A scan rates what the wallet holds, not who owns it.{" "}
            <Link className="link text-foreground" href={`/check?address=${encodeURIComponent(address)}`}>
              Check it before paying
            </Link>{" "}
            instead.
          </p>
        </div>
      </div>
    </main>
  );
}

const scanGives = [
  {
    title: "A portfolio risk grade",
    body: "A to F, from how the money is spread: too much in one token, too little in stablecoins, too much that is hard to sell.",
  },
  { title: "What is wrong", body: "Each problem in plain words, with a next step." },
  { title: "What it would fetch", body: "On NEAR, what everything would really sell for today, not just what the prices say." },
];

/** Before a scan: the form beside a seal that redraws as you type, with what a scan gives underneath. */
function ScanIntro() {
  const [typed, setTyped] = useState("");
  const shown = typed.trim() || "root.near";

  return (
    <main className="page main">
      <section className="grid4 items-center">
        <div className="grid content-start gap-6 lg:col-span-2">
          <h1 className="display">
            <span className="dim">How risky is the money</span> in this wallet?
          </h1>
          <p className="lede">Paste a Solana wallet or a NEAR account. The scan is free and read-only.</p>
          <ScanForm onValue={setTyped} showExamples />
        </div>
        <div className={cn("lg:col-span-2 lg:justify-self-end", SEAL_WIDTH)}>
          <Seal address={shown} tone="blue">
            <span className="text-[3.6cqw] leading-tight [overflow-wrap:anywhere]">{shortAddress(shown)}</span>
          </Seal>
        </div>
      </section>

      <dl className="mt-16 border-b border-border lg:mt-24">
        {scanGives.map((entry) => (
          <div className="grid4 !gap-y-1 border-t border-border py-5" key={entry.title}>
            <dt className="text-lg lg:col-span-2">{entry.title}</dt>
            <dd className="text-mutedForeground lg:col-span-2">{entry.body}</dd>
          </div>
        ))}
      </dl>

      <div className="grid4 mt-5">
        <p className="text-sm text-mutedForeground lg:col-span-2 lg:col-start-3">
          A scan judges the holdings, not the owner. To check an address before paying it, use{" "}
          <Link className="link text-foreground" href="/check">
            Check Before Paying
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

/** The scanned address is a token: say so, and for a graded NEAR token show its Svalin Index grade. */
function TokenNoticeView({ token, message, hint }: { token: TokenNotice; message: string; hint?: string }) {
  return (
    <div className="notice">
      <p className="text-lg">{typeset(message)}</p>
      {token.grade !== null && token.backingUsd !== null ? (
        <>
          <p className="text-sm text-mutedForeground">
            Liquidity grade <span className={gradeTone[token.grade]}>{token.grade}</span> in the Svalin Index, with {formatUsd(token.backingUsd)} of real backing in its pools.
            {token.edition ? (
              <>
                {" "}
                Edition of {checkedAt(token.edition.generatedAt)}, method <span className="font-mono text-xs">{token.edition.methodology}</span>.
              </>
            ) : null}
          </p>
          {token.selfDeclaredTest ? (
            <p className="text-sm text-riskMedium">Its own on-chain name says it is a test or not to be bought. Check the contract address before trusting the ticker.</p>
          ) : null}
          <Link className="link w-fit text-sm" href={`/ratings?q=${encodeURIComponent(token.address)}`}>
            See it in the Svalin Index
          </Link>
        </>
      ) : hint ? (
        <p className="text-sm text-mutedForeground">{typeset(hint)}</p>
      ) : null}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report" className="grid gap-4">
      <div className="h-2 animate-pulse bg-surface2" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div className="h-7 animate-pulse bg-surface2" key={row} />
      ))}
    </div>
  );
}
