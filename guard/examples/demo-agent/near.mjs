// A small NEAR client for the demo, in plain Node (22 or newer) with no packages: view calls, a
// function call signed with an ed25519 key, and the events of a transaction once it has settled.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

export const RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
export const EXPLORER = process.env.NEAR_EXPLORER ?? "https://testnet.nearblocks.io/txns/";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text) {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`not base58: ${char}`);
    value = value * 58n + BigInt(digit);
  }
  let hex = value === 0n ? "" : value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const zeros = text.length - text.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
}

export function base58Encode(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

/** A request that never arrived or never answered, as opposed to one that was answered with an error. */
export const dropped = (error) => error?.name === "TimeoutError" || error?.name === "AbortError" || (error instanceof TypeError && /fetch failed|terminated/.test(error.message));

/**
 * `fetch` that asks again when the connection drops, up to `attempts` times. Only for requests
 * that are safe to repeat: reads, and writes the other side takes once however often they are sent.
 */
export async function steadyFetch(url, init = {}, { timeoutMs = 30_000, attempts = 4 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (!dropped(error) || attempt >= attempts) throw error;
      console.error(`  (connection dropped reaching ${new URL(url).hostname}; asking again, ${attempt} of ${attempts - 1})`);
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

async function rpc(method, params, attempts = 4) {
  const response = await steadyFetch(
    RPC_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "svalin-demo", method, params }),
    },
    { attempts },
  );
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 400)}`);
  return body.result;
}

export async function view(account, method, args = {}) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  // A failed view comes back as a result with an error, not as an RPC error.
  if (result.error) throw new Error(`${account}.${method}: ${String(result.error).slice(0, 300)}`);
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

/**
 * A key file as near-cli writes it: `{ account_id, public_key, private_key: "ed25519:…" }`. A file
 * that names no account signs for `account`.
 */
export function loadKey(file, account) {
  const key = JSON.parse(readFileSync(file, "utf8"));
  const raw = base58Decode(key.private_key.replace(/^ed25519:/, ""));
  if (raw.length !== 64) throw new Error("expected a 64-byte ed25519 secret key");
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw.subarray(0, 32)]);
  return {
    accountId: key.account_id || account,
    publicKey: raw.subarray(32),
    publicKeyText: `ed25519:${base58Encode(raw.subarray(32))}`,
    privateKey: createPrivateKey({ key: der, format: "der", type: "pkcs8" }),
  };
}

// Borsh, for a transaction with one function call.
const u32 = (n) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(n);
  return buffer;
};
const u64 = (n) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(n));
  return buffer;
};
const u128 = (n) => {
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64LE(BigInt(n) & 0xffffffffffffffffn);
  buffer.writeBigUInt64LE(BigInt(n) >> 64n, 8);
  return buffer;
};
const text = (s) => {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
};

/**
 * Signs a function call with `key` and sends it. Returns the transaction's hash as soon as the
 * transaction is in a final block; its receipts may still be running (see `settled`).
 */
export async function call(key, receiver, method, args, { gas = 300_000_000_000_000n, deposit = 0n } = {}) {
  const access = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: key.accountId, public_key: key.publicKeyText });
  const block = await rpc("block", { finality: "final" });
  const transaction = Buffer.concat([
    text(key.accountId),
    Buffer.from([0]),
    key.publicKey,
    u64(BigInt(access.nonce) + 1n),
    text(receiver),
    base58Decode(block.header.hash),
    u32(1),
    Buffer.from([2]),
    text(method),
    text(JSON.stringify(args)),
    u64(gas),
    u128(deposit),
  ]);
  const hash = createHash("sha256").update(transaction).digest();
  const signed = Buffer.concat([transaction, Buffer.from([0]), sign(null, hash, key.privateKey)]);
  // The same signed bytes can be sent again after a dropped connection: NEAR takes a transaction
  // once. If the first send did arrive, the second is answered with a used nonce, which is fine.
  let lost = false;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rpc("send_tx", { signed_tx_base64: signed.toString("base64"), wait_until: "INCLUDED_FINAL" }, 1);
      break;
    } catch (error) {
      if (dropped(error) && attempt < 4) {
        lost = true;
        console.error(`  (connection dropped sending to NEAR; sending the same transaction again, ${attempt} of 3)`);
        await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
        continue;
      }
      if (lost && /InvalidNonce|already/i.test(String(error))) break;
      throw error;
    }
  }
  return base58Encode(hash);
}

/**
 * The NEP-297 events of a transaction, `{ standard, event, data, by }`, its failures, and its return
 * value once everything it started has run, as soon as `done(events, value)` says the outcome is
 * there. A vault's check of a new payee waits for OutLayer, so this polls for up to about four
 * minutes.
 */
export async function settled(hash, sender, done = () => false) {
  let last = { events: [], failures: [] };
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const result = await rpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
      const events = [];
      const failures = [];
      for (const receipt of result.receipts_outcome ?? []) {
        for (const log of receipt.outcome.logs) {
          if (log.startsWith("EVENT_JSON:")) events.push({ ...JSON.parse(log.slice("EVENT_JSON:".length)), by: receipt.outcome.executor_id });
        }
        if (receipt.outcome.status?.Failure) failures.push(JSON.stringify(receipt.outcome.status.Failure).slice(0, 300));
      }
      // What the transaction returned, once everything it started has run (a Solana payment's
      // answer comes after NEAR's signing network has signed).
      const success = result.status?.SuccessValue;
      const value = success === undefined ? undefined : JSON.parse(Buffer.from(success, "base64").toString("utf8") || "null");
      last = { events, failures, value };
      if (done(events, value) || failures.length > 0) return last;
    } catch (error) {
      // A transaction the node has not seen yet: try again shortly.
      if (!String(error).includes("UNKNOWN_TRANSACTION") && !String(error).includes("TIMEOUT")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  return last;
}
