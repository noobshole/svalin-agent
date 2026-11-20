"use client";

import type { RecipientCheck, TokenNotice } from "@svalin-agent/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { FreeCallsLeft, FreeLimitReached } from "@/components/free-calls";
import { ProReminder, useProPass } from "@/components/pro-status";
import { RiskReportView, checkedAt, gradeSentence, gradeText } from "@/components/risk-report";
import { ScanForm } from "@/components/scan-form";
import { Seal } from "@/components/seal";
import { gradeTone } from "@/components/token-index";
import { getScan, type ReportProblem, type ScanResult as ScanAnswer } from "@/lib/api";
import { isRunning } from "@/lib/pro";
import type { SealTone } from "@/lib/seal";
import { cn } from "@/lib/utils/cn";
import { formatUsd, shortAddress, typeset } from "@/lib/utils/formatting";

/** Keeps a seal small enough that it and the form below it fit on one screen. */
const SEAL_WIDTH = "w-full max-w-[min(100%,58vh)]";

/* Colour only carries meaning here: the verdict, each reason's severity and the grade. */
const verdictStyle: Record<RecipientCheck["verdict"], { label: string; summary: string; text: string; tone: SealTone }> = {
  allow: { label: "Allow", summary: "No warning signs found for this address.", text: "text-riskLow", tone: "green" },
  caution: { label: "Caution", summary: "Look closer before you pay this address.", text: "text-riskMedium", tone: "amber" },
  block: { label: "Block", summary: "Don’t send money to this address.", text: "text-riskHigh", tone: "red" },
};

const severityStyle: Record<RecipientCheck["reasons"][number]["severity"], { label: string; text: string }> = {
  block: { label: "Block", text: "text-riskHigh" },
  caution: { label: "Caution", text: "text-riskMedium" },
  info: { label: "Note", text: "text-mutedForeground" },
};

const kindLabel: Record<RecipientCheck["kind"], string> = {
  wallet: "Wallet",
  contract: "Contract account",
  token: "Token contract",
  program: "Program",
  "token-account": "Token account",
  unused: "Never used",
  missing: "Does not exist",
};

/** One address, two answers: is it safe to pay, and how risky is the money it holds. */
export function ScanResult() {
  const params = useSearchParams();
  const address = params.get("address")?.trim() ?? "";
  const payer = params.get("payer")?.trim() ?? "";
  const pass = useProPass();
  const pro = isRunning(pass.status);
  const [result, setResult] = useState<ScanAnswer | null>(null);

  useEffect(() => {
    // Wait for the stored pass, so a Pro visitor's scan is not first sent as a free one.
    if (!address || !pass.ready) return;
    const controller = new AbortController();
    setResult(null);
    getScan(address, controller.signal, pro && payer ? payer : undefined).then(setResult, () => undefined);
    return () => controller.abort();
  }, [address, payer, pro, pass.ready]);

  useEffect(() => {
    document.title = address ? `Scan ${address} — Svalin` : "Scan — Svalin";
  }, [address]);

  if (!address) return <ScanIntro />;

  const scan = result?.ok ? result : null;
  const verdict = scan ? verdictStyle[scan.check.verdict] : null;
  const grade = scan?.report?.grade ?? scan?.reportProblem?.token?.grade ?? null;

  return (
    <main className="page main">
      <div className="grid4 items-start">
        <div className="contents lg:sticky lg:top-8 lg:col-span-2 lg:grid lg:content-start lg:justify-items-center lg:gap-8">
          <div className={cn("order-1 lg:order-none", SEAL_WIDTH)}>
            <Seal address={address} tone={verdict?.tone ?? "soft"}>
              {verdict ? (
                <span className="grid justify-items-center gap-[3cqw]">
                  <span className={cn("text-[10cqw] font-light leading-none", verdict.text)}>{verdict.label}</span>
                  {grade ? (
                    <span className="text-[4.2cqw] leading-none text-mutedForeground">
                      Portfolio <span className={gradeText[grade]}>{grade}</span>
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Seal>
          </div>
          <div className={cn("order-3 lg:order-none", SEAL_WIDTH)}>
            <ScanForm initialPayer={payer} key={address + payer} />
          </div>
        </div>

        <div className="order-2 grid min-w-0 gap-12 lg:order-none lg:col-span-2">
          <header className="grid gap-2">
            <h1 className="title break-all [text-wrap:wrap]">{address}</h1>
            <p className="lede">{verdict ? verdict.summary : result ? null : "Checking the address…"}</p>
          </header>

          <ProReminder />

          {result === null ? (
            <Skeleton />
          ) : result.ok ? (
            <>
              <section aria-label="Paying this address" className="grid gap-6">
                <h2 className="title">Paying this address</h2>
                <CheckView check={result.check} />
              </section>

              <section aria-label="Portfolio" className="grid gap-6">
                <div className="grid gap-2">
                  <h2 className="title">
                    Portfolio{result.report?.grade ? <span className={cn("ml-3", gradeText[result.report.grade])}>{result.report.grade}</span> : null}
                  </h2>
                  {result.report ? <p className="text-mutedForeground">{gradeSentence(result.report)}</p> : null}
                </div>
                {result.report ? <RiskReportView report={result.report} /> : <NoReport problem={result.reportProblem} />}
              </section>

              <FreeCallsLeft usage={result} />
            </>
          ) : result.status === 429 ? (
            <FreeLimitReached message={result.message} />
          ) : (
            <div className="notice !border-riskHigh">
              <p className="text-riskHigh">{typeset(result.message)}</p>
              {result.hint ? <p className="text-sm text-mutedForeground">{typeset(result.hint)}</p> : null}
            </div>
          )}

          {pro ? null : (
            <p className="border-t border-border pt-4 text-sm text-mutedForeground">
              <Link className="link text-foreground" href="/pricing">
                Svalin Pro
              </Link>{" "}
              also compares the address with wallets you paid recently, which catches a look-alike planted in your history. Agents can run the same scan{" "}
              <Link className="link text-foreground" href="/docs">
                through the API
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

const scanGives = [
  {
    title: "Allow, caution or block",
    body: "Decided by what kind of account it is, how old it is, how much it has been used, and whether its name copies a well-known account.",
  },
  {
    title: "A grade for the money it holds",
    body: "From A to F, by how the money is spread. Too much in one token, too little in stablecoins or too much that is hard to sell lowers the grade.",
  },
  {
    title: "What it would sell for",
    body: "On NEAR, what the holdings would really fetch today. A token with a thin market can be worth far less than its listed price.",
  },
  {
    title: "Your recent payments",
    body: "With Svalin Pro, the scan also compares the address with wallets you paid recently. That catches a look-alike planted in your history.",
  },
];

/** Before a scan: the form beside a seal that redraws as you type, with what a scan answers underneath. */
function ScanIntro() {
  const [typed, setTyped] = useState("");
  const shown = typed.trim() || "root.near";

  return (
    <main className="page main">
      <section className="grid4 items-center">
        <div className="grid content-start gap-6 lg:col-span-2">
          <h1 className="display">
            <span className="dim">Before you send money,</span> check the address.
          </h1>
          <p className="lede">
            Paste a Solana address or a NEAR account. Svalin tells you if anything about it looks like a scam, and grades the money it holds from A to F. It’s
            free, and you don’t connect a wallet.
          </p>
          <ProReminder />
          <ScanForm onValue={setTyped} showExamples />
        </div>
        <div className={cn("lg:col-span-2 lg:justify-self-center", SEAL_WIDTH)}>
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
          Agents can run the same scan{" "}
          <Link className="link text-foreground" href="/docs">
            through the API
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

/** The recipient check: what the address is, and each reason for the verdict. */
function CheckView({ check }: { check: RecipientCheck }) {
  const { ageDays, transactions, transactionsAtLeast } = check.signals;
  const facts = [
    { label: "Account", value: kindLabel[check.kind] },
    { label: "Age", value: ageDays === null ? "Unknown" : ageDays < 1 ? "Under a day" : `${Math.floor(ageDays).toLocaleString("en-US")} days` },
    {
      label: "Transactions",
      value: transactions === null ? "Unknown" : `${transactionsAtLeast ? "At least " : ""}${transactions.toLocaleString("en-US")}`,
    },
  ];
  // "Nothing unusual" only repeats the age and transactions shown just above it.
  const reasons = check.reasons.filter((reason) => reason.code !== "established");

  return (
    <div className="grid gap-8">
      <dl className="border-b border-border">
        {facts.map((fact) => (
          <div className="line" key={fact.label}>
            <dt className="text-mutedForeground">{fact.label}</dt>
            <dd className="text-lg">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {reasons.length > 0 ? (
        <ul aria-label="Reasons" className="border-b border-border">
          {reasons.map((reason) => (
            <li className="grid items-baseline gap-x-4 gap-y-1 border-t border-border py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]" key={reason.code}>
              <span className={cn("text-sm", severityStyle[reason.severity].text)}>{severityStyle[reason.severity].label}</span>
              <span className="min-w-0">{typeset(reason.message)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-sm text-mutedForeground">Checked {checkedAt(check.checkedAt)}</p>
    </div>
  );
}

/** Why there is no report for this address: a token (with its Svalin Index grade), or the API's reason. */
function NoReport({ problem }: { problem: ReportProblem | null }) {
  if (!problem) return <p className="text-mutedForeground">No report for this address.</p>;
  if (problem.token) return <TokenNoticeView hint={problem.hint} message={problem.message} token={problem.token} />;
  return (
    <div className="notice">
      <p className="text-lg">{typeset(problem.message)}</p>
      {problem.hint ? <p className="text-sm text-mutedForeground">{typeset(problem.hint)}</p> : null}
    </div>
  );
}

/** The address is a token: say so, and for a graded NEAR token show its Svalin Index grade. */
function TokenNoticeView({ token, message, hint }: { token: TokenNotice; message: string; hint?: string }) {
  return (
    <div className="notice">
      <p className="text-lg">{typeset(message)}</p>
      {token.grade !== null && token.backingUsd !== null ? (
        <>
          <p className="text-sm text-mutedForeground">
            The Svalin Index grades this token <span className={gradeTone[token.grade]}>{token.grade}</span> for liquidity. Its pools hold{" "}
            {formatUsd(token.backingUsd)} of real backing.
            {token.edition ? (
              <>
                {" "}
                From the edition of {checkedAt(token.edition.generatedAt)}, method <span className="font-mono text-xs">{token.edition.methodology}</span>.
              </>
            ) : null}
          </p>
          {token.selfDeclaredTest ? (
            <p className="text-sm text-riskMedium">The token’s own on-chain name says it is a test or not for sale. Check the contract address as well as the ticker.</p>
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

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Scanning the address" className="grid gap-4">
      <div className="h-2 animate-pulse bg-surface2" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div className="h-7 animate-pulse bg-surface2" key={row} />
      ))}
    </div>
  );
}
