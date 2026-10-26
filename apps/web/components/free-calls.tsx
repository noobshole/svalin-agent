import Link from "next/link";

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

/** "3 free calls left today", shown under a free scan or check. */
export function FreeCallsLeft({ left }: { left: number | null | undefined }) {
  if (left === null || left === undefined) return null;
  return (
    <p className="font-mono text-xs text-subtleForeground">
      {left === 0 ? "No free calls left today" : `${left} free call${left === 1 ? "" : "s"} left today`} · they come back at 00:00 UTC ·{" "}
      <Link className={linkClass} href="/pro">
        Unlimited with Pro
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
        <Link className={linkClass} href="/pro">
          Svalin Pro
        </Link>{" "}
        gives unlimited scans and every next step for $5 a month. Developers and agents can{" "}
        <Link className={linkClass} href="/docs">
          pay per call
        </Link>{" "}
        instead.
      </p>
    </div>
  );
}
