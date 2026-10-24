import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/** The frame shared by About, Docs and the Whitepaper: a heading block and one readable column. */
export function DocPage({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-14 md:px-8">
      <div className="mx-auto grid w-full max-w-3xl gap-0">
        <header className="grid gap-4 border-b border-border pb-10">
          <p className="font-mono text-xs text-mutedForeground">{eyebrow}</p>
          <h1 className="text-3xl font-medium leading-tight tracking-tight md:text-4xl" style={{ textWrap: "balance" }}>
            {title}
          </h1>
          {lede ? <p className="max-w-2xl text-base leading-7 text-mutedForeground">{lede}</p> : null}
        </header>
        <article className="doc">{children}</article>
      </div>
    </main>
  );
}

/** "Live", "Planned" or "Research": where a part of Svalin stands today. */
export function Status({ kind }: { kind: "live" | "planned" | "research" }) {
  const label = { live: "Live", planned: "Planned", research: "Research" }[kind];
  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-wider",
        kind === "live" && "border-riskLow/40 text-riskLow",
        kind === "planned" && "border-riskMedium/40 text-riskMedium",
        kind === "research" && "border-border text-subtleForeground",
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
