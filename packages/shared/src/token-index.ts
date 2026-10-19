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

/** Share of a $1,000 sale lost to price movement, from 0 to 1. */
export function saleLoss(backingUsd: number): number {
  return backingUsd > 0 ? TOKEN_SALE_USD / (backingUsd + TOKEN_SALE_USD) : 1;
}

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
export const indexEditionSchema = z.object({
  generatedAt: z.string().datetime(),
  methodology: z.string(),
  code: indexProvenanceSchema.shape.code,
  files: z.object({
    prices: z.object({ path: z.string(), sha256: sha256Schema }),
    pools: z.object({ path: z.string(), sha256: sha256Schema }),
    index: z.object({ path: z.string(), sha256: sha256Schema }),
  }),
  fingerprint: sha256Schema,
});

export type TokenGrade = z.infer<typeof tokenGradeSchema>;
export type RatedTokenRow = z.infer<typeof ratedTokenSchema>;
export type NearTokenIndex = z.infer<typeof nearTokenIndexSchema>;
export type IndexProvenance = z.infer<typeof indexProvenanceSchema>;
export type IndexEdition = z.infer<typeof indexEditionSchema>;
