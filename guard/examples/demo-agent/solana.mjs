// Solana for the demo agent, in plain Node (22 or newer) with no packages: token account addresses,
// the payment a vault writes (so the agent can check what it was handed), the transaction a seller
// receives, and a few devnet calls.
//
// The vault pays on Solana through NEAR Chain Signatures: its Solana address is derived from the
// vault's NEAR account, nobody holds that key, and NEAR's signing network signs only the payments
// the vault's code writes. The seller's facilitator pays the Solana fee and signs as fee payer.
import { createHash } from "node:crypto";
import { base58Decode, base58Encode, steadyFetch } from "./near.mjs";

/** CAIP-2 network ids, as x402 names them. */
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const SOLANA_EXPLORER = process.env.SOLANA_EXPLORER ?? "https://explorer.solana.com/tx/";

export const PROGRAMS = {
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
};

/** The compute budget x402's own Solana client sets, so the vault's payment looks like any other. */
export const COMPUTE_UNIT_LIMIT = 20_000;
export const COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1;

export function address(bytes) {
  return base58Encode(bytes);
}

export function key(text) {
  const bytes = base58Decode(text);
  if (bytes.length !== 32) throw new Error(`not a Solana address: ${text}`);
  return bytes;
}

/* ------------------------------ the address math ------------------------------ */

const P = 2n ** 255n - 19n;
const D = (-121665n * inverse(121666n)) % P;

function mod(value) {
  const result = value % P;
  return result < 0n ? result + P : result;
}

function power(base, exponent) {
  let result = 1n;
  base = mod(base);
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % P;
    base = (base * base) % P;
    exponent >>= 1n;
  }
  return result;
}

function inverse(value) {
  return power(value, P - 2n);
}

/**
 * Whether 32 bytes are a point on the ed25519 curve, as Solana decides it: a program address must
 * not be one, since nobody may hold a key for it. y is the little-endian number without the sign
 * bit; the point exists when (y² - 1) / (d·y² + 1) has a square root.
 */
export function isOnCurve(bytes) {
  const le = Buffer.from(bytes);
  le[31] &= 0x7f;
  const y = mod(BigInt(`0x${Buffer.from(le).reverse().toString("hex")}`));
  const y2 = (y * y) % P;
  const ratio = mod((y2 - 1n) * inverse(mod(D * y2 + 1n)));
  return ratio === 0n || power(ratio, (P - 1n) / 2n) === 1n;
}

/** Solana's `find_program_address`: the first bump, from 255 down, whose hash is off the curve. */
export function findProgramAddress(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash("sha256")
      .update(Buffer.concat([...seeds.map((seed) => Buffer.from(seed)), Buffer.from([bump]), key(programId), Buffer.from("ProgramDerivedAddress")]))
      .digest();
    if (!isOnCurve(hash)) return { address: address(hash), bump };
  }
  throw new Error("no program address found");
}

/** A wallet's token account for `mint`: where x402 sends a payment to `owner`. */
export function tokenAccount(owner, mint, tokenProgram = PROGRAMS.token) {
  return findProgramAddress([key(owner), key(tokenProgram), key(mint)], PROGRAMS.associatedToken).address;
}

/* ------------------------------ the payment itself ------------------------------ */

function compactU16(value) {
  const bytes = [];
  for (;;) {
    let byte = value & 0x7f;
    value >>= 7;
    if (value === 0) {
      bytes.push(byte);
      return Buffer.from(bytes);
    }
    bytes.push(byte | 0x80);
  }
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

/**
 * The message a vault signs for one x402 payment, byte for byte as the vault writes it: a v0
 * message with the fee payer first, the vault's address as the only other signer, then x402's fixed
 * order of instructions (compute limit, compute price, one `TransferChecked`, a memo).
 */
export function paymentMessage({ feePayer, authority, source, destination, mint, tokenProgram = PROGRAMS.token, amount, decimals, memo, blockhash }) {
  const accounts = [feePayer, authority, source, destination, mint, tokenProgram, PROGRAMS.computeBudget, PROGRAMS.memo].map(key);
  const instruction = (program, indexes, data) => Buffer.concat([Buffer.from([program]), compactU16(indexes.length), Buffer.from(indexes), compactU16(data.length), data]);
  const instructions = [
    instruction(6, [], Buffer.concat([Buffer.from([2]), u32(COMPUTE_UNIT_LIMIT)])),
    instruction(6, [], Buffer.concat([Buffer.from([3]), u64(COMPUTE_UNIT_PRICE_MICROLAMPORTS)])),
    instruction(5, [2, 4, 3, 1], Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([decimals])])),
    instruction(7, [], Buffer.from(memo, "utf8")),
  ];
  return Buffer.concat([
    // Version 0, then two signers of which one (the vault) only reads, and four read-only accounts.
    Buffer.from([0x80, 2, 1, 4]),
    compactU16(accounts.length),
    ...accounts,
    key(blockhash),
    compactU16(instructions.length),
    ...instructions,
    compactU16(0),
  ]);
}

/**
 * The transaction a seller gets: two signature slots, the fee payer's still empty (its facilitator
 * signs there), then the vault's, then the message. Base64, as x402's `payload.transaction`.
 */
export function partlySignedTransaction(message, vaultSignature) {
  if (vaultSignature.length !== 64) throw new Error("expected a 64-byte signature");
  return Buffer.concat([compactU16(2), Buffer.alloc(64), Buffer.from(vaultSignature), Buffer.from(message)]).toString("base64");
}

/* ----------------------------------- devnet ----------------------------------- */

async function rpc(method, params) {
  // Reads only, so asking again after a dropped connection is safe.
  const response = await steadyFetch(SOLANA_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "svalin-demo", method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 400)}`);
  return body.result;
}

export async function latestBlockhash() {
  const result = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  return result.value.blockhash;
}

/** A token account's balance in the token's smallest unit, or null when it does not exist yet. */
export async function tokenBalance(account) {
  try {
    const result = await rpc("getTokenAccountBalance", [account, { commitment: "confirmed" }]);
    return BigInt(result.value.amount);
  } catch (error) {
    if (String(error).includes("could not find account") || String(error).includes("Invalid param")) return null;
    throw error;
  }
}
