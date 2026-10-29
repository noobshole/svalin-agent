"use client";

import { PRO_CODE_PREFIX, isProCode, newSvalinKey, proReference, type KeyStatus, type NearCheckout, type ProOffer, type ProPlan } from "@svalin-agent/shared";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { formatDay } from "@/components/pro-status";
import { QrCode } from "@/components/qr-code";
import {
  activatePro,
  forgetPro,
  getProOffer,
  isRunning,
  proDaysLeft,
  reserveNearAmount,
  solanaPayUrl,
  storeProCode,
  storeProStatus,
  storedProCode,
  storedProStatus,
} from "@/lib/pro";
import { cn } from "@/lib/utils/cn";

/** While the payment step is open, the payment is looked for every 10 seconds, for 15 minutes. */
const POLL_MS = 10_000;
const POLL_FOR_MS = 15 * 60_000;

type Chain = "solana" | "near";

const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primaryForeground transition-opacity hover:opacity-90 disabled:opacity-50";
const quietButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:border-borderStrong";
const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

/**
 * Svalin Pro checkout. The buyer pays from their own wallet app; this page never connects to a
 * wallet. The Pro code is made and kept in this browser, and the API finds the payment on-chain:
 * by the code's Solana Pay reference, or on NEAR by the exact amount reserved for the code.
 */
export function ProCheckout() {
  const [offer, setOffer] = useState<ProOffer | null | undefined>(undefined);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [plan, setPlan] = useState<ProPlan>("year");
  const [chain, setChain] = useState<Chain>("solana");
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [nearCheckout, setNearCheckout] = useState<NearCheckout | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [pollUntil, setPollUntil] = useState(0);

  const check = useCallback(async (which: string) => {
    setChecking(true);
    const result = await activatePro(which);
    setChecking(false);
    setCheckedAt(Date.now());
    if (!result.ok) {
      setMessage(result.message);
      if (result.status === 429) setPollUntil(0);
      return null;
    }
    setMessage(null);
    const { status: next, found } = result.activation;
    if (next) {
      setStatus(next);
      storeProStatus(next);
    }
    if (next?.active && found > 0) {
      setPaying(false);
      setPollUntil(0);
    }
    return result.activation;
  }, []);

  useEffect(() => {
    const stored = storedProCode();
    setCode(stored);
    setStatus(storedProStatus());
    // A payment made after the visitor last left this page is picked up now.
    if (stored) void check(stored);
    const controller = new AbortController();
    void getProOffer(controller.signal).then((loaded) => {
      setOffer(loaded);
      if (loaded && !loaded.solana && loaded.near) setChain("near");
    });
    return () => controller.abort();
  }, [check]);

  useEffect(() => {
    setReference(null);
    if (code) void proReference(code).then(setReference);
  }, [code]);

  useEffect(() => {
    if (!paying || !code || pollUntil === 0) return;
    const timer = setInterval(() => {
      if (Date.now() > pollUntil) setPollUntil(0);
      else if (document.visibilityState === "visible") void check(code);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [paying, code, pollUntil, check]);

  // NEAR is matched by an exact amount, reserved per code and plan.
  useEffect(() => {
    if (!paying || chain !== "near" || !code) return;
    setNearCheckout(null);
    void reserveNearAmount(code, plan).then((result) => (result.ok ? setNearCheckout(result.checkout) : setMessage(result.message)));
  }, [paying, chain, plan, code]);

  function startPaying() {
    let current = code;
    if (!current) {
      current = newSvalinKey(PRO_CODE_PREFIX);
      storeProCode(current);
      setCode(current);
    }
    setMessage(null);
    setPaying(true);
    setPollUntil(Date.now() + POLL_FOR_MS);
  }

  async function adoptCode(entered: string) {
    if (code && code !== entered && !window.confirm("Replace the Pro code kept in this browser? Copy it first if you still need it.")) return;
    storeProCode(entered);
    setCode(entered);
    setStatus(null);
    const activation = await check(entered);
    if (activation && !activation.status) {
      setMessage("No payment was found for this code yet. If you have just paid, wait a minute and try again.");
    }
  }

  function removePass() {
    if (!window.confirm("Remove your Pro code from this browser? Copy it first: Svalin cannot show it again.")) return;
    forgetPro();
    setCode(null);
    setStatus(null);
    setPaying(false);
  }

  if (offer === undefined) {
    return <div aria-busy="true" aria-label="Loading checkout" className="h-64 animate-pulse rounded-lg border border-border bg-surface" />;
  }
  if (offer === null || (!offer.solana && !offer.near)) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-mutedForeground">
        The checkout cannot reach the Svalin API right now. Try again in a minute.
      </div>
    );
  }

  const chosen = offer.plans.find((entry) => entry.id === plan) ?? offer.plans[0]!;
  const active = isRunning(status);
  const testMode = (chain === "solana" ? offer.solana : offer.near)?.environment === "testnet";

  return (
    <div className="not-prose grid scroll-mt-20 gap-4 rounded-lg border border-border bg-surface p-6 text-foreground [&_p]:mb-0 [&_p]:max-w-none" id="checkout">
      {active && status?.until && !paying ? (
        <ActivePass days={proDaysLeft(status)} onRenew={startPaying} onRemove={removePass} status={status} code={code} />
      ) : (
        <>
          <div className="grid gap-1">
            <p className="text-lg font-medium">{paying ? "Pay from your own wallet app" : "Choose your pass"}</p>
          </div>

          {testMode ? (
            <p className="rounded-md border border-riskMedium/40 px-3 py-2 text-sm">
              Test mode: this checkout takes free test USDC on {chain === "solana" ? "Solana devnet" : "NEAR testnet"}. Real USDC opens soon,
              and a test pass stops working then.
            </p>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm text-mutedForeground">Pass</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {offer.plans.map((entry) => (
                <label
                  className={cn(
                    "flex cursor-pointer items-baseline justify-between gap-3 rounded-md border px-4 py-3 text-sm",
                    plan === entry.id ? "border-foreground" : "border-border hover:border-borderStrong",
                  )}
                  key={entry.id}
                >
                  <span className="flex items-center gap-2">
                    <input checked={plan === entry.id} className="accent-current" name="plan" onChange={() => setPlan(entry.id)} type="radio" />
                    {entry.id === "year" ? "1 year" : "30 days"}
                    {entry.id === "year" ? <span className="text-xs text-mutedForeground">two months free</span> : null}
                  </span>
                  <span className="font-mono">${entry.usd}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {offer.solana && offer.near ? (
            <div aria-label="Pay with" className="flex gap-2" role="radiogroup">
              {(["solana", "near"] as const).map((entry) => (
                <button
                  aria-checked={chain === entry}
                  className={cn(quietButtonClass, chain === entry && "border-foreground")}
                  key={entry}
                  onClick={() => setChain(entry)}
                  role="radio"
                  type="button"
                >
                  USDC on {entry === "solana" ? "Solana" : "NEAR"}
                </button>
              ))}
            </div>
          ) : null}

          {!paying ? (
            <div className="flex flex-wrap items-center gap-3">
              <button className={buttonClass} onClick={startPaying} type="button">
                Continue to payment
              </button>
              <span className="text-xs text-mutedForeground">Your wallet shows the amount and Svalin&apos;s address before you approve.</span>
            </div>
          ) : code ? (
            <div className="grid gap-5">
              <Step number={1} title="Save your Pro code first">
                <p className="text-sm leading-6 text-mutedForeground">
                  This code is your pass. It stays in this browser; copy it somewhere safe to use Pro on another device. Svalin cannot recover a lost
                  code.
                </p>
                <CodeBox code={code} />
              </Step>

              <Step number={2} title={`Pay ${chosen.usd} USDC`}>
                {chain === "solana" && offer.solana ? (
                  reference ? (
                    <SolanaPay
                      offer={offer.solana}
                      url={solanaPayUrl(offer.solana, chosen.usd, reference, `Svalin Pro, ${chosen.id === "year" ? "1 year" : "30 days"}`)}
                    />
                  ) : null
                ) : nearCheckout ? (
                  <NearPay checkout={nearCheckout} />
                ) : (
                  <div className="h-24 animate-pulse rounded-md border border-border" />
                )}
              </Step>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button className={quietButtonClass} disabled={checking} onClick={() => void check(code)} type="button">
                  {checking ? "Checking…" : "I've paid: check now"}
                </button>
                <span className="text-xs text-mutedForeground" role="status">
                  {pollUntil > 0
                    ? `Waiting for your payment${checkedAt ? `, last checked at ${new Date(checkedAt).toLocaleTimeString()}` : ""}.`
                    : "Stopped checking automatically. Use the button once you have paid."}
                </span>
                <button className={cn(linkClass, "text-xs")} onClick={() => setPaying(false)} type="button">
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {message ? <p className="text-sm text-riskHigh">{message}</p> : null}
          {!paying ? <HaveCode onCode={(entered) => void adoptCode(entered)} /> : null}
        </>
      )}
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <p className="text-sm font-medium">
        <span className="mr-2 font-mono text-subtleForeground">{number}</span>
        {title}
      </p>
      {children}
    </section>
  );
}

function SolanaPay({ offer, url }: { offer: NonNullable<ProOffer["solana"]>; url: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
      <QrCode className="w-48 max-w-full rounded-md border border-border" label="Solana Pay QR code for your Svalin Pro payment" value={url} />
      <div className="grid gap-2 text-sm leading-6">
        <p>Scan it with Phantom, Solflare or any Solana Pay wallet. It asks for USDC, not SOL.</p>
        <p className="text-mutedForeground">
          Before you approve, check the payee is Svalin: <span className="break-all font-mono text-foreground">{offer.payTo}</span>
        </p>
        <a className={cn(quietButtonClass, "w-fit !no-underline")} href={url}>
          Open in a wallet on this device
        </a>
      </div>
    </div>
  );
}

function NearPay({ checkout }: { checkout: NearCheckout }) {
  return (
    <div className="grid gap-3 text-sm leading-6">
      <p>From any NEAR wallet, send exactly this much USDC:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Copyable label="Amount (USDC)" value={checkout.amount} />
        <Copyable label="To" value={checkout.payTo} />
      </div>
      <p className="text-mutedForeground">
        The exact amount is how Svalin knows the payment is yours, so send it to the last digit. It is held for your code until{" "}
        {formatDay(checkout.expiresAt)}. Use native USDC (token <span className="font-mono">{checkout.token.slice(0, 8)}…</span>), not USDC.e.
      </p>
    </div>
  );
}

function ActivePass({
  status,
  code,
  days,
  onRenew,
  onRemove,
}: {
  status: KeyStatus;
  code: string | null;
  days: number | null;
  onRenew: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="eyebrow text-riskLow">Svalin Pro is active</p>
        <p className="text-lg font-medium">
          Until {formatDay(status.until!)}
          {days !== null && days <= 3 ? <span className="text-riskMedium">, ending in {days} day{days === 1 ? "" : "s"}</span> : null}
        </p>
        <p className="text-sm text-mutedForeground">
          {status.callsLeft} of today&apos;s calls left. Scans and checks on this site now use your pass.
        </p>
      </div>
      {code ? <CodeBox code={code} /> : null}
      <p className="text-sm leading-6 text-mutedForeground">
        On another device, open this page, choose &quot;I have a Pro code&quot; and paste it. Renewing with the same code adds its days after
        the current end.
      </p>
      <div className="flex flex-wrap gap-3">
        <button className={buttonClass} onClick={onRenew} type="button">
          Renew or extend
        </button>
        <button className={quietButtonClass} onClick={onRemove} type="button">
          Remove from this browser
        </button>
      </div>
    </div>
  );
}

function CodeBox({ code }: { code: string }) {
  return <Copyable label="Your Pro code" mono value={code} />;
}

function Copyable({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="grid gap-1">
      <span className="text-xs text-mutedForeground">{label}</span>
      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
        <span className={cn("min-w-0 flex-1 break-all text-sm", mono && "font-mono")}>{value}</span>
        <button aria-label={`Copy ${label.toLowerCase()}`} className="shrink-0 text-mutedForeground hover:text-foreground" onClick={() => void copy()} type="button">
          {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function HaveCode({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const entered = value.trim();
    if (!isProCode(entered)) {
      setError("That is not a Pro code. Pro codes start with svp_.");
      return;
    }
    setError(null);
    onCode(entered);
  }

  if (!open) {
    return (
      <button className={cn(linkClass, "w-fit text-sm")} onClick={() => setOpen(true)} type="button">
        I have a Pro code
      </button>
    );
  }
  return (
    <form className="grid gap-2" onSubmit={submit}>
      <label className="text-sm text-mutedForeground" htmlFor="pro-code">
        Paste your Pro code
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-borderStrong"
          id="pro-code"
          onChange={(event) => setValue(event.target.value)}
          placeholder="svp_…"
          spellCheck={false}
          value={value}
        />
        <button className={buttonClass} type="submit">
          Use this code
        </button>
      </div>
      {error ? <p className="text-sm text-riskHigh">{error}</p> : null}
    </form>
  );
}
