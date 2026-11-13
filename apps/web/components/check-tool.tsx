"use client";

import type { RecipientCheck } from "@svalin-agent/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { FreeCallsLeft, FreeLimitReached } from "@/components/free-calls";
import { ProReminder, useProPass } from "@/components/pro-status";
import { checkedAt } from "@/components/risk-report";
import { normaliseAddress } from "@/components/scan-form";
import { Seal } from "@/components/seal";
import { getDemoCheck, type CheckResult } from "@/lib/api";
import { isRunning } from "@/lib/pro";
import type { SealTone } from "@/lib/seal";
import { cn } from "@/lib/utils/cn";
import { typeset } from "@/lib/utils/formatting";

const EXAMPLES = [
  { label: "intent5.near", address: "intent5.near" },
  { label: "REF token (NEAR)", address: "token.v2.ref-finance.near" },
  { label: "USDC mint (Solana)", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
];

/* Colour only carries meaning here: the verdict and each reason's severity. */
const verdictStyle: Record<RecipientCheck["verdict"], { label: string; summary: string; text: string; tone: SealTone }> = {
  allow: { label: "Allow", summary: "No warning signs found.", text: "text-riskLow", tone: "green" },
  caution: { label: "Caution", summary: "Look twice before paying.", text: "text-riskMedium", tone: "amber" },
  block: { label: "Block", summary: "Don’t send money here.", text: "text-riskHigh", tone: "red" },
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

/** Keeps a seal small enough that it and the form below it fit on one screen. */
const SEAL_WIDTH = "w-full max-w-[min(100%,58vh)]";

export function CheckTool() {
  const params = useSearchParams();
  const address = params.get("address")?.trim() ?? "";
  const payer = params.get("payer")?.trim() ?? "";
  const pass = useProPass();
  const pro = isRunning(pass.status);
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    // Wait for the stored pass, so a Pro visitor's check is not first sent as a free one.
    if (!address || !pass.ready) return;
    const controller = new AbortController();
    setResult(null);
    getDemoCheck(address, controller.signal, pro && payer ? payer : undefined).then(setResult, () => undefined);
    return () => controller.abort();
  }, [address, payer, pro, pass.ready]);

  useEffect(() => {
    document.title = address ? `Check ${address} — Svalin` : "Check Before Paying — Svalin";
  }, [address]);

  if (!address) return <CheckIntro payer={payer} pro={pro} />;

  const verdict = result?.ok ? verdictStyle[result.check.verdict] : null;

  return (
    <main className="page main">
      <div className="grid4 items-start">
        <div className="contents lg:sticky lg:top-8 lg:col-span-2 lg:grid lg:content-start lg:gap-8">
          <div className={cn("order-1 lg:order-none", SEAL_WIDTH)}>
            <Seal address={address} tone={verdict?.tone ?? "soft"}>
              {verdict ? <span className={cn("text-[8.5cqw] leading-none", verdict.text)}>{verdict.label}</span> : null}
            </Seal>
          </div>
          <div className={cn("order-3 lg:order-none", SEAL_WIDTH)}>
            <CheckForm initialPayer={payer} initialValue={address} key={address + payer} pro={pro} />
          </div>
        </div>

        <div className="order-2 grid min-w-0 gap-8 lg:order-none lg:col-span-2">
          <header className="grid gap-2">
            <h1 className="title break-all [text-wrap:wrap]">{address}</h1>
            <p className="lede">{verdict ? verdict.summary : result ? null : "Reading the chain…"}</p>
          </header>

          <ProReminder />

          {result === null ? (
            <div aria-busy="true" aria-label="Checking address" className="grid gap-4">
              {[0, 1, 2, 3].map((row) => (
                <div className="h-7 animate-pulse bg-surface2" key={row} />
              ))}
            </div>
          ) : result.ok ? (
            <div className="grid gap-6">
              <CheckView check={result.check} />
              <FreeCallsLeft usage={result} />
            </div>
          ) : result.status === 429 ? (
            <FreeLimitReached message={result.message} />
          ) : (
            <div className="notice !border-riskHigh">
              <p className="text-riskHigh">{typeset(result.message)}</p>
              {result.hint ? <p className="text-sm text-mutedForeground">{typeset(result.hint)}</p> : null}
            </div>
          )}

          <p className="border-t border-border pt-4 text-sm text-mutedForeground">
            With{" "}
            <Link className="link text-foreground" href="/pricing">
              Svalin Pro
            </Link>{" "}
            or the paid API, a check also compares the address with your own wallet’s recent payments, to catch a look-alike planted in your history. Agents can{" "}
            <Link className="link text-foreground" href="/docs">
              call it before every payment
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}

const checkLooksAt = [
  { title: "The address itself", body: "What kind of account it is, how old it is, and how much it has been used. A token or a program is never a payee." },
  { title: "Look-alike names", body: "A NEAR name made to look like a well-known account, such as intent5.near for intents.near." },
  {
    title: "Your own history",
    body: "With Svalin Pro or the paid API, it compares the address with your wallet’s recent payments, to catch a planted look-alike.",
  },
];

/** Before a check: the form beside two look-alike addresses, with what a check looks at underneath. */
function CheckIntro({ payer, pro }: { payer: string; pro: boolean }) {
  return (
    <main className="page main">
      <section className="grid4 items-center">
        <div className="grid content-start gap-6 lg:col-span-2">
          <h1 className="display">
            <span className="dim">Check an address</span> before you pay it.
          </h1>
          <p className="lede">Paste the address you are about to send money to, on NEAR or Solana. You get allow, caution or block, and the reasons.</p>
          <ProReminder />
          <CheckForm initialPayer={payer} initialValue="" pro={pro} />
        </div>
        <div className="grid grid-cols-2 gap-[var(--gap)] lg:col-span-2 lg:pl-[clamp(32px,6vw,160px)]">
          <figure className="grid justify-items-center gap-3">
            <Seal address="intents.near" />
            <figcaption>intents.near</figcaption>
          </figure>
          <figure className="grid justify-items-center gap-3">
            <Seal address="intent5.near" tone="red">
              <span className="text-[8.5cqw] leading-none text-riskHigh">Block</span>
            </Seal>
            <figcaption>intent5.near</figcaption>
          </figure>
        </div>
      </section>

      <dl className="mt-16 border-b border-border lg:mt-24">
        {checkLooksAt.map((entry) => (
          <div className="grid4 !gap-y-1 border-t border-border py-5" key={entry.title}>
            <dt className="text-lg lg:col-span-2">{entry.title}</dt>
            <dd className="text-mutedForeground lg:col-span-2">{entry.body}</dd>
          </div>
        ))}
      </dl>

      <div className="grid4 mt-5">
        <p className="text-sm text-mutedForeground lg:col-span-2 lg:col-start-3">
          A check looks at the address you are about to pay. To grade what a wallet holds instead, use{" "}
          <Link className="link text-foreground" href="/scan">
            Wallet Scan
          </Link>
          . Agents can{" "}
          <Link className="link text-foreground" href="/docs">
            call it before every payment
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

function CheckForm({ initialValue, initialPayer, pro }: { initialValue: string; initialPayer: string; pro: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [payer, setPayer] = useState(initialPayer);
  const [error, setError] = useState<string | null>(null);

  function check(address: string, from = "") {
    setError(null);
    router.push(`/check?address=${encodeURIComponent(address)}${from ? `&payer=${encodeURIComponent(from)}` : ""}`);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const address = normaliseAddress(value);
    if (!address) {
      setError("That doesn’t look like a Solana address or a NEAR account.");
      return;
    }
    const from = pro && payer.trim() ? normaliseAddress(payer) : "";
    if (from === null) {
      setError("Your wallet doesn’t look like a Solana address or a NEAR account.");
      return;
    }
    check(address, from);
  }

  return (
    <form className="grid w-full gap-3" onSubmit={onSubmit}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="recipient">
          Address you are about to pay
        </label>
        <input
          autoCapitalize="off"
          autoComplete="off"
          className="field flex-1"
          id="recipient"
          onChange={(event) => setValue(event.target.value)}
          placeholder="Address you are about to pay"
          spellCheck={false}
          value={value}
        />
        <button className="btn" type="submit">
          {pro ? "Check" : "Check free"}
        </button>
      </div>
      {pro ? (
        <div className="grid gap-1">
          <label className="text-sm text-mutedForeground" htmlFor="payer">
            Your wallet (Pro, optional): also catches look-alikes of addresses you paid
          </label>
          <input
            autoCapitalize="off"
            autoComplete="off"
            className="field"
            id="payer"
            onChange={(event) => setPayer(event.target.value)}
            placeholder="The wallet you will pay from"
            spellCheck={false}
            value={payer}
          />
        </div>
      ) : null}
      {error ? <p className="text-sm text-riskHigh">{error}</p> : null}
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-mutedForeground">
        Try
        {EXAMPLES.map((example) => (
          <button className="link text-foreground" key={example.address} onClick={() => check(example.address)} type="button">
            {example.label}
          </button>
        ))}
      </p>
    </form>
  );
}

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

  return (
    <section aria-label="Check result" className="grid gap-12">
      <dl className="border-b border-border">
        {facts.map((fact) => (
          <div className="line" key={fact.label}>
            <dt className="text-mutedForeground">{fact.label}</dt>
            <dd className="text-lg">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <section className="grid gap-4">
        <h2 className="title">Reasons</h2>
        <ul className="border-b border-border">
          {check.reasons.map((reason) => (
            <li className="grid items-baseline gap-x-4 gap-y-1 border-t border-border py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]" key={reason.code}>
              <span className={cn("text-sm", severityStyle[reason.severity].text)}>{severityStyle[reason.severity].label}</span>
              <span className="min-w-0">{typeset(reason.message)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-mutedForeground">Checked {checkedAt(check.checkedAt)}</p>
    </section>
  );
}
