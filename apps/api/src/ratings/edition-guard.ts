import type { NearTokenIndex } from "@svalin-agent/shared";

/**
 * The Index's circuit breaker. Within a few hours real markets do not lose a third of their tokens,
 * half their graded tokens, or most of their real money, so an edition that does is far likelier to
 * come from a broken or manipulated data source. Such an edition is refused and the previous one
 * stays published. Rising backing is held back by the 24-hour hold, so a sudden jump is suspect too.
 * Returns why the new edition looks wrong, or null when it looks like a normal market.
 */
export function editionAnomaly(previous: NearTokenIndex, next: NearTokenIndex): string | null {
  const graded = (index: NearTokenIndex) => index.rows.filter((row) => row[4] !== "F").length;
  const backing = (index: NearTokenIndex) => index.rows.reduce((sum, row) => sum + row[3], 0);
  const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

  if (next.rows.length < previous.rows.length * 0.7) {
    return `tokens priced fell from ${previous.rows.length} to ${next.rows.length}`;
  }
  const [gradedBefore, gradedNow] = [graded(previous), graded(next)];
  if (gradedBefore >= 20 && gradedNow < gradedBefore * 0.5) {
    return `tokens graded above F fell from ${gradedBefore} to ${gradedNow}`;
  }
  const [backingBefore, backingNow] = [backing(previous), backing(next)];
  if (backingBefore >= 1_000_000 && backingNow < backingBefore * 0.4) {
    return `real backing across the Index fell from ${usd(backingBefore)} to ${usd(backingNow)}`;
  }
  if (backingBefore >= 1_000_000 && backingNow > backingBefore * 3) {
    return `real backing across the Index rose from ${usd(backingBefore)} to ${usd(backingNow)}`;
  }
  return null;
}
