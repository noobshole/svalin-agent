import { gradeMigrationSchema, type GradeMigration, type NearTokenIndex, type TokenGrade } from "@svalin-agent/shared";

/**
 * Svalin's track record: how the grades of one sealed edition moved by a later edition. Pure, so
 * anyone can recompute it from two sealed editions.
 */

const RANK: Record<TokenGrade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

type Row = Record<TokenGrade | "gone", number>;
const emptyRow = (): Row => ({ A: 0, B: 0, C: 0, D: 0, F: 0, gone: 0 });

export function gradeMigration(from: NearTokenIndex, to: NearTokenIndex, days: number, sealedDay: string): GradeMigration {
  const now = new Map(to.rows.map((row) => [row[0], row] as const));
  const matrix: Record<TokenGrade, Row> = { A: emptyRow(), B: emptyRow(), C: emptyRow(), D: emptyRow(), F: emptyRow() };
  let upgraded = 0;
  let downgraded = 0;
  let unchanged = 0;
  let gone = 0;
  let lostAllBacking = 0;

  for (const [contract, , , backing, grade] of from.rows) {
    const later = now.get(contract);
    if (!later) {
      matrix[grade].gone += 1;
      gone += 1;
      if (backing > 0) lostAllBacking += 1;
      continue;
    }
    const [, , , laterBacking, laterGrade] = later;
    matrix[grade][laterGrade] += 1;
    if (RANK[laterGrade] < RANK[grade]) upgraded += 1;
    else if (RANK[laterGrade] > RANK[grade]) downgraded += 1;
    else unchanged += 1;
    if (backing > 0 && laterBacking === 0) lostAllBacking += 1;
  }

  return gradeMigrationSchema.parse({
    days,
    sealedDay,
    from: from.generatedAt,
    tokens: from.rows.length,
    matrix,
    upgraded,
    downgraded,
    unchanged,
    gone,
    lostAllBacking,
  });
}
