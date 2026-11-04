/**
 * Puts a sealed Svalin Index edition's Merkle root on NEAR: the Svalin Ratings registry's `publish`,
 * signed with the publishing key, a function-call key that can call nothing else. The Index robot
 * runs it after sealing a day's edition, on the edition's near-token-root.json:
 *
 *   NEAR_RATINGS_PUBLISHER_KEY=ed25519:… pnpm --filter @svalin-agent/api run index:register [data-dir]
 *
 * Nothing is published when the registry already has that day with the same root; a different root
 * for the day fails the run, so the owner looks at it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, createTransaction } from "@near-js/transactions";
import { baseDecode } from "@near-js/utils";

const REGISTRY = process.env.NEAR_RATINGS_REGISTRY ?? "svalin-ratings-v1.testnet";
const RPC_URL = process.env.NEAR_RATINGS_RPC_URL ?? "https://rpc.testnet.fastnear.com";
const KEY = process.env.NEAR_RATINGS_PUBLISHER_KEY;
const DATA_DIR = resolve(process.argv[2] ?? "index-out");
const PUBLISH_GAS = 30_000_000_000_000n;

type RootArgs = { day: string; root: string; fingerprint: string; index_sha256: string; methodology: string; tokens: number };

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify(fields));
}

async function view<T>(method: string, args: unknown): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "svalin-index",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: REGISTRY,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json()) as { result?: { result?: number[] } };
  if (!body.result?.result) throw new Error(`no result from ${REGISTRY}.${method}`);
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
}

if (!KEY) throw new Error("NEAR_RATINGS_PUBLISHER_KEY is not set");
const args = JSON.parse(readFileSync(resolve(DATA_DIR, "near-token-root.json"), "utf8")) as RootArgs;

const existing = await view<{ root: string } | null>("edition", { day: args.day });
if (existing) {
  if (existing.root !== args.root) {
    log({ level: "error", msg: "registry_has_another_root", day: args.day, registry: existing.root, sealed: args.root });
    process.exit(1);
  }
  log({ msg: "root_already_published", day: args.day, root: args.root });
  process.exit(0);
}

const provider = new JsonRpcProvider({ url: RPC_URL });
const signer = KeyPairSigner.fromSecretKey(KEY as KeyPairString);
const publicKey = await signer.getPublicKey();
const accessKey = await provider.viewAccessKey(REGISTRY, publicKey.toString(), { finality: "final" });
const block = await provider.block({ finality: "final" });
const transaction = createTransaction(
  REGISTRY,
  publicKey,
  REGISTRY,
  BigInt(accessKey.nonce) + 1n,
  [actionCreators.functionCall("publish", args, PUBLISH_GAS, 0n)],
  baseDecode(block.header.hash),
);
const [, signed] = await signer.signTransaction(transaction);
const outcome = await provider.sendTransactionUntil(signed, "FINAL");
const status = outcome.status as { Failure?: unknown };
if (status.Failure !== undefined) {
  log({ level: "error", msg: "publish_failed", day: args.day, tx: outcome.transaction.hash, failure: JSON.stringify(status.Failure).slice(0, 300) });
  process.exit(1);
}
log({ msg: "root_published", day: args.day, root: args.root, tx: outcome.transaction.hash });
