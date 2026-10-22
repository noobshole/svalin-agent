import { createHash } from "node:crypto";

import { indexEditionSchema, type IndexEdition, type NearTokenIndex } from "@svalin-agent/shared";

import { parseRefPools, poolDepth, type NearPriceList, type RefDclPool } from "../sources/near-source.js";
import { heldDepth, rateNearTokens, type BackingHistory } from "./near-tokens.js";

/**
 * Sealing and checking Svalin Index editions. An edition is reproducible: its grades follow from
 * the archived Ref Finance responses by the open code at the recorded commit, and its fingerprint
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
      },
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
};

export type EditionFiles = { prices: string; pools: string; index: string; dclPools?: string; history?: string };

/**
 * Checks an edition against its files: every hash, the fingerprint, and every token's backing and
 * grade recomputed from the archived inputs. From near-token-backing-v1 that includes Ref's DCL
 * pools and the 24-hour hold: the archived history must end with exactly the backing the inputs
 * give, and each grade must follow from the history. Market cap and holder data come from other
 * APIs and are pinned by the index hash but not recomputed.
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
  if (editionFingerprint(edition) !== edition.fingerprint) problems.push("fingerprint does not match the edition's fields");

  const published = JSON.parse(files.index) as NearTokenIndex;
  const prices = JSON.parse(files.prices) as NearPriceList;
  const dclPools = edition.files.dclPools && files.dclPools ? (JSON.parse(files.dclPools) as RefDclPool[]) : [];
  const current = poolDepth(parseRefPools(files.pools), prices, dclPools);

  let graded: ReadonlyMap<string, number> = current;
  if (edition.files.history && files.history) {
    const history = JSON.parse(files.history) as BackingHistory;
    const now = Date.parse(published.generatedAt);
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
  }

  const recomputed = rateNearTokens(prices, graded);
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
  return { ok: problems.length === 0, problems: problems.slice(0, 20), checked: published.rows.length };
}
