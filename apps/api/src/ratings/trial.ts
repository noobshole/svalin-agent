import { methodologyTrialSchema, type MethodologyTrial, type NearTokenIndex } from "@svalin-agent/shared";

/**
 * One run's two methodologies side by side, while a new one is on trial: the grade counts of each,
 * and every token both grade differently. Published beside the trial edition; it changes no grade.
 */
export function compareMethods(current: NearTokenIndex, trial: NearTokenIndex, now: Date = new Date()): MethodologyTrial {
  const trialRows = new Map(trial.rows.map((row) => [row[0], row] as const));
  const differ: MethodologyTrial["differ"] = {};
  let onlyCurrent = 0;
  for (const [contract, symbol, , backing, grade] of current.rows) {
    const other = trialRows.get(contract);
    if (!other) onlyCurrent += 1;
    else if (other[4] !== grade) differ[contract] = [symbol, grade, backing, other[4], other[3]];
  }
  const currentContracts = new Set(current.rows.map((row) => row[0]));
  const summary = (index: NearTokenIndex) => ({
    methodology: index.methodology,
    generatedAt: index.generatedAt,
    tokens: index.rows.length,
    counts: index.counts,
  });
  return methodologyTrialSchema.parse({
    generatedAt: now.toISOString(),
    current: summary(current),
    trial: summary(trial),
    differ,
    onlyCurrent,
    onlyTrial: trial.rows.filter((row) => !currentContracts.has(row[0])).length,
  });
}
