"use client";

import {
  CONCENTRATION_FLAG_PCT,
  EXIT_SALE_SIZES_USD,
  largestSale,
  nearTokenIndexSchema,
  saleLoss,
  saleProceeds,
  type NearTokenIndex,
  type RatedTokenRow,
  type TokenGrade,
} from "@svalin-agent/shared";
import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { summaryReset } from "@/components/site-nav";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils/cn";
import { formatCompactUsd, formatPrice, formatUsd } from "@/lib/utils/formatting";

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
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_3rem_6.5rem_6.5rem_6.5rem_5.5rem_5rem_7rem]";

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
            bridges and NEAR Intents hold {CONCENTRATION_FLAG_PCT}% or more. Open a token to see its exit prices: what selling it would actually
            fetch.
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
          Edition {edition} UTC ({ageLabel(index.generatedAt)}) · rebuilt every few hours
        </span>
        {provenance ? (
          <span>
            Every edition is saved with the data behind it ·{" "}
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
      <p className="eyebrow">Loudest claim in this edition</p>
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
  // Rendered only in the browser, once the edition has loaded, so the URL can be read directly.
  // The scanner links here with ?q=<contract> when someone scans a token instead of a wallet.
  const [linked] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [query, setQuery] = useState(linked);
  const [grade, setGrade] = useState<"All" | TokenGrade>("All");
  const [shown, setShown] = useState(PAGE);
  const table = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("q")) table.current?.scrollIntoView({ block: "start" });
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      ([contract, symbol, , , rowGrade]) =>
        (grade === "All" || rowGrade === grade) && (!needle || symbol.toLowerCase().includes(needle) || contract.includes(needle)),
    );
  }, [rows, query, grade]);

  return (
    <div className="grid scroll-mt-24 gap-4" ref={table}>
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
          <span className="text-right">$10K sale fetches</span>
        </div>

        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-sm text-mutedForeground">No token matches that search.</p>
        ) : (
          filtered.slice(0, shown).map((row, position) => {
            const [contract, symbol, priceUsd, backingUsd, rowGrade, marketCap, top10, holders] = row;
            // A scanned token arrives with ?q=<contract> and opens on its exit prices.
            return (
              <details className={cn("group", position > 0 && "border-t border-border")} key={contract} open={contract === linked}>
                <summary
                  className={cn(
                    summaryReset,
                    "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-surface2/40 md:items-center",
                    COLUMNS,
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{symbol}</span>
                      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-subtleForeground transition-transform group-open:rotate-180" />
                    </p>
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
                  {/* Zero means the count could not be read (bridged tokens, for one), not that nobody holds it. */}
                  <Cell label="Holders" value={!holders ? "—" : holders.toLocaleString("en-US")} />
                  <Cell label="$10K sale fetches" value={backingUsd > 0 ? formatUsd(saleProceeds(backingUsd, 10_000)) : "nothing"} />
                </summary>
                <ExitPanel row={row} />
              </details>
            );
          })
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

/**
 * A token's exit prices: what selling it would actually fetch, how much can be sold near the
 * quoted price, and what the whole supply could fetch. The same numbers the API returns.
 */
function ExitPanel({ row }: { row: RatedTokenRow }) {
  const [contract, , priceUsd, backingUsd, , marketCap] = row;
  const backed = backingUsd > 0;
  const wholeSupply = !backed ? 0 : marketCap === null ? null : saleProceeds(backingUsd, marketCap);
  const capacity = [
    { label: "Sells within 1% of the price", value: backed ? `up to ${formatCompactUsd(largestSale(backingUsd, 0.01))}` : "nothing" },
    { label: "Sells within 5% of the price", value: backed ? `up to ${formatCompactUsd(largestSale(backingUsd, 0.05))}` : "nothing" },
    {
      label: "The whole supply would fetch",
      value: wholeSupply === null ? "—" : wholeSupply === 0 ? "nothing" : `at most ${formatCompactUsd(wholeSupply)}`,
      sub: marketCap !== null && wholeSupply !== null ? `of a ${formatCompactUsd(marketCap)} market cap` : undefined,
    },
  ];

  return (
    <div className="grid gap-4 border-t border-border px-5 py-4">
      <p className="eyebrow">Exit prices</p>
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
        {EXIT_SALE_SIZES_USD.map((saleUsd) => {
          const loss = saleLoss(backingUsd, saleUsd);
          return (
            <div className="grid content-start gap-0.5 bg-surface p-3" key={saleUsd}>
              <p className="text-xs text-mutedForeground">Selling {formatCompactUsd(saleUsd)} fetches</p>
              <p className="font-mono text-lg tracking-tight">{backed ? formatUsd(saleProceeds(backingUsd, saleUsd)) : "nothing"}</p>
              <p className="font-mono text-xs text-subtleForeground">
                {backed ? `−${lossLabel(loss)} · ${formatPrice(priceUsd * (1 - loss))} a token` : "no real money in its pools"}
              </p>
            </div>
          );
        })}
      </div>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
        {capacity.map((item) => (
          <div className="grid content-start gap-0.5" key={item.label}>
            <dt className="text-xs text-mutedForeground">{item.label}</dt>
            <dd className="font-mono text-sm">{item.value}</dd>
            {item.sub ? <dd className="font-mono text-xs text-subtleForeground">{item.sub}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="text-xs leading-5 text-subtleForeground">
        Estimated from the real money held for 24 hours in its Ref Finance pools. Real fills depend on routing, and a token that also trades outside
        NEAR could fetch more there.{" "}
        <Link className="text-mutedForeground underline decoration-border underline-offset-4 hover:text-foreground" href="/docs">
          Use it in your app
        </Link>
      </p>
    </div>
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
