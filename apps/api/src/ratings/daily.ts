import { TOKEN_DAILY_DAYS, type NearTokenIndex, type TokenDaily, type TokenDailySeries } from "@svalin-agent/shared";

/** Four significant digits: enough to draw a price, and it keeps the file small. */
const fourDigits = (value: number) => Number(value.toPrecision(4));

/**
 * Adds an edition to the daily file behind the ratings page's small charts: one point a day per
 * token, its quoted price and the real backing its grade used. A later edition on the same day
 * replaces that day's point, so each day ends up with its last edition. Days beyond `keepDays` drop
 * off, and so does a token with no point left in the window.
 */
export function addToDaily(previous: TokenDaily | null, index: NearTokenIndex, keepDays = TOKEN_DAILY_DAYS): TokenDaily {
  const day = index.generatedAt.slice(0, 10);
  const earlier = (previous?.days ?? []).filter((known) => known < day);
  const days = [...earlier, day].slice(-keepDays);
  // Where each kept day sits in the previous file, so its points carry over.
  const from = days.map((known) => previous?.days.indexOf(known) ?? -1);

  const today = new Map(index.rows.map((row) => [row[0], row] as const));
  const contracts = new Set([...Object.keys(previous?.tokens ?? {}), ...today.keys()]);
  const tokens: Record<string, TokenDailySeries> = {};
  for (const contract of contracts) {
    const [prices, backing] = previous?.tokens[contract] ?? [[], []];
    const row = today.get(contract);
    const series: TokenDailySeries = [
      days.map((known, at) => (known === day ? (row ? fourDigits(row[2]) : null) : (prices[from[at]] ?? null))),
      days.map((known, at) => (known === day ? (row ? row[3] : null) : (backing[from[at]] ?? null))),
    ];
    if (series[0].some((point) => point !== null)) tokens[contract] = series;
  }
  return { generatedAt: index.generatedAt, days, tokens };
}
