/**
 * During a methodology trial: compares the current edition with the trial edition built in the same
 * run, and writes near-methodology-trial.json beside the trial edition. It changes no grade.
 *
 *   pnpm --filter @svalin-agent/api run index:compare <current-dir> <trial-dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { nearTokenIndexSchema } from "@svalin-agent/shared";

import { compareMethods } from "../src/ratings/trial.js";

const [currentDir, trialDir] = process.argv.slice(2).map((dir) => resolve(dir));
if (!currentDir || !trialDir) throw new Error("usage: index:compare <current-dir> <trial-dir>");
const load = (dir: string) => nearTokenIndexSchema.parse(JSON.parse(readFileSync(resolve(dir, "near-token-index.json"), "utf8")));

const trial = compareMethods(load(currentDir), load(trialDir));
writeFileSync(resolve(trialDir, "near-methodology-trial.json"), JSON.stringify(trial));
console.log(
  JSON.stringify({
    msg: "methodology_trial",
    current: trial.current.counts,
    trial: trial.trial.counts,
    differ: Object.keys(trial.differ).length,
    onlyCurrent: trial.onlyCurrent,
    onlyTrial: trial.onlyTrial,
  }),
);
