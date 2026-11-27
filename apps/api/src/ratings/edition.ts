import { createHash } from "node:crypto";

import { lookupToken } from "@svalin-agent/chain-config";
import { indexEditionSchema, nearTokenIndexSchema, type IndexEdition, type NearTokenIndex } from "@svalin-agent/shared";

import { parseRefPools, poolBackingAmounts, poolDepth, type NearPriceList, type RefDclPool } from "../sources/near-source.js";
import { detailProblems, type BackingDetail } from "./backing-detail.js";
import { gradeChanges } from "./grade-changes.js";
import { heldDepth, rateNearTokens, type BackingHistory } from "./near-tokens.js";

/**
 * Sealing and checking Svalin Index editions. An edition is reproducible: its grades follow from
 * the archived Rhea Finance responses by the open code at the recorded commit, and its fingerprint
 * pins those files so they cannot be swapped after the fact. Used by the build and verify scripts
 * (Node only; the API never imports this).
 */

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * SHA-256 of the edition's fields in a fixed order, independent of how the JSON was written. Files
 * added in later methodologies are included only when present, so older fingerprints still match.
 */
export function editionFingerprint(edition: Omit<IndexEdition, "fingerprint">): string {
  const { files } = edition;
  const file = (entry: { path: string; sha256: string }) => ({ path: entry.path, sha256: entry.sha256 });
  return sha256Hex(
    JSON.stringify({
      generatedAt: edition.generatedAt,
      methodology: edition.methodology,
      code: { repository: edition.code.repository, commit: edition.code.commit },
      files: {
        prices: file(files.prices),
        pools: file(files.pools),
        index: file(files.index),
        ...(files.dclPools ? { dclPools: file(files.dclPools) } : {}),
        ...(files.history ? { history: file(files.history) } : {}),
        ...(files.backingDetail ? { backingDetail: file(files.backingDetail) } : {}),
      },
      ...(edition.block ? { block: { height: edition.block.height, hash: edition.block.hash } } : {}),
    }),
  );
}

export function sealEdition(fields: Omit<IndexEdition, "fingerprint">): IndexEdition {
  return indexEditionSchema.parse({ ...fields, fingerprint: editionFingerprint(fields) });
}

export type EditionCheck = {
  ok: boolean;
  problems: string[];
  /** Tokens whose grade and backing were recomputed. */
  checked: number;
  /** What the files given could not check, such as grade changes without the previous edition. */
  notes?: string[];
};

export type EditionFiles = {
  prices: string;
  pools: string;
  index: string;
  dclPools?: string;
  history?: string;
  backingDetail?: string;
  /**
   * The sealed edition the grade changes were worked out against (near-token-backing-v2), with its
   * history and backing detail when it has them (needed to recompute the exact reasons).
   */
  previous?: { edition: IndexEdition; index: string; prices: string; history?: string; backingDetail?: string };
};

/**
 * Checks an edition against its files: every hash, the fingerprint, and every token's backing and
 * grade recomputed from the archived inputs. From near-token-backing-v1 that includes Rhea's DCL
 * pools and the 24-hour hold: the archived history must end with exactly the backing the inputs
 * give, and each grade must follow from the history. Market cap, holder data, on-chain metadata
 * (symbols missing from Rhea) and notes come from other APIs and are pinned by the index hash but
 * not recomputed. Editions from before late November 2026 did not grade the registry tokens
 * (wNEAR, stablecoins, liquid staking), so for an edition without them they are left out of the
 * recomputation too, and older editions still verify. From near-token-backing-v2 the block the pools
 * were read at is part of the fingerprint, the backing detail must agree with the history and the
 * pools, and the grade changes and their reasons are recomputed too when the sealed edition they
 * are measured from is given (`files.previous`).
 */
export function checkEdition(edition: IndexEdition, files: EditionFiles): EditionCheck {
  const problems: string[] = [];
  const expect = (name: keyof IndexEdition["files"], text: string | undefined) => {
    const recorded = edition.files[name];
    if (!recorded) return;
    if (text === undefined) problems.push(`${name} file is missing`);
    else if (sha256Hex(text) !== recorded.sha256) problems.push(`${name} file does not match its SHA-256`);
  };
  expect("prices", files.prices);
  expect("pools", files.pools);
  expect("index", files.index);
  expect("dclPools", files.dclPools);
  expect("history", files.history);
  expect("backingDetail", files.backingDetail);
  if (editionFingerprint(edition) !== edition.fingerprint) problems.push("fingerprint does not match the edition's fields");

  const published = JSON.parse(files.index) as NearTokenIndex;
  const prices = JSON.parse(files.prices) as NearPriceList;
  const dclPools = edition.files.dclPools && files.dclPools ? (JSON.parse(files.dclPools) as RefDclPool[]) : [];
  const current = poolDepth(parseRefPools(files.pools), prices, dclPools);
  const gradesRegistry = published.rows.some((row) => lookupToken("near", row[0]));
  if (!gradesRegistry) for (const contract of current.keys()) if (lookupToken("near", contract)) current.delete(contract);

  let graded: ReadonlyMap<string, number> = current;
  const now = Date.parse(published.generatedAt);
  const history = edition.files.history && files.history ? (JSON.parse(files.history) as BackingHistory) : undefined;
  const detail = edition.files.backingDetail && files.backingDetail ? (JSON.parse(files.backingDetail) as BackingDetail) : undefined;
  if (history) {
    // The history's newest entry for each token must be this edition's backing, nothing else.
    for (const [contract, usd] of current) {
      const backing = Math.round(usd);
      const last = history[contract]?.points.at(-1);
      if (backing > 0 && (!last || last[0] !== now || last[1] !== backing)) {
        problems.push(`${contract}: history does not end with this edition's backing ($${backing})`);
      }
    }
    for (const contract of Object.keys(history)) {
      if (!(Math.round(current.get(contract) ?? 0) > 0)) problems.push(`${contract}: history lists backing the inputs do not give`);
    }
    graded = heldDepth(history, now);
    if (detail) problems.push(...detailProblems(detail, history, poolBackingAmounts(parseRefPools(files.pools), prices, dclPools), prices, now));
  }

  const recomputed = rateNearTokens(prices, graded);
  if (!gradesRegistry) recomputed.rows = recomputed.rows.filter((row) => !lookupToken("near", row[0]));
  const byContract = new Map(recomputed.rows.map((row) => [row[0], row]));
  for (const row of published.rows) {
    const again = byContract.get(row[0]);
    if (!again) problems.push(`${row[0]} is not in the recomputed index`);
    else if (again[3] !== row[3] || again[4] !== row[4]) {
      problems.push(`${row[0]}: published ${row[4]} ($${row[3]}), recomputed ${again[4]} ($${again[3]})`);
    }
  }
  if (recomputed.rows.length !== published.rows.length) {
    problems.push(`published ${published.rows.length} tokens, recomputed ${recomputed.rows.length}`);
  }

  const block = published.provenance?.block;
  if (block && (block.height !== edition.block?.height || block.hash !== edition.block?.hash)) {
    problems.push("the index and the edition record name different blocks");
  }

  const notes: string[] = [];
  if (published.changes) {
    if (files.previous) problems.push(...changeProblems(published, prices, files, dclPools, files.previous, history, detail));
    else notes.push(`grade changes since ${published.changes.since} not checked: give that sealed edition with --previous`);
  }
  return {
    ok: problems.length === 0,
    problems: problems.slice(0, 20),
    checked: published.rows.length,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/** The grade changes recomputed from both editions' archived files, and anything that differs. */
function changeProblems(
  published: NearTokenIndex,
  prices: NearPriceList,
  files: EditionFiles,
  dclPools: RefDclPool[],
  previous: NonNullable<EditionFiles["previous"]>,
  history: BackingHistory | undefined,
  detail: BackingDetail | undefined,
): string[] {
  const changes = published.changes;
  if (!changes) return [];
  const problems: string[] = [];
  const { edition } = previous;
  if (edition.fingerprint !== changes.sinceFingerprint) problems.push("the previous edition given is not the one the changes name");
  if (edition.generatedAt.slice(0, 10) !== changes.since) problems.push(`the previous edition given is from ${edition.generatedAt.slice(0, 10)}, not ${changes.since}`);
  if (sha256Hex(previous.index) !== edition.files.index.sha256) problems.push("the previous index file does not match its SHA-256");
  if (sha256Hex(previous.prices) !== edition.files.prices.sha256) problems.push("the previous prices file does not match its SHA-256");
  const previousFile = <T>(name: "history" | "backingDetail"): T | undefined => {
    const recorded = edition.files[name];
    const text = previous[name];
    if (!recorded) return undefined;
    if (text === undefined) problems.push(`the previous ${name} file is missing`);
    else if (sha256Hex(text) !== recorded.sha256) problems.push(`the previous ${name} file does not match its SHA-256`);
    else return JSON.parse(text) as T;
    return undefined;
  };
  const previousHistory = previousFile<BackingHistory>("history");
  const previousDetail = previousFile<BackingDetail>("backingDetail");
  if (problems.length > 0) return problems;

  const again = gradeChanges(
    {
      day: changes.since,
      generatedAt: edition.generatedAt,
      fingerprint: edition.fingerprint,
      methodology: edition.methodology,
      index: nearTokenIndexSchema.parse(JSON.parse(previous.index)),
      prices: JSON.parse(previous.prices) as NearPriceList,
      history: previousHistory,
      detail: previousDetail,
    },
    { index: published, prices, pools: parseRefPools(files.pools), dclPools, history, detail },
  );
  for (const contract of new Set([...Object.keys(changes.tokens), ...Object.keys(again.tokens)])) {
    const said = changes.tokens[contract];
    const recomputed = again.tokens[contract];
    const same =
      said && recomputed && said.from === recomputed.from && said.to === recomputed.to && said.reason === recomputed.reason && said.estimated === recomputed.estimated;
    if (!same) {
      const show = (change?: { from: string; to: string; reason: string; estimated?: true }) =>
        change ? `${change.from}→${change.to} (${change.reason}${change.estimated ? ", estimated" : ""})` : "no change";
      problems.push(`${contract}: change published as ${show(said)}, recomputed as ${show(recomputed)}`);
    }
  }
  if (changes.sinceMethodology !== again.sinceMethodology || changes.sinceGeneratedAt !== again.sinceGeneratedAt) {
    problems.push("the changes name the previous edition's time or methodology wrongly");
  }
  return problems;
}
