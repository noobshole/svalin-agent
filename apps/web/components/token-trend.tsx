"use client";

import { tokenDailySeriesSchema, type TokenDailySeries } from "@svalin-agent/shared";
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

import { API_BASE_URL } from "@/lib/api";
import { formatCompactUsd, formatPrice } from "@/lib/utils/formatting";

type Daily = { days: string[]; tokens: Record<string, unknown> };
type Points = (number | null)[];

// The daily file holds every token, so the page loads it once, the first time a token is opened.
let request: Promise<Daily | null> | null = null;

function loadDaily(): Promise<Daily | null> {
  request ??= fetch(`${API_BASE_URL}/v1/index/near-tokens/daily`)
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const daily = body as Partial<Daily> | null;
      return daily && Array.isArray(daily.days) && daily.tokens && typeof daily.tokens === "object" ? (daily as Daily) : null;
    })
    .catch(() => null)
    .then((daily) => {
      // A failed load is tried again the next time a token is opened.
      if (!daily) request = null;
      return daily;
    });
  return request;
}

/** "28 Oct": the days are UTC dates. */
function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const backingLabel = (usd: number) => (usd > 0 ? formatCompactUsd(usd) : "none");

/**
 * A token's last 30 days in the Index, one point a day: its quoted price and the real backing its
 * grade used. Nothing is shown for a token the daily file does not have yet.
 */
export function TokenTrend({ contract }: { contract: string }) {
  const [state, setState] = useState<{ days: string[]; series: TokenDailySeries } | "loading" | "none">("loading");

  useEffect(() => {
    let live = true;
    void loadDaily().then((daily) => {
      if (!live) return;
      const series = tokenDailySeriesSchema.safeParse(daily?.tokens[contract]);
      const fits = daily && series.success && series.data[0].length === daily.days.length && series.data[1].length === daily.days.length;
      setState(fits ? { days: daily.days, series: series.data } : "none");
    });
    return () => {
      live = false;
    };
  }, [contract]);

  if (state === "none") return null;
  if (state === "loading") return <p className="text-sm text-mutedForeground">Loading the last 30 days…</p>;
  const [prices, backing] = state.series;
  if (prices.filter((value) => value !== null).length < 2) {
    return <p className="text-sm text-mutedForeground">Its last 30 days show here once it has been in the Index for two days.</p>;
  }
  return (
    <div className="grid gap-4">
      <h3 className="subtitle">Last {state.days.length} days</h3>
      <div className="grid gap-x-[var(--gap)] gap-y-6 sm:grid-cols-2">
        <Trend days={state.days} format={formatPrice} label="Price" points={prices} />
        <Trend days={state.days} format={backingLabel} fromZero label="Real backing" points={backing} />
      </div>
    </div>
  );
}

/** How a value moved from the first point to the last, in plain words. */
function change(first: number, last: number, format: (value: number) => string) {
  if (first === last) return "no change";
  if (first === 0) return `up from ${format(0)}`;
  const pct = ((last - first) / first) * 100;
  if (Math.abs(pct) < 0.1) return "about the same";
  const size = Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1) : Math.round(Math.abs(pct)).toString();
  return `${pct > 0 ? "up" : "down"} ${size}%`;
}

const WIDTH = 240;
const HEIGHT = 56;
const PAD = 5;
/** The smallest price range the scale shows, as a share of the price. */
const MIN_SPAN = 0.02;

/**
 * One measure as a small chart: its latest value, how it moved, and a line with one point a day.
 * The line breaks where the token was missing from the Index. Pointer or arrow keys read any day.
 * `fromZero` starts the scale at zero, so a fall to no backing at all looks like one. Otherwise
 * the scale spans at least 2% of the value, so a stablecoin's tiny wobbles draw as the flat line
 * they are.
 */
function Trend({ label, days, points, format, fromZero = false }: { label: string; days: string[]; points: Points; format: (value: number) => string; fromZero?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const known = points.flatMap((value, at) => (value === null ? [] : [{ value, at }]));
  if (known.length < 2) return null;

  const first = known[0];
  const last = known[known.length - 1];
  const values = known.map((point) => point.value);
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const span = Math.max(top - bottom, top * MIN_SPAN);
  const low = fromZero ? 0 : (top + bottom) / 2 - span / 2;
  const high = fromZero ? top : (top + bottom) / 2 + span / 2;
  const x = (at: number) => (days.length === 1 ? WIDTH / 2 : (at / (days.length - 1)) * WIDTH);
  const y = (value: number) => (high === low ? HEIGHT / 2 : PAD + (1 - (value - low) / (high - low)) * (HEIGHT - 2 * PAD));

  // One path, broken into segments wherever a day has no point.
  let path = "";
  points.forEach((value, at) => {
    if (value === null) return;
    path += `${at > 0 && points[at - 1] !== null ? "L" : "M"}${x(at).toFixed(1)},${y(value).toFixed(1)}`;
  });

  // The day under the pointer snaps to the nearest one that has a point.
  const nearest = (at: number) => known.reduce((best, point) => (Math.abs(point.at - at) < Math.abs(best.at - at) ? point : best)).at;
  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(nearest(Math.round(((event.clientX - box.left) / box.width) * (days.length - 1))));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = known.findIndex((point) => point.at === (active ?? last.at));
    const next = known[Math.min(known.length - 1, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)))];
    setActive(next.at);
  };

  const shown = active ?? last.at;
  const shownValue = points[shown] ?? last.value;
  const summary = `${label} from ${format(first.value)} on ${dayLabel(days[first.at])} to ${format(last.value)} on ${dayLabel(days[last.at])}, between ${format(bottom)} and ${format(top)}.`;

  return (
    <div className="grid content-start gap-1 border-t border-foreground pt-2">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p aria-live="polite" className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-lg">{format(shownValue)}</span>
        <span className="text-sm text-mutedForeground">
          {active === null ? `${change(first.value, last.value, format)} since ${dayLabel(days[first.at])}` : `on ${dayLabel(days[shown])}`}
        </span>
      </p>
      <div
        aria-label={`${summary} Use the arrow keys to read each day.`}
        className="relative h-14 cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onPointerMove={onPointer}
        role="group"
        tabIndex={0}
      >
        <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible text-mutedForeground" preserveAspectRatio="none" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <path d={path} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {active !== null ? (
          <span aria-hidden="true" className="absolute inset-y-0 w-px bg-borderStrong" style={{ left: `${(x(active) / WIDTH) * 100}%` }} />
        ) : null}
        <span
          aria-hidden="true"
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-background"
          style={{ left: `${(x(shown) / WIDTH) * 100}%`, top: `${(y(shownValue) / HEIGHT) * 100}%` }}
        />
      </div>
    </div>
  );
}
