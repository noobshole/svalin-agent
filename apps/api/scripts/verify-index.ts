/**
 * Verifies a Svalin Index edition: checks the hashes of its archived inputs and index file, its
 * fingerprint, and recomputes every token's backing and grade from the archived inputs. Run it
 * with the Svalin code at the edition's recorded commit:
 *
 *   git clone https://github.com/noobshole/svalin-index && git -C svalin-index checkout latest
 *   pnpm --filter @svalin-agent/api run index:verify ../../svalin-index
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { indexEditionSchema } from "@svalin-agent/shared";

import { checkEdition } from "../src/ratings/edition.js";

const dir = resolve(process.argv[2] ?? "index-out");
const edition = indexEditionSchema.parse(JSON.parse(readFileSync(resolve(dir, "edition.json"), "utf8")));
const read = (path: string, gzipped: boolean) => {
  const bytes = readFileSync(resolve(dir, path));
  return (gzipped ? gunzipSync(bytes) : bytes).toString("utf8");
};

const result = checkEdition(edition, {
  prices: read(edition.files.prices.path, true),
  pools: read(edition.files.pools.path, true),
  index: read(edition.files.index.path, false),
  dclPools: edition.files.dclPools ? read(edition.files.dclPools.path, true) : undefined,
  history: edition.files.history ? read(edition.files.history.path, true) : undefined,
});

console.log(`Edition ${edition.generatedAt}`);
console.log(`Fingerprint ${edition.fingerprint}`);
console.log(`Code ${edition.code.repository} @ ${edition.code.commit}`);
if (result.ok) {
  console.log(`Verified: hashes match and all ${result.checked.toLocaleString("en-US")} grades were reproduced from the archived inputs.`);
} else {
  console.log("NOT verified:");
  for (const problem of result.problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
