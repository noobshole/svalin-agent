"use client";

import type { RecipientCheck } from "@svalin-agent/shared";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { FreeCallsLeft, FreeLimitReached } from "@/components/free-calls";
import { checkedAt } from "@/components/risk-report";
import { normaliseAddress } from "@/components/scan-form";
import { getDemoCheck, type CheckResult } from "@/lib/api";
import { cn } from "@/lib/utils/cn";

const EXAMPLES = [
  { label: "root.near", address: "root.near" },
  { label: "REF token (NEAR)", address: "token.v2.ref-finance.near" },
  { label: "USDC mint (Solana)", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
];

/* Colour only carries meaning here: the verdict and each reason's severity. */
const verdictStyle: Record<RecipientCheck["verdict"], { label: string; summary: string; text: string; border: string }> = {
  allow: { label: "Allow", summary: "No warning signs found.", text: "text-riskLow", border: "border-riskLow/40" },
  caution: { label: "Caution", summary: "Look twice before paying.", text: "text-riskMedium", border: "border-riskMedium/40" },
  block: { label: "Block", summary: "Don't send money here.", text: "text-riskHigh", border: "border-riskHigh/40" },
};

const severityDot: Record<RecipientCheck["reasons"][number]["severity"], string> = {
  block: "bg-riskHigh",
  caution: "bg-riskMedium",
  info: "bg-riskInfo",
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

export function CheckTool() {
  const address = useSearchParams().get("address")?.trim() ?? "";
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    setResult(null);
    getDemoCheck(address, controller.signal).then(setResult, () => undefined);
    return () => controller.abort();
  }, [address]);

  useEffect(() => {
    document.title = address ? `Check ${address} — Svalin` : "Check Before Paying — Svalin";
  }, [address]);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-20 pt-10 md:px-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:items-end">
        <div className="grid min-w-0 gap-2">
          <p className="eyebrow">Check Before Paying · NEAR + Solana</p>
          <h1 className="break-all text-2xl font-medium tracking-tight md:text-3xl">
            {address ? <span className="font-mono text-xl md:text-2xl">{address}</span> : "Is it safe to pay this address?"}
          </h1>
          {!address ? (
            <p className="max-w-lg text-sm leading-6 text-mutedForeground">
              Paste the address you are about to send money to. Svalin answers allow, caution or block, and says why. It only reads public data.
            </p>
          ) : null}
        </div>
        <CheckForm initialValue={address} key={address} />
      </div>

      {!address ? null : result === null ? (
        <div aria-busy="true" aria-label="Checking address" className="h-48 animate-pulse rounded-lg border border-border bg-surface" />
      ) : result.ok ? (
        <div className="grid gap-3">
          <CheckView check={result.check} />
          <FreeCallsLeft left={result.freeLeft} />
        </div>
      ) : result.status === 429 ? (
        <FreeLimitReached message={result.message} />
      ) : (
        <div className="rounded-lg border border-riskHigh/40 bg-surface p-6">
          <p className="font-medium text-riskHigh">{result.message}</p>
          {result.hint ? <p className="mt-2 text-sm text-mutedForeground">{result.hint}</p> : null}
        </div>
      )}

      <div className="grid gap-2 border-t border-border pt-6 text-sm leading-6 text-mutedForeground">
        <p>
          This free check looks at the address itself: what kind of account it is, how old it is and how much it has been used. The paid check also
          compares it with your own wallet&apos;s recent payments, to catch a look-alike address planted in your history (address poisoning).
        </p>
        <p>
          Agents can call it before every payment.{" "}
          <Link className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/#agents">
            Use the paid API or the MCP server.
          </Link>
        </p>
      </div>
    </main>
  );
}

function CheckForm({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  function check(address: string) {
    setError(null);
    router.push(`/check?address=${encodeURIComponent(address)}`);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const address = normaliseAddress(value);
    if (!address) {
      setError("That doesn't look like a Solana address or a NEAR account.");
      return;
    }
    check(address);
  }

  return (
    <form className="grid w-full gap-3" onSubmit={onSubmit}>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-1.5 focus-within:border-borderStrong sm:flex-row">
        <label className="sr-only" htmlFor="recipient">
          Address you are about to pay
        </label>
        <input
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-subtleForeground"
          id="recipient"
          onChange={(event) => setValue(event.target.value)}
          placeholder="Address you are about to pay"
          spellCheck={false}
          value={value}
        />
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primaryForeground transition-opacity hover:opacity-90"
          type="submit"
        >
          Check free
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {error ? <p className="text-sm text-riskHigh">{error}</p> : null}
      <p className="flex flex-wrap items-center gap-2 text-xs text-mutedForeground">
        Try
        {EXAMPLES.map((example) => (
          <button
            className="rounded-md border border-border px-2 py-1 font-mono text-foreground transition-colors hover:border-borderStrong"
            key={example.address}
            onClick={() => check(example.address)}
            type="button"
          >
            {example.label}
          </button>
        ))}
      </p>
    </form>
  );
}

function CheckView({ check }: { check: RecipientCheck }) {
  const verdict = verdictStyle[check.verdict];
  const { ageDays, transactions, transactionsAtLeast } = check.signals;
  const facts = [
    { label: "Account", value: kindLabel[check.kind] },
    { label: "Age", value: ageDays === null ? "Unknown" : ageDays < 1 ? "Under a day" : `${Math.floor(ageDays).toLocaleString("en-US")} days` },
    {
      label: "Transactions",
      value: transactions === null ? "Unknown" : `${transactionsAtLeast ? "At least " : ""}${transactions.toLocaleString("en-US")}`,
    },
  ];

  return (
    <section aria-label="Check result" className={cn("grid gap-6 rounded-lg border bg-surface p-6", verdict.border)}>
      <div className="grid gap-1">
        <p className="eyebrow">Verdict · {check.chain}</p>
        <p className={cn("text-3xl font-medium tracking-tight", verdict.text)}>{verdict.label}</p>
        <p className="text-sm text-mutedForeground">{verdict.summary}</p>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
        {facts.map((fact) => (
          <div className="grid gap-1 bg-surface px-4 py-3" key={fact.label}>
            <dt className="text-xs text-mutedForeground">{fact.label}</dt>
            <dd className="font-mono text-sm tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <ul className="grid gap-3">
        {check.reasons.map((reason) => (
          <li className="flex gap-3 text-sm leading-6" key={reason.code}>
            <span aria-hidden="true" className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", severityDot[reason.severity])} />
            <span className="min-w-0">
              <span className="sr-only">{reason.severity}: </span>
              {reason.message}
            </span>
          </li>
        ))}
      </ul>

      <p className="font-mono text-xs text-subtleForeground">
        Checked {checkedAt(check.checkedAt)}
      </p>
    </section>
  );
}
