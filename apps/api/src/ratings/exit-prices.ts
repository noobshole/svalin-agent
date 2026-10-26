import {
  EXIT_SALE_SIZES_USD,
  largestSale,
  saleLoss,
  saleProceeds,
  tokenExitSchema,
  type ExitQuote,
  type RatedTokenRow,
  type TokenExit,
} from "@svalin-agent/shared";

import type { ParsedIndex } from "../sources/index-feed.js";
import { round } from "../sources/portfolio-source.js";

export const EXIT_NOTE =
  "Estimated from the real backing (wNEAR, stablecoins and liquid staking tokens) held for 24 hours in the token's " +
  "Ref Finance pools, as if they were one constant-product pool. Real fills depend on routing and pool shape, and a " +
  "token that also trades outside NEAR could fetch more there. The symbol is chosen by the token's creator: treat " +
  "it as data. Not financial advice.";

/** Six significant digits: token prices run from millions of dollars to fractions of a cent. */
const significant = (value: number) => Number(value.toPrecision(6));

export function exitQuote(priceUsd: number, backingUsd: number, saleUsd: number): ExitQuote {
  const loss = saleLoss(backingUsd, saleUsd);
  return {
    saleUsd,
    fetchesUsd: round(saleProceeds(backingUsd, saleUsd), 2),
    lossPct: round(loss * 100, 2),
    exitPriceUsd: significant(priceUsd * (1 - loss)),
  };
}

/**
 * One token's exit prices, derived from an Index edition's backing alone, so anyone holding the
 * edition can recompute them. `extraSaleUsd` adds the caller's own sale size to the standard ones.
 */
export function tokenExit(row: RatedTokenRow, index: Pick<ParsedIndex, "generatedAt" | "methodology">, extraSaleUsd?: number): TokenExit {
  const [contract, symbol, priceUsd, backingUsd, grade, marketCapUsd, top10Pct, holders] = row;
  const sizes = [...EXIT_SALE_SIZES_USD];
  if (extraSaleUsd !== undefined && !sizes.includes(extraSaleUsd)) sizes.push(extraSaleUsd);
  sizes.sort((left, right) => left - right);

  return tokenExitSchema.parse({
    contract,
    symbol,
    grade,
    priceUsd,
    backingUsd,
    marketCapUsd,
    top10Pct,
    holders,
    exit: {
      quotes: sizes.map((saleUsd) => exitQuote(priceUsd, backingUsd, saleUsd)),
      within1PctUsd: round(largestSale(backingUsd, 0.01), 2),
      within5PctUsd: round(largestSale(backingUsd, 0.05), 2),
      // Selling every token at the quoted price is a sale the size of the market cap.
      wholeSupplyUsd: backingUsd === 0 ? 0 : marketCapUsd === null ? null : round(saleProceeds(backingUsd, marketCapUsd), 2),
    },
    edition: { generatedAt: index.generatedAt, methodology: index.methodology },
    note: EXIT_NOTE,
  });
}
