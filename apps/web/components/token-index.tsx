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
  type TokenNote,
} from "@svalin-agent/shared";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useProPass } from "@/components/pro-status";
import { IndexDisc } from "@/components/seal";
import { API_BASE_URL } from "@/lib/api";
import { isRunning } from "@/lib/pro";
import { INDEX_COUNTS_FALLBACK, indexCounts } from "@/lib/seal";
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
/** The table's columns: the heading row and every token row share this one definition. */
const COLUMNS = "lg:grid-cols-[minmax(0,1fr)_3.5rem_6rem_8.5rem_6rem_5rem_5.5rem_7.5rem]";

type Notes = Record<string, TokenNote>;
type Edition = Pick<NearTokenIndex, "generatedAt" | "methodology">;

/** "4 Nov 2026, 01:20": when an edition was built, in UTC. */
function editionTime(generatedAt: string) {
  return new Date(generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

/**
 * The latest Svalin Index edition, loaded from the API. The page gives the opening words and the story;
 * this draws every token as a dot and adds the summary and the table.
 * The edition is rebuilt every few hours, so the page is static and the numbers are current.
 */
export function TokenIndex({ intro, story }: { intro: ReactNode; story: ReactNode }) {
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

  return (
    <div className="grid gap-16 lg:gap-24">
      <section className="grid4 items-center">
        <div className="grid content-start gap-6 lg:col-span-2">
          {intro}
          {index ? (
            <EditionLine index={index} />
          ) : (
            <p className="text-sm text-mutedForeground">{failed ? "The index could not be loaded. Refresh to try again." : "Loading the latest edition…"}</p>
          )}
        </div>
        <div className="w-full max-w-[min(100%,58vh)] lg:col-span-2 lg:justify-self-end">
          <IndexDisc counts={index ? indexCounts(index.counts) : INDEX_COUNTS_FALLBACK} />
        </div>
      </section>

      {index ? (
        <>
          <Summary index={index} />
          <section className="grid4">
            {story}
            <LoudestClaim rows={index.rows} />
          </section>
          <section className="grid gap-6">
            <div className="grid gap-3">
              <h2 className="title">All graded tokens</h2>
              <p className="max-w-[50em] text-mutedForeground">
                Sorted by real backing. Market cap is the quoted price times total supply. An amber top-10 share means ten wallets outside pools, bridges and NEAR Intents hold{" "}
                {CONCENTRATION_FLAG_PCT}% or more. Open a token to see its exit prices: what selling it would actually fetch.
              </p>
            </div>
            <TokenTable edition={index} notes={index.notes ?? {}} rows={index.rows} />
          </section>
        </>
      ) : (
        <section className="grid4">{story}</section>
      )}
    </div>
  );
}

function EditionLine({ index }: { index: NearTokenIndex }) {
  return (
    <p className="text-sm text-mutedForeground">
      Edition of {editionTime(index.generatedAt)} UTC, {ageLabel(index.generatedAt)}, method <span className="font-mono text-xs">{index.methodology}</span>. A new one comes every few hours.
      {index.provenance ? (
        <>
          {" "}
          Each edition is saved with the data behind it, so you can{" "}
          <a className="link text-foreground" href="https://github.com/noobshole/svalin-index#dont-trust-it-verify-it" rel="noreferrer" target="_blank">
            check it yourself
          </a>
          .
        </>
      ) : null}
    </p>
  );
}

function Summary({ index }: { index: NearTokenIndex }) {
  const total = index.rows.length;
  const noBacking = index.rows.filter((row) => row[3] === 0).length;
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

  return (
    <section className="grid gap-6">
      <dl className="grid grid-cols-2 gap-x-[var(--gap)] gap-y-1 lg:grid-cols-4">
        {stats.map((stat) => (
          <div className="row-span-3 grid grid-rows-subgrid border-t-2 border-foreground pt-3" key={stat.label}>
            <dt>{stat.label}</dt>
            <dd className="title">{stat.value}</dd>
            <dd className="pb-5 text-sm text-mutedForeground lg:pb-0">{stat.sub}</dd>
          </div>
        ))}
      </dl>
      <p className="flex flex-wrap gap-x-8 gap-y-1">
        {GRADES.map((grade) => (
          <span key={grade}>
            <span className={gradeTone[grade]}>{grade}</span> {index.counts[grade].toLocaleString("en-US")}
          </span>
        ))}
      </p>
    </section>
  );
}

/** The token whose quoted price implies the largest market cap with no real money behind it. */
function LoudestClaim({ rows }: { rows: RatedTokenRow[] }) {
  const claim = rows.filter((row) => row[3] === 0 && row[5] !== null).sort((left, right) => (right[5] ?? 0) - (left[5] ?? 0))[0];
  if (!claim) return null;
  return (
    <div className="grid content-start gap-4 lg:col-span-2">
      <h2 className="title">The loudest claim in this edition</h2>
      <p className="break-all">{claim[0]}</p>
      <dl className="border-b border-border">
        <div className="line">
          <dt className="text-mutedForeground">Claimed market cap</dt>
          <dd className="text-lg">{formatCompactUsd(claim[5] ?? 0)}</dd>
        </div>
        <div className="line">
          <dt className="text-mutedForeground">Real backing</dt>
          <dd className="text-lg">none</dd>
        </div>
      </dl>
      <p className="text-sm text-mutedForeground">Quoted at {formatPrice(claim[2])} per token. Grade F: nobody can sell it at that price.</p>
    </div>
  );
}

function TokenTable({ rows, notes, edition }: { rows: RatedTokenRow[]; notes: Notes; edition: Edition }) {
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
    <div className="grid scroll-mt-8 gap-6" ref={table}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <input
          aria-label="Search tokens"
          className="field sm:max-w-md"
          onChange={(event) => {
            setQuery(event.target.value);
            setShown(PAGE);
          }}
          placeholder="Search a token or contract"
          value={query}
        />
        <div aria-label="Filter by grade" className="flex items-center gap-x-5 pb-2" role="group">
          {FILTERS.map((option) => (
            <button
              aria-pressed={grade === option}
              className={cn(grade === option ? "underline underline-offset-4" : "text-mutedForeground hover:text-foreground")}
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

      <div className="border-b border-border tabular-nums">
        <div className={cn("hidden gap-x-4 border-b-2 border-foreground pb-2 text-sm lg:grid", COLUMNS)}>
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
          <p className="py-8 text-mutedForeground">No token matches that search.</p>
        ) : (
          filtered.slice(0, shown).map((row, position) => {
            const [contract, symbol, priceUsd, backingUsd, rowGrade, marketCap, top10, holders] = row;
            const note = notes[contract];
            const flagged = top10 !== null && top10 >= CONCENTRATION_FLAG_PCT;
            // A scanned token arrives with ?q=<contract> and opens on its exit prices.
            return (
              <details className={cn("group", position > 0 && "border-t border-border")} key={contract} open={contract === linked}>
                <summary className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-3 lg:items-center", COLUMNS)}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate">{symbol}</span>
                      {note?.selfDeclaredTest ? (
                        <span className="shrink-0 text-sm text-riskMedium" title={note.name ? `Its on-chain name: ${note.name}` : "Its own name says it is a test"}>
                          Test token
                        </span>
                      ) : null}
                      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-subtleForeground transition-transform group-open:rotate-180" />
                    </p>
                    <p className="truncate text-xs text-mutedForeground">{contract}</p>
                  </div>
                  <span className={cn("text-lg lg:text-base", gradeTone[rowGrade])}>{rowGrade}</span>
                  <Cell label="Price" value={formatPrice(priceUsd)} />
                  <Cell label="Market cap" more value={marketCap === null ? "—" : formatCompactUsd(marketCap)} />
                  <Cell label="Real backing" value={backingUsd > 0 ? formatCompactUsd(backingUsd) : "none"} />
                  <Cell flagged={flagged} label="Top 10 own" more value={top10 === null ? "—" : `${top10.toFixed(top10 < 10 ? 1 : 0)}%`} />
                  {/* Editions before 4 Nov 2026 record 0 when the count could not be read: unknown, not nobody. */}
                  <Cell label="Holders" more value={!holders ? "—" : `${holders.toLocaleString("en-US")}${note?.holdersAtLeast ? "+" : ""}`} />
                  <Cell label="$10K sale fetches" more value={backingUsd > 0 ? formatUsd(saleProceeds(backingUsd, 10_000)) : "nothing"} />
                </summary>
                <ExitPanel edition={edition} note={note} row={row} />
              </details>
            );
          })
        )}
      </div>

      {filtered.length > shown ? (
        <button className="link justify-self-start" onClick={() => setShown((count) => count + PAGE)} type="button">
          Show more ({(filtered.length - shown).toLocaleString("en-US")} left)
        </button>
      ) : null}
    </div>
  );
}

/** One figure in a token's row. On a phone, `more` figures move into the opened row to keep the list short. */
function Cell({ label, value, flagged = false, more = false }: { label: string; value: string; flagged?: boolean; more?: boolean }) {
  return (
    <p className={cn("col-span-2 justify-between whitespace-nowrap text-sm lg:col-span-1 lg:block lg:text-right", more ? "hidden" : "flex", flagged && "text-riskMedium")}>
      <span className="text-mutedForeground lg:hidden">{label}</span>
      <span title={flagged ? `Ten wallets hold ${CONCENTRATION_FLAG_PCT}% or more of the supply` : undefined}>
        {value}
        {flagged ? <span className="sr-only"> (flagged)</span> : null}
      </span>
    </p>
  );
}

/**
 * A token's exit prices: what selling it would actually fetch, how much can be sold near the
 * quoted price, and what the whole supply could fetch. The same numbers the API returns.
 */
function ExitPanel({ row, note, edition }: { row: RatedTokenRow; note: TokenNote | undefined; edition: Edition }) {
  const [, , priceUsd, backingUsd, grade, marketCap, top10, holders] = row;
  const pro = isRunning(useProPass().status);
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
    <div className="grid gap-5 border-t border-border pb-8 pt-4">
      <p className="max-w-[50em] text-sm text-mutedForeground">
        Liquidity grade <span className={gradeTone[grade]}>{grade}</span> in the edition of {editionTime(edition.generatedAt)} UTC (<span className="font-mono text-xs">{edition.methodology}</span>). It measures how much a sale
        would lose, not whether the project is good.
      </p>
      {note?.selfDeclaredTest ? (
        <p className="max-w-[50em] text-sm text-riskMedium">
          Its own on-chain name{note.name ? <> is “{note.name}”</> : " says it is a test"}. Test tokens often trade under a real project’s ticker; check the contract address.
        </p>
      ) : null}
      <dl className="border-b border-border lg:hidden">
        <div className="line">
          <dt className="text-mutedForeground">Market cap</dt>
          <dd>{marketCap === null ? "—" : formatCompactUsd(marketCap)}</dd>
        </div>
        <div className="line">
          <dt className="text-mutedForeground">Top 10 own</dt>
          <dd className={top10 !== null && top10 >= CONCENTRATION_FLAG_PCT ? "text-riskMedium" : undefined}>{top10 === null ? "—" : `${top10.toFixed(top10 < 10 ? 1 : 0)}%`}</dd>
        </div>
        <div className="line">
          <dt className="text-mutedForeground">Holders</dt>
          <dd>{!holders ? "—" : `${holders.toLocaleString("en-US")}${note?.holdersAtLeast ? "+" : ""}`}</dd>
        </div>
      </dl>
      <h3 className="subtitle">Exit prices</h3>
      <div className="grid gap-x-[var(--gap)] gap-y-4 sm:grid-cols-3">
        {EXIT_SALE_SIZES_USD.map((saleUsd) => {
          const loss = saleLoss(backingUsd, saleUsd);
          return (
            <div className="grid content-start gap-0.5 border-t border-foreground pt-2" key={saleUsd}>
              <p className="text-sm text-mutedForeground">Selling {formatCompactUsd(saleUsd)} fetches</p>
              <p className="text-lg">{backed ? formatUsd(saleProceeds(backingUsd, saleUsd)) : "nothing"}</p>
              <p className="text-sm text-mutedForeground">{backed ? `${lossLabel(loss)} below the price, ${formatPrice(priceUsd * (1 - loss))} a token` : "no real money in its pools"}</p>
            </div>
          );
        })}
      </div>
      {pro && backed ? <OwnSaleSize backingUsd={backingUsd} priceUsd={priceUsd} /> : null}
      <dl className="grid gap-x-[var(--gap)] gap-y-4 sm:grid-cols-3">
        {capacity.map((item) => (
          <div className="grid content-start gap-0.5 border-t border-border pt-2" key={item.label}>
            <dt className="text-sm text-mutedForeground">{item.label}</dt>
            <dd>{item.value}</dd>
            {item.sub ? <dd className="text-sm text-mutedForeground">{item.sub}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="max-w-[50em] text-sm text-mutedForeground">
        Estimated from the real money held for 24 hours in its Ref Finance pools. Real fills depend on routing, and a token that also trades outside NEAR could fetch more there.{" "}
        <Link className="link text-foreground" href="/docs">
          Use it in your app
        </Link>
      </p>
    </div>
  );
}

/** Svalin Pro: what a sale of your own size would fetch, by the same formula as the sizes above. */
function OwnSaleSize({ backingUsd, priceUsd }: { backingUsd: number; priceUsd: number }) {
  const [value, setValue] = useState("");
  const saleUsd = Number(value.replace(/[$,s]/g, ""));
  const valid = Number.isFinite(saleUsd) && saleUsd > 0 && saleUsd <= 1e12;
  const loss = valid ? saleLoss(backingUsd, saleUsd) : 0;
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <div className="grid w-44 gap-0.5">
        <label className="text-sm text-mutedForeground" htmlFor="own-sale">
          Your sale size (Pro)
        </label>
        <input className="field" id="own-sale" inputMode="decimal" onChange={(event) => setValue(event.target.value)} placeholder="$25,000" value={value} />
      </div>
      {valid ? (
        <p className="pb-3">
          fetches {formatUsd(saleProceeds(backingUsd, saleUsd))}{" "}
          <span className="text-sm text-mutedForeground">
            {lossLabel(loss)} below the price, {formatPrice(priceUsd * (1 - loss))} a token
          </span>
        </p>
      ) : null}
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
