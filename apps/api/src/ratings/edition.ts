import { createHash } from "node:crypto";

import { indexEditionSchema, type IndexEdition, type NearTokenIndex } from "@svalin-agent/shared";

import { parseRefPools, poolDepth, type NearPriceList } from "../sources/near-source.js";
import { rateNearTokens } from "./near-tokens.js";

/**
 * Sealing and checking Svalin Index editions. An edition is reproducible: its grades follow from
 * the archived Ref Finance responses by the open code at the recorded commit, and its fingerprint
 * pins those files so they cannot be swapped after the fact. Used by the build and verify scripts
 * (Node only; the API never imports this).
 */

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 of the edition's fields in a fixed order, independent of how the JSON was written. */
export function editionFingerprint(edition: Omit<IndexEdition, "fingerprint">): string {
  const { files } = edition;
  return sha256Hex(
    JSON.stringify({
      generatedAt: edition.generatedAt,
      methodology: edition.methodology,
      code: { repository: edition.code.repository, commit: edition.code.commit },
      files: {
        prices: { path: files.prices.path, sha256: files.prices.sha256 },
        pools: { path: files.pools.path, sha256: files.pools.sha256 },
        index: { path: files.index.path, sha256: files.index.sha256 },
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

/**
 * Checks an edition against its files: every hash, the fingerprint, and every token's backing and
 * grade recomputed from the archived inputs. Market cap and holder data come from other APIs and
 * are pinned by the index hash but not recomputed.
 */
export function checkEdition(edition: IndexEdition, files: { prices: string; pools: string; index: string }): EditionCheck {
  const problems: string[] = [];
  const expect = (name: keyof IndexEdition["files"], text: string) => {
    if (sha256Hex(text) !== edition.files[name].sha256) problems.push(`${name} file does not match its SHA-256`);
  };
  expect("prices", files.prices);
  expect("pools", files.pools);
  expect("index", files.index);
  if (editionFingerprint(edition) !== edition.fingerprint) problems.push("fingerprint does not match the edition's fields");

  const published = JSON.parse(files.index) as NearTokenIndex;
  const prices = JSON.parse(files.prices) as NearPriceList;
  const recomputed = rateNearTokens(prices, poolDepth(parseRefPools(files.pools), prices));
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
