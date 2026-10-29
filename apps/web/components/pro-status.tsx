"use client";

import type { KeyStatus } from "@svalin-agent/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { proDaysLeft, storedProCode, storedProStatus } from "@/lib/pro";

/** This browser's Pro pass, read after the first render (the site is static, storage is not). */
export function useProPass(): { code: string | null; status: KeyStatus | null; ready: boolean } {
  const [pass, setPass] = useState<{ code: string | null; status: KeyStatus | null; ready: boolean }>({ code: null, status: null, ready: false });
  useEffect(() => {
    const read = () => setPass({ code: storedProCode(), status: storedProStatus(), ready: true });
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  return pass;
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Crypto has no automatic renewal, so Pro users are reminded 3 days before the end, and after it. */
export function ProReminder() {
  const { status } = useProPass();
  const days = proDaysLeft(status);
  if (!status?.until || days === null || days > 3 || days < -30) return null;
  return (
    <p className="rounded-lg border border-riskMedium/40 bg-surface px-4 py-3 text-sm">
      {days > 0
        ? `Your Svalin Pro ends on ${formatDay(status.until)}, in ${days} day${days === 1 ? "" : "s"}. `
        : `Your Svalin Pro ended on ${formatDay(status.until)}. `}
      <Link className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/pricing#checkout">
        Renew with the same code
      </Link>
    </p>
  );
}
