import Link from "next/link";
import type { ReactNode } from "react";

import { DocContents } from "@/components/doc-contents";
import { DOC_GROUPS, docPlace } from "@/lib/docs-nav";
import { cn } from "@/lib/utils/cn";

type Contents = [id: string, label: string][];

/** The list of docs pages. The open page's sections drop down under it. */
function DocList({ path, contents }: { path: string; contents: Contents }) {
  return (
    <nav aria-label="Docs" className="grid gap-5">
      {DOC_GROUPS.map((group) => (
        <div key={group.name}>
          <p className="docs__label">{group.name}</p>
          <ul className="docs__links">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link aria-current={link.href === path ? "page" : undefined} href={link.href}>
                  {link.label}
                </Link>
                {link.href === path ? <DocContents contents={contents} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The frame every docs page shares, built the way the big Solana projects build theirs: the list of pages on
 * the left, and one reading column with each heading above its text.
 */
export function DocPage({
  path,
  title,
  lede,
  note,
  contents,
  children,
}: {
  /** This page's address, as listed in lib/docs-nav.ts. */
  path: string;
  title: ReactNode;
  lede?: ReactNode;
  note?: string;
  contents: Contents;
  children: ReactNode;
}) {
  const { group, previous, next } = docPlace(path);
  return (
    <main className="page main">
      <div className="docs">
        <aside className="docs__side">
          <DocList contents={contents} path={path} />
        </aside>
        <div className="docs__main">
          <details className="docs__menu" key={path}>
            <summary>All docs pages</summary>
            <div className="pt-5">
              <DocList contents={contents} path={path} />
            </div>
          </details>
          <header className="grid gap-3">
            {group ? <p className="dim">{group}</p> : null}
            <h1 className="docs__title">{title}</h1>
            {lede ? <p className="docs__lede">{lede}</p> : null}
            {note ? <p className="text-sm text-mutedForeground">{note}</p> : null}
          </header>
          <article className="doc">{children}</article>
          <nav aria-label="Previous and next page" className="mt-14 grid grid-cols-2 gap-6 border-t border-border pt-6">
            {previous ? (
              <Link className="grid justify-items-start gap-0.5" href={previous.href}>
                <span className="text-sm text-mutedForeground">Previous</span>
                <span className="hover:underline hover:underline-offset-4">{previous.label}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link className="grid justify-items-end gap-0.5 text-right" href={next.href}>
                <span className="text-sm text-mutedForeground">Next</span>
                <span className="hover:underline hover:underline-offset-4">{next.label}</span>
              </Link>
            ) : null}
          </nav>
        </div>
      </div>
    </main>
  );
}

/** Where a part of Svalin stands today. */
export function Status({ kind }: { kind: "live" | "testnet" | "planned" | "research" }) {
  const label = { live: "Live", testnet: "On testnet", planned: "Planned", research: "Research" }[kind];
  return (
    <span className={cn("ml-2 text-sm font-normal tracking-normal", kind === "live" && "text-riskLow", (kind === "testnet" || kind === "planned") && "text-riskMedium", kind === "research" && "text-mutedForeground")}>
      {label}
    </span>
  );
}
