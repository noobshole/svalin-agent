import Link from "next/link";

import type { Usage } from "@/lib/api";
import { typeset } from "@/lib/utils/formatting";

/** "3 free scans left today", or a Pro code's calls left today, shown under a scan. */
export function FreeCallsLeft({ usage }: { usage: Partial<Usage> }) {
  if (usage.proLeft !== null && usage.proLeft !== undefined) {
    return (
      <p className="text-sm text-mutedForeground">
        Your Svalin Pro has {usage.proLeft} call{usage.proLeft === 1 ? "" : "s"} left today.{" "}
        <Link className="link text-foreground" href="/pricing">
          See your pass
        </Link>
      </p>
    );
  }
  const left = usage.freeLeft;
  if (left === null || left === undefined) return null;
  return (
    <p className="text-sm text-mutedForeground">
      {left === 0 ? "No free scans left today" : `${left} free scan${left === 1 ? "" : "s"} left today`}. They come back at midnight UTC, or{" "}
      <Link className="link text-foreground" href="/pricing">
        get 100 a day with Pro
      </Link>
      .
    </p>
  );
}

/** Shown instead of a result once the visitor has used today's free calls. */
export function FreeLimitReached({ message }: { message: string }) {
  return (
    <div className="notice">
      <p className="text-lg">{typeset(message)}</p>
      <p className="text-sm text-mutedForeground">
        <Link className="link text-foreground" href="/pricing">
          Svalin Pro
        </Link>{" "}
        gives you 100 calls a day and shows every next step, for $9 a month. Developers and agents can also{" "}
        <Link className="link text-foreground" href="/docs/paying">
          pay per call
        </Link>
        .
      </p>
    </div>
  );
}
