"use client";

import {
  CONCENTRATION_FLAG_PCT,
  nearTokenIndexSchema,
  saleLoss,
  type NearTokenIndex,
  type RatedTokenRow,
  type TokenGrade,
} from "@svalin-agent/shared";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils/cn";
import { formatCompactUsd, formatPrice } from "@/lib/utils/formatting";

export const gradeTone: Record<TokenGrade, string> = {
  A: "text-riskLow",
  B: "text-riskLow",
  C: "text-riskMedium",
  D: "text-riskHigh",
  F: "text-riskHigh",
};

const GRADES: TokenGrade[] = ["A", "B", "C", "D", "F"];
const FILTERS: ("All" | TokenGrade)[] = ["All", ...GRADES];
const PAGE = 50;
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_3rem_6.5rem_6.5rem_6.5rem_5.5rem_5rem_5.5rem]";

/**
 * The latest Svalin Index edition, loaded from the API: the summary, then `story`, then the table.
 * The edition is rebuilt every few hours, so the page is static and the numbers are current.
 */
export function TokenIndex({ story }: { story: ReactNode }) {
  const [index, setIndex] = useState<NearTokenIndex | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/v1/index/near-tokens`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`index ${response.status}`);
        return response.json();
      })
      .then((body) => setIndex(nearTokenIndexSchema.parse(body)))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return <p className="rounded-lg border border-border bg-surface px-5 py-8 text-sm text-mutedForeground">The index could not be loaded. Refresh to try again.</p>;
  }
  if (!index) {
    return (
      <div className="grid gap-12" aria-busy="true">
        <div className="h-28 animate-pulse rounded-lg border border-border bg-surface" />
        {story}
        <div className="h-96 animate-pulse rounded-lg border border-border bg-surface" />
      </div>
    );
  }
  return (
    <div className="grid gap-12">
      <Summary index={index} />
      <div className="grid gap-6 md:grid-cols-2">
        {story}
        <LoudestClaim rows={index.rows} />
      </div>
      <section className="grid gap-5">
        <div className="grid gap-2">
          <h2 className="text-2xl font-medium tracking-tight">All graded tokens</h2>
          <p className="text-sm text-mutedForeground">
            Sorted by real backing. Market cap is the quoted price times total supply. A flagged top-10 share means ten wallets outside pools,
            bridges and NEAR Intents hold {CONCENTRATION_FLAG_PCT}% or more.
          </p>
        </div>
        <TokenTable rows={index.rows} />
      </section>
    </div>
  );
}

function Summary({ index }: { index: NearTokenIndex }) {
  const total = index.rows.length;
  const noBacking = index.rows.filter((row) => row[3] === 0).length;
  const edition = new Date(index.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const stats = [
    { label: "NEAR tokens graded", value: total.toLocaleString("en-US"), sub: "every token Ref Finance prices" },
    { label: "Grade F", value: `${Math.round((index.counts.F / total) * 100)}%`, sub: `${index.counts.F.toLocaleString("en-US")} tokens under $3K of real backing` },
    { label: "No real money at all", value: noBacking.toLocaleString("en-US"), sub: "a quoted price nobody can sell at" },
    {
      label: "Grade C or better",
      value: (index.counts.A + index.counts.B + index.counts.C).toLocaleString("en-US"),
      sub: "a $1,000 sale loses under 5%",
    },
  ];

  const provenance = index.provenance;

  return (
    <section className="grid gap-4">
      <div className="flex flex-col gap-1 font-mono text-xs text-mutedForeground sm:flex-row sm:flex-wrap sm:gap-x-4">
        <span>
          edition {edition} UTC ({ageLabel(index.generatedAt)}) · rebuilt every few hours
        </span>
        {provenance ? (
          <span>
            inputs pinned {provenance.inputs.pricesSha256.slice(0, 8)} · {provenance.inputs.poolsSha256.slice(0, 8)} · code{" "}
            {provenance.code.commit.slice(0, 7)} ·{" "}
            <a
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              href="https://github.com/noobshole/svalin-index#dont-trust-it-verify-it"
              rel="noreferrer"
              target="_blank"
            >
              verify it yourself
            </a>
          </span>
        ) : null}
      </div>
      <div className="grid overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, position) => (
          <div
            className={cn(
              "grid gap-1 p-5",
              position > 0 && "border-t border-border sm:border-t-0",
              position % 2 === 1 && "sm:border-l",
              position >= 2 && "sm:border-t lg:border-t-0",
              position > 0 && "lg:border-l",
            )}
            key={stat.label}
          >
            <p className="text-xs text-mutedForeground">{stat.label}</p>
            <p className="font-mono text-3xl tracking-tight">{stat.value}</p>
            <p className="text-xs text-subtleForeground">{stat.sub}</p>
          </div>
        ))}
      </div>
      <div className="flex h-3 gap-px overflow-hidden rounded-full bg-surface2" role="img" aria-label="Share of tokens per grade">
        {GRADES.map((grade) =>
          index.counts[grade] > 0 ? (
            <div
              className={cn(grade === "A" || grade === "B" ? "bg-riskLow" : grade === "C" ? "bg-riskMedium" : "bg-riskHigh", grade === "D" && "opacity-60")}
              key={grade}
              style={{ width: `${Math.max((index.counts[grade] / total) * 100, 0.6)}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-mutedForeground">
        {GRADES.map((grade) => (
          <span key={grade}>
            <span className={gradeTone[grade]}>{grade}</span> {index.counts[grade].toLocaleString("en-US")}
          </span>
        ))}
      </div>
    </section>
  );
}

/** The token whose quoted price implies the largest market cap with no real money behind it. */
function LoudestClaim({ rows }: { rows: RatedTokenRow[] }) {
  const claim = rows.filter((row) => row[3] === 0 && row[5] !== null).sort((left, right) => (right[5] ?? 0) - (left[5] ?? 0))[0];
  if (!claim) return null;
  return (
    <div className="grid content-start gap-3 rounded-lg border border-border bg-surface p-6">
      <p className="font-mono text-xs text-mutedForeground">loudest claim in this edition</p>
      <p className="truncate font-mono text-sm">{claim[0]}</p>
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-mutedForeground">Claimed market cap</dt>
          <dd className="font-mono text-2xl">{formatCompactUsd(claim[5] ?? 0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-mutedForeground">Real backing</dt>
          <dd className="font-mono text-2xl">none</dd>
        </div>
      </dl>
      <p className="text-xs text-subtleForeground">Quoted at {formatPrice(claim[2])} per token. Grade F: nobody can sell it at that price.</p>
    </div>
  );
}

function TokenTable({ rows }: { rows: RatedTokenRow[] }) {
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<"All" | TokenGrade>("All");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      ([contract, symbol, , , rowGrade]) =>
        (grade === "All" || rowGrade === grade) && (!needle || symbol.toLowerCase().includes(needle) || contract.includes(needle)),
    );
  }, [rows, query, grade]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-borderStrong sm:max-w-sm">
          <Search aria-hidden="true" className="h-4 w-4 text-subtleForeground" />
          <input
            aria-label="Search tokens"
            className="w-full bg-transparent text-sm placeholder:text-subtleForeground focus-visible:outline-none"
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE);
            }}
            placeholder="Search a token or contract"
            value={query}
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by grade">
          {FILTERS.map((option) => (
            <button
              aria-pressed={grade === option}
              className={cn(
                "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                grade === option ? "bg-primary text-primaryForeground" : "text-mutedForeground hover:text-foreground",
              )}
              key={option}
              onClick={() => {
                setGrade(option);
                setShown(PAGE);
              }}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className={cn("hidden gap-4 border-b border-border px-5 py-2.5 font-mono text-xs text-subtleForeground md:grid", COLUMNS)}>
          <span>Token</span>
          <span>Grade</span>
          <span className="text-right">Price</span>
          <span className="text-right">Market cap</span>
          <span className="text-right">Real backing</span>
          <span className="text-right">Top 10 own</span>
          <span className="text-right">Holders</span>
          <span className="text-right">$1k sale loses</span>
        </div>

        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-sm text-mutedForeground">No token matches that search.</p>
        ) : (
          filtered.slice(0, shown).map(([contract, symbol, priceUsd, backingUsd, rowGrade, marketCap, top10, holders], position) => (
            <div
              className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3 md:items-center", COLUMNS, position > 0 && "border-t border-border")}
              key={contract}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{symbol}</p>
                <p className="truncate font-mono text-xs text-subtleForeground">{contract}</p>
              </div>
              <span className={cn("font-mono text-lg font-medium md:text-base", gradeTone[rowGrade])}>{rowGrade}</span>
              <Cell label="Price" value={formatPrice(priceUsd)} />
              <Cell label="Market cap" value={marketCap === null ? "—" : formatCompactUsd(marketCap)} />
              <Cell label="Real backing" value={backingUsd > 0 ? formatCompactUsd(backingUsd) : "none"} />
              <Cell
                flagged={top10 !== null && top10 >= CONCENTRATION_FLAG_PCT}
                label="Top 10 own"
                value={top10 === null ? "—" : `${top10.toFixed(top10 < 10 ? 1 : 0)}%`}
              />
              <Cell label="Holders" value={holders === null ? "—" : holders.toLocaleString("en-US")} />
              <Cell label="$1k sale loses" value={backingUsd > 0 ? lossLabel(saleLoss(backingUsd)) : "can't sell"} />
            </div>
          ))
        )}
      </div>

      {filtered.length > shown ? (
        <button
          className="justify-self-center rounded-full border border-border px-4 py-2 text-sm text-mutedForeground transition-colors hover:text-foreground"
          onClick={() => setShown((count) => count + PAGE)}
          type="button"
        >
          Show more ({(filtered.length - shown).toLocaleString("en-US")} left)
        </button>
      ) : null}
    </div>
  );
}

function Cell({ label, value, flagged = false }: { label: string; value: string; flagged?: boolean }) {
  return (
    <p className={cn("col-span-2 flex justify-between font-mono text-sm md:col-span-1 md:block md:text-right", flagged && "text-riskMedium")}>
      <span className="text-xs text-subtleForeground md:hidden">{label}</span>
      <span title={flagged ? `Ten wallets hold ${CONCENTRATION_FLAG_PCT}% or more of the supply` : undefined}>
        {value}
        {flagged ? " ⚑" : ""}
      </span>
    </p>
  );
}

/** "12 minutes ago", "3 hours ago": how old the edition is, so a stale one is obvious. */
function ageLabel(generatedAt: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function lossLabel(loss: number) {
  const pct = loss * 100;
  return pct < 0.1 ? "<0.1%" : `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}
