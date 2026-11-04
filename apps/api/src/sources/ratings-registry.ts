import { createHash } from "node:crypto";

import { tokenProofSchema, type RatedTokenRow, type TokenProof } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";
import { editionTree, leafIndex, leafText, proofFor, treeFromBytes, treeRoot, verifyLeaf, type EditionTree } from "../ratings/merkle.js";

type FetchLike = typeof fetch;

/** An edition as the Svalin Ratings registry on NEAR records it. */
export type RegistryEdition = {
  day: string;
  root: string;
  index_sha256: string;
  methodology: string;
  tokens: number;
};

export type RatingsRegistryOptions = {
  /** The registry contract, e.g. svalin-ratings-v1.testnet. */
  registry: string;
  /** JSON-RPC of the network the registry is on. */
  rpcUrl: string;
  /** Where sealed editions are published: <url>/<day>/near-token-index.json. */
  sealedUrl: string;
};

export const PROOF_NOTE =
  "Pass `grade` to a Svalin Guard vault's request_buy, or call the registry's verify with the token and these fields. The proof is " +
  "against the newest edition the registry accepts, sealed daily, so it can be a day older than the Index on the website. The " +
  "symbol is not part of a grade.";

/**
 * Merkle proofs of Svalin Index grades against the editions published on NEAR. The edition comes
 * from the registry itself; its sealed index file must match the SHA-256 the registry recorded, and
 * the rebuilt root must match the registry's root, or no proof is given.
 */
export class RatingsRegistry {
  private latest: { at: number; edition: Promise<RegistryEdition> } | undefined;
  private trees = new Map<string, Promise<EditionTree>>();

  constructor(
    private readonly options: RatingsRegistryOptions,
    private readonly fetchImpl: FetchLike = callFetch,
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** A token's grade and proof in the newest usable edition. Rejects when the token is not in it. */
  async proof(token: string): Promise<TokenProof> {
    const edition = await this.latestUsable();
    const tree = await this.tree(edition);
    const index = leafIndex(tree, token);
    const steps = proofFor(tree, token);
    if (index < 0 || !steps) {
      throw new ApiError(
        404,
        "not_in_edition",
        `This token is not in the edition of ${edition.day} on NEAR.`,
        "Editions grade every NEAR token Ref Finance prices; a token priced since then is in the next one.",
      );
    }
    const row = tree.rows[index];
    const backingUsd = Math.floor(row[3]);
    const leaf = leafText(edition.day, token, row[4], backingUsd);
    // Whichever way the tree was read, only a proof that reaches the registry's root goes out.
    if (!verifyLeaf(edition.root, leaf, steps)) throw unavailable();
    return tokenProofSchema.parse({
      token,
      grade: { day: edition.day, grade: row[4], backing_usd: backingUsd, proof: steps },
      leaf,
      root: edition.root,
      registry: this.options.registry,
      methodology: edition.methodology,
      note: PROOF_NOTE,
    });
  }

  private latestUsable(): Promise<RegistryEdition> {
    if (this.latest && this.now() - this.latest.at < this.ttlMs) return this.latest.edition;
    const edition = this.view<RegistryEdition | null>("latest_usable").then((found) => {
      if (!found) throw new Error("no usable edition");
      return found;
    });
    this.latest = { at: this.now(), edition };
    edition.catch(() => {
      if (this.latest?.edition === edition) this.latest = undefined;
    });
    return edition.catch(() => {
      throw unavailable();
    });
  }

  private tree(edition: RegistryEdition): Promise<EditionTree> {
    const cached = this.trees.get(edition.day);
    if (cached) return cached;
    const tree = (async () => {
      const base = `${this.options.sealedUrl}/${edition.day}`;
      const [response, treeFile] = await Promise.all([
        this.fetchImpl(`${base}/near-token-index.json`, { signal: AbortSignal.timeout(15_000) }),
        this.fetchImpl(`${base}/near-token-tree.bin`, { signal: AbortSignal.timeout(15_000) }).catch(() => null),
      ]);
      if (!response.ok) throw new Error(`sealed edition returned ${response.status}`);
      const text = await response.text();
      if (createHash("sha256").update(text).digest("hex") !== edition.index_sha256) throw new Error("sealed edition does not match the registry");
      const rows = (JSON.parse(text) as { rows?: RatedTokenRow[] }).rows ?? [];
      // The robot's tree file saves rebuilding the tree; editions without one are rebuilt here.
      const read = treeFile?.ok ? treeFromBytes(edition.day, rows, new Uint8Array(await treeFile.arrayBuffer())) : null;
      const built = read && treeRoot(read) === edition.root ? read : editionTree(edition.day, rows);
      if (treeRoot(built) !== edition.root) throw new Error("rebuilt root does not match the registry");
      return built;
    })();
    // Keep only the newest day's tree.
    this.trees = new Map([[edition.day, tree]]);
    tree.catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", msg: "proof_edition_failed", day: edition.day, error: String(error).slice(0, 200) }));
      if (this.trees.get(edition.day) === tree) this.trees.delete(edition.day);
    });
    return tree.catch(() => {
      throw unavailable();
    });
  }

  private async view<T>(method: string): Promise<T> {
    const response = await this.fetchImpl(this.options.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "svalin",
        method: "query",
        params: { request_type: "call_function", finality: "final", account_id: this.options.registry, method_name: method, args_base64: "e30=" },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { result?: { result?: number[] } };
    if (!response.ok || !body.result?.result) throw new Error(`registry ${method} failed`);
    return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
  }
}

function unavailable() {
  return new ApiError(503, "proofs_unavailable", "Grade proofs are not available right now.", "Retry in a few minutes.");
}
