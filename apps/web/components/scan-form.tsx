"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useProPass } from "@/components/pro-status";
import { isRunning } from "@/lib/pro";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const EXAMPLES = [
  { label: "root.near", address: "root.near" },
  { label: "7xKX…gAsU (Solana)", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
];

/** Returns the address to scan, or null when it is neither a Solana address nor a NEAR account. */
export function normaliseAddress(input: string): string | null {
  const value = input.trim();
  if (SOLANA_ADDRESS.test(value)) return value;
  // NEAR account IDs are lowercase; accept "Alice.near" as "alice.near".
  const near = value.toLowerCase();
  return near.length >= 2 && near.length <= 64 && NEAR_ACCOUNT_ID.test(near) ? near : null;
}

export function ScanForm({
  initialValue = "",
  showExamples = false,
  onValue,
}: {
  initialValue?: string;
  showExamples?: boolean;
  onValue?: (value: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pro = isRunning(useProPass().status);

  function scan(address: string) {
    setError(null);
    setPending(true);
    router.push(`/scan?address=${encodeURIComponent(address)}`);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const address = normaliseAddress(value);
    if (!address) {
      setError("That doesn’t look like a Solana wallet address or a NEAR account.");
      return;
    }
    scan(address);
  }

  return (
    <form className="grid w-full gap-3" onSubmit={onSubmit}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="address">
          Solana wallet address or NEAR account
        </label>
        <input
          autoCapitalize="off"
          autoComplete="off"
          className="field flex-1"
          id="address"
          onChange={(event) => {
            setValue(event.target.value);
            onValue?.(event.target.value);
          }}
          placeholder="alice.near or a Solana address"
          spellCheck={false}
          value={value}
        />
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Scanning…" : pro ? "Scan" : "Scan free"}
        </button>
      </div>
      {error ? <p className="text-sm text-riskHigh">{error}</p> : null}
      {showExamples ? (
        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-mutedForeground">
          Try
          {EXAMPLES.map((example) => (
            <button className="link text-foreground" disabled={pending} key={example.address} onClick={() => scan(example.address)} type="button">
              {example.label}
            </button>
          ))}
        </p>
      ) : null}
    </form>
  );
}
