import { z } from "zod";

/**
 * Token grades answer one question: how much of a $1,000 sale would be lost to price movement,
 * given the trusted money in the token's pools? Shared by the API, which computes them, and the
 * website, which explains them.
 */
export const tokenGradeSchema = z.enum(["A", "B", "C", "D", "F"]);

export const TOKEN_SALE_USD = 1_000;

/** Minimum pool backing per grade; loss on a $1,000 sale is about sale / (backing + sale). */
export const TOKEN_GRADE_FLOORS: readonly { grade: Exclude<TokenGrade, "F">; backingUsd: number }[] = [
  { grade: "A", backingUsd: 1_000_000 }, // loses under 0.1%
  { grade: "B", backingUsd: 100_000 }, // under 1%
  { grade: "C", backingUsd: 20_000 }, // under 5%
  { grade: "D", backingUsd: 3_000 }, // under 25%
];

export function tokenGradeFor(backingUsd: number): TokenGrade {
  return TOKEN_GRADE_FLOORS.find((floor) => backingUsd >= floor.backingUsd)?.grade ?? "F";
}

/**
 * Share of a sale lost to price movement, from 0 to 1: about sale / (backing + sale) in a
 * constant-product pool. Grades use a $1,000 sale; a guard checking a real trade passes its size.
 */
export function saleLoss(backingUsd: number, saleUsd: number = TOKEN_SALE_USD): number {
  return backingUsd > 0 ? saleUsd / (backingUsd + saleUsd) : 1;
}

/**
 * What a sale of `saleUsd` at the quoted price would actually fetch: sale x backing / (backing + sale).
 * Always less than the backing itself, however large the sale.
 */
export function saleProceeds(backingUsd: number, saleUsd: number): number {
  return saleUsd > 0 ? saleUsd * (1 - saleLoss(backingUsd, saleUsd)) : 0;
}

/** The largest sale that loses at most `maxLoss` (0 to 1): backing x maxLoss / (1 - maxLoss). */
export function largestSale(backingUsd: number, maxLoss: number): number {
  return backingUsd > 0 && maxLoss > 0 && maxLoss < 1 ? (backingUsd * maxLoss) / (1 - maxLoss) : 0;
}

/** Sale sizes every token's exit prices are quoted at. */
export const EXIT_SALE_SIZES_USD: readonly number[] = [1_000, 10_000, 100_000];

/** Backing must hold this long before it can raise a grade, so a fresh pool cannot buy one. */
export const BACKING_HOLD_MS = 24 * 60 * 60 * 1000;

/** Top-10 holder share at or above which a token is flagged as concentrated. */
export const CONCENTRATION_FLAG_PCT = 80;

/**
 * One rated token: contract, symbol, quoted price, pool backing (USD), grade, then the
 * enrichment that only tokens with real backing get (null otherwise): market cap at the quoted
 * price (price x total supply), share held by the top 10 holders outside pools, bridges and
 * NEAR Intents, and holder count.
 */
export const ratedTokenSchema = z.tuple([
  z.string(),
  z.string(),
  z.number().positive(),
  z.number().nonnegative(),
  tokenGradeSchema,
  z.number().nonnegative().nullable(),
  z.number().min(0).max(100).nullable(),
  z.number().int().nonnegative().nullable(),
]);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * What an edition was computed from, so anyone can recompute its grades: the exact Ref Finance
 * responses (archived beside the edition, identified by SHA-256) and the Svalin code commit.
 */
export const indexProvenanceSchema = z.object({
  code: z.object({ repository: z.string().url(), commit: z.string() }),
  inputs: z.object({ pricesSha256: sha256Schema, poolsSha256: sha256Schema }),
});

/** The published index file. Rows instead of objects keep it small enough for a browser. */
export const nearTokenIndexSchema = z.object({
  generatedAt: z.string().datetime(),
  methodology: z.string(),
  counts: z.object({ A: z.number().int(), B: z.number().int(), C: z.number().int(), D: z.number().int(), F: z.number().int() }),
  provenance: indexProvenanceSchema.optional(),
  rows: z.array(ratedTokenSchema),
});

/**
 * The record that seals an edition: hashes of its archived inputs and of the index file. Its
 * `fingerprint` (SHA-256 of the other fields, in this order) is what gets written on chain.
 */
const editionFileSchema = z.object({ path: z.string(), sha256: sha256Schema });

export const indexEditionSchema = z.object({
  generatedAt: z.string().datetime(),
  methodology: z.string(),
  code: indexProvenanceSchema.shape.code,
  files: z.object({
    prices: editionFileSchema,
    pools: editionFileSchema,
    index: editionFileSchema,
    /** Ref's concentrated-liquidity (DCL) pools, from near-token-backing-v1. */
    dclPools: editionFileSchema.optional(),
    /** The backing history the 24-hour hold was applied from, from near-token-backing-v1. */
    history: editionFileSchema.optional(),
  }),
  fingerprint: sha256Schema,
});

/** Where a token stands at the end of a window: a grade, or gone from the Index altogether. */
const migrationTargetSchema = z.enum(["A", "B", "C", "D", "F", "gone"]);

/**
 * How grades moved between a sealed edition and a later one, the way rating agencies publish
 * transition matrices: `matrix[grade then][grade now]` counts tokens.
 */
export const gradeMigrationSchema = z.object({
  days: z.number().int().positive(),
  /** The sealed edition the window starts from (editions/<day> in the svalin-index repository). */
  sealedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().datetime(),
  tokens: z.number().int().nonnegative(),
  matrix: z.record(tokenGradeSchema, z.record(migrationTargetSchema, z.number().int().nonnegative())),
  upgraded: z.number().int().nonnegative(),
  downgraded: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  gone: z.number().int().nonnegative(),
  /** Tokens that had real backing at the start and have none now. */
  lostAllBacking: z.number().int().nonnegative(),
});

/** Published beside each edition. Windows appear once there are sealed editions old enough. */
export const trackRecordSchema = z.object({
  generatedAt: z.string().datetime(),
  methodology: z.string(),
  windows: z.array(gradeMigrationSchema),
});

/** One sale size: what it fetches, the share lost, and the average price per token received. */
export const exitQuoteSchema = z.object({
  saleUsd: z.number().positive(),
  fetchesUsd: z.number().nonnegative(),
  lossPct: z.number().min(0).max(100),
  exitPriceUsd: z.number().nonnegative(),
});

/**
 * One token's grade and exit prices: what selling it would actually fetch from the real money in
 * its pools, derived from an Index edition's backing so anyone can recompute it.
 */
export const tokenExitSchema = z.object({
  contract: z.string(),
  symbol: z.string(),
  grade: tokenGradeSchema,
  priceUsd: z.number().positive(),
  backingUsd: z.number().nonnegative(),
  marketCapUsd: z.number().nonnegative().nullable(),
  top10Pct: z.number().min(0).max(100).nullable(),
  holders: z.number().int().nonnegative().nullable(),
  exit: z.object({
    quotes: z.array(exitQuoteSchema),
    /** The largest sales that lose at most 1% and 5%: how much can leave near the quoted price. */
    within1PctUsd: z.number().nonnegative(),
    within5PctUsd: z.number().nonnegative(),
    /** The most the whole supply could fetch if it were all sold now; null when supply is unknown. */
    wholeSupplyUsd: z.number().nonnegative().nullable(),
  }),
  edition: z.object({ generatedAt: z.string(), methodology: z.string() }),
  note: z.string(),
});

export type TokenGrade = z.infer<typeof tokenGradeSchema>;
export type ExitQuote = z.infer<typeof exitQuoteSchema>;
export type TokenExit = z.infer<typeof tokenExitSchema>;
export type RatedTokenRow = z.infer<typeof ratedTokenSchema>;
export type GradeMigration = z.infer<typeof gradeMigrationSchema>;
export type TrackRecord = z.infer<typeof trackRecordSchema>;
export type NearTokenIndex = z.infer<typeof nearTokenIndexSchema>;
export type IndexProvenance = z.infer<typeof indexProvenanceSchema>;
export type IndexEdition = z.infer<typeof indexEditionSchema>;
