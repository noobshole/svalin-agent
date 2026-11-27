/**
 * Verifies a Svalin Index edition: checks the hashes of its archived inputs and index file, its
 * fingerprint, and recomputes every token's backing and grade from the archived inputs. Run it
 * with the Svalin code at the edition's recorded commit:
 *
 *   git clone https://github.com/noobshole/svalin-index && git -C svalin-index checkout latest
 *   pnpm --filter @svalin-agent/api run index:verify ../../svalin-index
 *
 * For a near-token-backing-v2 edition, two options check more:
 *   --previous <dir>  the sealed edition its grade changes are measured from, so their reasons are
 *                     recomputed too (from both editions' backing detail where they have it);
 *   --chain [url]     reads the edition's pools again from a NEAR archive node at the recorded block
 *                     and checks they are exactly the archived files (default: FastNEAR's archive).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { indexEditionSchema } from "@svalin-agent/shared";

import { NearRpc, readChainDclPools, readChainPools } from "../src/ratings/chain-pools.js";
import { checkEdition, sha256Hex, type EditionFiles } from "../src/ratings/edition.js";

const ARCHIVE_RPC = "https://archival-rpc.mainnet.fastnear.com";

const args = process.argv.slice(2);
/** An option and the value after it, if `takes` accepts that value; "" when it has none. */
const option = (name: string, takes: (value: string) => boolean) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  const taken = value !== undefined && !value.startsWith("--") && takes(value);
  args.splice(at, taken ? 2 : 1);
  return taken ? value : "";
};
const previousDir = option("--previous", () => true);
// Only a URL is taken as the archive node, so `--chain <edition dir>` still reads the folder.
const chain = option("--chain", (value) => /^https?:\/\//.test(value));
const dir = resolve(args[0] ?? "index-out");

function readEdition(from: string) {
  const edition = indexEditionSchema.parse(JSON.parse(readFileSync(resolve(from, "edition.json"), "utf8")));
  const read = (path: string, gzipped: boolean) => {
    const bytes = readFileSync(resolve(from, path));
    return (gzipped ? gunzipSync(bytes) : bytes).toString("utf8");
  };
  /** A file the record lists, read as archived (the inputs are gzipped), or undefined if it lists none. */
  const file = (entry: { path: string } | undefined) => (entry ? read(entry.path, entry.path.endsWith(".gz")) : undefined);
  return { edition, read, file };
}

const { edition, read, file } = readEdition(dir);
const pools = read(edition.files.pools.path, true);
const dclPools = edition.files.dclPools ? read(edition.files.dclPools.path, true) : undefined;
let previous: EditionFiles["previous"];
if (previousDir) {
  const before = readEdition(resolve(previousDir));
  const { files } = before.edition;
  previous = {
    edition: before.edition,
    index: before.read(files.index.path, false),
    prices: before.read(files.prices.path, true),
    history: before.file(files.history),
    backingDetail: before.file(files.backingDetail),
  };
}

const result = checkEdition(edition, {
  prices: read(edition.files.prices.path, true),
  pools,
  index: read(edition.files.index.path, false),
  dclPools,
  history: file(edition.files.history),
  backingDetail: file(edition.files.backingDetail),
  previous,
});

if (chain !== undefined) {
  if (!edition.block) {
    result.problems.push("--chain: this edition records no block (only near-token-backing-v2 editions do)");
  } else {
    const rpc = new NearRpc(chain || ARCHIVE_RPC);
    const [again, dclAgain] = await Promise.all([readChainPools(rpc, edition.block.height), readChainDclPools(rpc, edition.block.height)]);
    if (sha256Hex(JSON.stringify(again)) !== edition.files.pools.sha256) result.problems.push(`--chain: the pools at block ${edition.block.height} differ from the archived pools file`);
    if (edition.files.dclPools && sha256Hex(JSON.stringify(dclAgain)) !== edition.files.dclPools.sha256) {
      result.problems.push(`--chain: the DCL pools at block ${edition.block.height} differ from the archived file`);
    }
  }
  result.ok = result.problems.length === 0;
}

console.log(`Edition ${edition.generatedAt}`);
console.log(`Fingerprint ${edition.fingerprint}`);
console.log(`Code ${edition.code.repository} @ ${edition.code.commit}`);
if (edition.block) console.log(`Block ${edition.block.height} (${edition.block.hash})`);
if (result.ok) {
  console.log(`Verified: hashes match and all ${result.checked.toLocaleString("en-US")} grades were reproduced from the archived inputs.`);
  if (previous) console.log("The grade changes and their reasons were reproduced from both editions.");
  if (chain !== undefined && edition.block) console.log(`The archived pools are exactly what NEAR held at block ${edition.block.height}.`);
} else {
  console.log("NOT verified:");
  for (const problem of result.problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
for (const note of result.notes ?? []) console.log(`Note: ${note}`);
