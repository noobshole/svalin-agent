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
    return <div aria-busy="true" aria-label="Loading checkout" className="h-64 animate-pulse bg-surface2" />;
  }
  if (offer === null || (!offer.solana && !offer.near)) {
    return <p className="notice text-mutedForeground">The checkout cannot reach the Svalin API right now. Try again in a minute.</p>;
  }

  const chosen = offer.plans.find((entry) => entry.id === plan) ?? offer.plans[0]!;
  const active = isRunning(status);
  const testMode = (chain === "solana" ? offer.solana : offer.near)?.environment === "testnet";

  return (
    <div className="grid scroll-mt-8 gap-6 border-t-2 border-foreground pt-3" id="checkout">
      {active && status?.until && !paying ? (
        <ActivePass days={proDaysLeft(status)} onRenew={startPaying} onRemove={removePass} status={status} code={code} />
      ) : (
        <>
          <h2 className="title">{paying ? "Pay from your own wallet app" : "Choose your pass"}</h2>

          {testMode ? (
            <p className="text-sm text-riskMedium">
              Test mode: this checkout takes free test USDC on {chain === "solana" ? "Solana devnet" : "NEAR testnet"}. Real USDC opens soon, and a test pass stops working then.
            </p>
          ) : null}

          <fieldset className="border-b border-border">
            <legend className="sr-only">Pass</legend>
            {offer.plans.map((entry) => (
              <label className="line cursor-pointer" key={entry.id}>
                <span className="flex items-center gap-3">
                  <input checked={plan === entry.id} className="h-4 w-4 accent-current" name="plan" onChange={() => setPlan(entry.id)} type="radio" />
                  {entry.id === "year" ? "1 year" : "30 days"}
                  {entry.id === "year" ? <span className="text-sm text-mutedForeground">two months free</span> : null}
                </span>
                <span className="text-lg">${entry.usd}</span>
              </label>
            ))}
          </fieldset>

          {offer.solana && offer.near ? (
            <div aria-label="Pay with" className="grid grid-cols-2 gap-3" role="radiogroup">
              {(["solana", "near"] as const).map((entry) => (
                <button
                  aria-checked={chain === entry}
                  className={cn("btn-quiet", chain === entry && "bg-foreground text-background hover:bg-foreground")}
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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <button className="btn" onClick={startPaying} type="button">
                Continue to payment
              </button>
              <span className="min-w-0 flex-1 basis-56 text-sm text-mutedForeground">Your wallet shows the amount and Svalin’s address before you approve.</span>
            </div>
          ) : code ? (
            <div className="grid gap-8">
              <Step number={1} title="Save your Pro code first">
                <p className="text-mutedForeground">This code is your pass. It stays in this browser; copy it somewhere safe to use Pro on another device. Svalin cannot recover a lost code.</p>
                <CodeBox code={code} />
              </Step>

              <Step number={2} title={`Pay ${chosen.usd} USDC`}>
                {chain === "solana" && offer.solana ? (
                  reference ? (
                    <SolanaPay offer={offer.solana} url={solanaPayUrl(offer.solana, chosen.usd, reference, `Svalin Pro, ${chosen.id === "year" ? "1 year" : "30 days"}`)} />
                  ) : null
                ) : nearCheckout ? (
                  <NearPay checkout={nearCheckout} />
                ) : (
                  <div className="h-24 animate-pulse bg-surface2" />
                )}
              </Step>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <button className="btn-quiet" disabled={checking} onClick={() => void check(code)} type="button">
                  {checking ? "Checking…" : "I’ve paid: check now"}
                </button>
                <span className="min-w-0 flex-1 basis-56 text-mutedForeground" role="status">
                  {pollUntil > 0 ? `Waiting for your payment${checkedAt ? `, last checked at ${new Date(checkedAt).toLocaleTimeString()}` : ""}.` : "Stopped checking automatically. Use the button once you have paid."}
                </span>
                <button className="link" onClick={() => setPaying(false)} type="button">
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
      <h3 className="subtitle">
        <span className="dim mr-2">{number}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SolanaPay({ offer, url }: { offer: NonNullable<ProOffer["solana"]>; url: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
      <QrCode className="w-48 max-w-full" label="Solana Pay QR code for your Svalin Pro payment" value={url} />
      <div className="grid justify-items-start gap-3">
        <p>Scan it with Phantom, Solflare or any Solana Pay wallet. It asks for USDC, not SOL.</p>
        <p className="text-mutedForeground">
          Before you approve, check the payee is Svalin: <span className="break-all text-foreground">{offer.payTo}</span>
        </p>
        <a className="btn-quiet" href={url}>
          Open in a wallet on this device
        </a>
      </div>
    </div>
  );
}

function NearPay({ checkout }: { checkout: NearCheckout }) {
  return (
    <div className="grid gap-3">
      <p>From any NEAR wallet, send exactly this much USDC:</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Copyable label="Amount (USDC)" value={checkout.amount} />
        <Copyable label="To" value={checkout.payTo} />
      </div>
      <p className="text-mutedForeground">
        The exact amount is how Svalin knows the payment is yours, so send it to the last digit. It is held for your code until {formatDay(checkout.expiresAt)}. Use native USDC (token{" "}
        {checkout.token.slice(0, 8)}…), not USDC.e.
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
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h2 className="title text-riskLow">Svalin Pro is active</h2>
        <p className="text-lg">
          Until {formatDay(status.until!)}
          {days !== null && days <= 3 ? (
            <span className="text-riskMedium">
              , ending in {days} day{days === 1 ? "" : "s"}
            </span>
          ) : null}
        </p>
        <p className="text-mutedForeground">{status.callsLeft} of today’s calls left. Scans and checks on this site now use your pass.</p>
      </div>
      {code ? <CodeBox code={code} /> : null}
      <p className="text-mutedForeground">On another device, open this page, choose “I have a Pro code” and paste it. Renewing with the same code adds its days after the current end.</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button className="btn" onClick={onRenew} type="button">
          Renew or extend
        </button>
        <button className="link" onClick={onRemove} type="button">
          Remove from this browser
        </button>
      </div>
    </div>
  );
}

function CodeBox({ code }: { code: string }) {
  return <Copyable label="Your Pro code" value={code} />;
}

function Copyable({ label, value }: { label: string; value: string }) {
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
      <span className="text-sm text-mutedForeground">{label}</span>
      <div className="flex items-center gap-2 border-b-2 border-foreground pb-2">
        <span className="min-w-0 flex-1 break-all">{value}</span>
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
      <button className="link w-fit" onClick={() => setOpen(true)} type="button">
        I have a Pro code
      </button>
    );
  }
  return (
    <form className="grid gap-2" onSubmit={submit}>
      <label className="text-sm text-mutedForeground" htmlFor="pro-code">
        Paste your Pro code
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input autoComplete="off" className="field flex-1" id="pro-code" onChange={(event) => setValue(event.target.value)} placeholder="svp_…" spellCheck={false} value={value} />
        <button className="btn-quiet !min-h-[54px]" type="submit">
          Use this code
        </button>
      </div>
      {error ? <p className="text-sm text-riskHigh">{error}</p> : null}
    </form>
  );
}
