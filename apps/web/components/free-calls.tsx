import Link from "next/link";

import type { Usage } from "@/lib/api";

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

/** "3 free calls left today", or a Pro code's calls left today, shown under a scan or check. */
export function FreeCallsLeft({ usage }: { usage: Partial<Usage> }) {
  if (usage.proLeft !== null && usage.proLeft !== undefined) {
    return (
      <p className="text-sm text-mutedForeground">
        Svalin Pro: {usage.proLeft} call{usage.proLeft === 1 ? "" : "s"} left today.{" "}
        <Link className={linkClass} href="/pricing">
          Your pass
        </Link>
      </p>
    );
  }
  const left = usage.freeLeft;
  if (left === null || left === undefined) return null;
  return (
    <p className="text-sm text-mutedForeground">
      {left === 0 ? "No free calls left today" : `${left} free call${left === 1 ? "" : "s"} left today`}, reset at midnight UTC.{" "}
      <Link className={linkClass} href="/pricing">
        No limit with Pro
      </Link>
    </p>
  );
}

/** Shown instead of a result once the visitor has used today's free calls. */
export function FreeLimitReached({ message }: { message: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface p-6">
      <p className="font-medium">{message}</p>
      <p className="text-sm leading-6 text-mutedForeground">
        <Link className={linkClass} href="/pricing">
          Svalin Pro
        </Link>{" "}
        gives 100 calls a day and every next step for $5 a month. Developers and agents can{" "}
        <Link className={linkClass} href="/docs">
          pay per call
        </Link>{" "}
        instead.
      </p>
    </div>
  );
}
