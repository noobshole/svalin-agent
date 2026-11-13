// Sends a Solana withdrawal that has finished its wait. A signed Solana payment expires in about a
// minute, so this collects it with the agent's key and asks an x402 facilitator to settle it in one
// go; the vault needs no SOL. The agent can change neither the address nor the amount.
//
//   AGENT_KEY=~/.svalin/testnet-guard-agent7.json node withdraw-solana.mjs vault7.svalin-demo.testnet
//
// If the owner collected it on the dashboard, add that NEAR transaction's hash. That needs no key:
// the signature is already public on NEAR, and the payment can only go where the vault wrote it.
//
//   node withdraw-solana.mjs vault7.svalin-demo.testnet <NEAR transaction hash>
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import { call, loadKey, settled, view } from "./near.mjs";
import { SOLANA_DEVNET, SOLANA_EXPLORER, address, latestBlockhash, tokenAccount } from "./solana.mjs";

const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
const FEE_PAYER = process.env.FEE_PAYER ?? "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const [vault, givenHash] = process.argv.slice(2);
if (!vault) throw new Error("usage: node withdraw-solana.mjs <vault> [<NEAR transaction hash>]");

const status = await view(vault, "status");
let hash = givenHash;
let sender = status.owner;
if (!hash) {
  const waiting = status.solana_withdrawal;
  if (!waiting) throw new Error("No Solana withdrawal has finished its wait.");
  const key = loadKey(process.env.AGENT_KEY ?? join(homedir(), ".svalin", "testnet-guard-agent7.json"), vault);
  sender = vault;
  const transaction = {
    fee_payer: FEE_PAYER,
    recent_blockhash: await latestBlockhash(),
    source: tokenAccount(status.solana_address, status.solana.mint),
    destination: tokenAccount(waiting.to, status.solana.mint),
  };
  hash = await call(key, vault, "collect_solana_withdrawal", { memo: randomBytes(16).toString("hex"), transaction }, { gas: 120_000_000_000_000n });
}

const { events, failures, value } = await settled(hash, sender, (_, answer) => answer !== undefined);
const signed = events.find((event) => event.standard === "svalin-guard" && event.event === "solana_signed")?.data[0];
if (!signed || !value?.payment) throw new Error(`That transaction holds no signed Solana payment. ${failures?.[0] ?? ""}`);

// A two-signature v0 message: the fee payer is the first account after the header.
const wire = Buffer.from(value.payment.transaction, "base64");
const requirements = {
  scheme: "exact",
  network: status.solana.network,
  amount: signed.amount,
  asset: status.solana.mint,
  payTo: signed.payee.replace(/^solana:/, ""),
  maxTimeoutSeconds: 60,
  extra: { feePayer: address(wire.subarray(1 + 128 + 5, 1 + 128 + 5 + 32)) },
};
const response = await fetch(`${FACILITATOR}/settle`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ x402Version: 2, paymentPayload: { x402Version: 2, accepted: requirements, payload: { transaction: value.payment.transaction } }, paymentRequirements: requirements }),
});
const answer = await response.json();
if (!answer.success) throw new Error(`Not settled: ${JSON.stringify(answer).slice(0, 400)}. A signed payment lasts about a minute; if it expired, propose the withdrawal again.`);
const cluster = status.solana.network === SOLANA_DEVNET ? "?cluster=devnet" : "";
console.log(`Sent ${Number(signed.amount) / 1e6} USDC to ${requirements.payTo}: ${SOLANA_EXPLORER}${answer.transaction}${cluster}`);
