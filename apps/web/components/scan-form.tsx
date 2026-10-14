"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Returns the address to scan, or null when it is neither a Solana address nor a NEAR account. */
function normaliseAddress(input: string): string | null {
  const value = input.trim();
  if (SOLANA_ADDRESS.test(value)) return value;
  // NEAR account IDs are lowercase; accept "Alice.near" as "alice.near".
  const near = value.toLowerCase();
  return near.length >= 2 && near.length <= 64 && NEAR_ACCOUNT_ID.test(near) ? near : null;
}

export function ScanForm({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const address = normaliseAddress(value);
    if (!address) {
      setError("That doesn't look like a Solana wallet address or a NEAR account.");
      return;
    }
    setError(null);
    setPending(true);
    router.push(`/scan/${address}`);
  }

  return (
    <form className="w-full space-y-2" onSubmit={onSubmit}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="address">
          Solana wallet address or NEAR account
        </label>
        <input
          autoComplete="off"
          className="min-w-0 flex-1 rounded-full border border-border bg-background/70 px-5 py-3 font-mono text-sm outline-none placeholder:text-mutedForeground focus:border-primary"
          id="address"
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste a Solana address or a NEAR account (alice.near)"
          spellCheck={false}
          value={value}
        />
        <button
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primaryForeground transition hover:bg-primary/90 disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Scanning…" : "Free risk scan"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      {error ? <p className="pl-5 text-sm text-red-300">{error}</p> : null}
    </form>
  );
}
