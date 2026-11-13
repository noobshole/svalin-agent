// The scam exam on Solana: the demo agent buys a portfolio risk report from Svalin's own API, a
// standard x402 seller, paying on Solana devnet through a vault on NEAR testnet; then it meets two
// tricks, and the vault decides each one.
//
//   VAULT=vault7.svalin-demo.testnet AGENT_KEY=~/.svalin/testnet-guard-agent7.json node solana-exam.mjs [results.json]
//
// The vault needs Solana settings and devnet USDC at its Solana address (`status().solana_address`).
// Every decision is a real NEAR testnet transaction, and the paid one is a real Solana devnet
// payment. The second scene holds the same purchase again only within 15 minutes of the first.
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { DemoAgent } from "./agent.mjs";
import { loadKey, steadyFetch, view } from "./near.mjs";
import { key, address } from "./solana.mjs";

const VAULT = process.env.VAULT ?? "vault7.svalin-demo.testnet";
const KEY_FILE = process.env.AGENT_KEY ?? join(homedir(), ".svalin", "testnet-guard-agent7.json");
const API = process.env.SVALIN_API ?? "https://svalin-api.noobshole.workers.dev";
const WALLET = process.env.WALLET ?? "v2.ref-finance.near";
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 8412);

const usdc = (atomic) => (Number(atomic) / 1e6).toFixed(3);

/** An address that starts and ends like `real`, as address poisoning makes them. */
function lookAlike(real) {
  for (const char of "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz") {
    const fake = real.slice(0, 20) + char + real.slice(21);
    try {
      if (fake !== real && address(key(fake)) === fake) return fake;
    } catch {
      // Not 32 bytes: try the next character.
    }
  }
  throw new Error("no look-alike found");
}

/** A seller that only quotes: it asks to be paid at `payTo`, copying a real 402 answer. */
function startFakeSeller(required, payTo) {
  const quote = { ...required, resource: { ...required.resource, url: `http://127.0.0.1:${FAKE_PORT}/v1/risk/${WALLET}` }, accepts: required.accepts.map((accept) => ({ ...accept, payTo })) };
  const server = createServer((_, response) => {
    response.writeHead(402, { "content-type": "application/json", "payment-required": Buffer.from(JSON.stringify(quote)).toString("base64") });
    response.end("{}");
  });
  return new Promise((resolve) => server.listen(FAKE_PORT, "127.0.0.1", () => resolve(server)));
}

const agentKey = loadKey(KEY_FILE, VAULT);
const agent = new DemoAgent({ vault: VAULT, key: agentKey });
const solana = await agent.solana();
console.log(`Vault ${VAULT}, Solana address ${solana.address} (${solana.network}), agent key ${agentKey.publicKeyText}`);

const url = `${API}/v1/risk/${WALLET}`;
const first = await steadyFetch(url);
const required = JSON.parse(Buffer.from(first.headers.get("payment-required"), "base64").toString("utf8"));
const realPayTo = required.accepts.find((accept) => accept.network === solana.network)?.payTo;
if (!realPayTo) throw new Error(`${API} takes no payment on ${solana.network}`);
const poisoned = lookAlike(realPayTo);
const fake = await startFakeSeller(required, poisoned);

const scenes = [
  { trick: "honest", url, title: "Buys Svalin's risk report, paying on Solana" },
  { trick: "charge-again", url, title: "Asked to pay for the same report again", source: "charged again" },
  { trick: "address-poisoning", url: `http://127.0.0.1:${FAKE_PORT}/v1/risk/${WALLET}`, title: `Asked to pay ${poisoned}, which starts and ends like Svalin's address`, source: "address poisoning" },
];

const rows = [];
try {
  for (const scene of scenes) {
    const result = await agent.getSolana(scene.url);
    const payment = result.payment;
    const why = payment.reasons?.length ? ` ${payment.reasons.join(", ")}` : "";
    console.log(`${scene.trick}: ${usdc(result.quote?.amount ?? 0)} USDC to ${result.quote?.payTo}: ${payment.outcome}${why}  ${payment.link ?? ""}`);
    if (payment.solanaLink) console.log(`  paid on Solana: ${payment.solanaLink}`);
    if (result.status === 200) console.log(`  the report: grade ${result.body?.grade ?? "none"}, score ${result.body?.score ?? "none"}`);
    if (payment.failures?.length) console.log(`  failure: ${payment.failures[0]}`);
    rows.push({ ...scene, status: result.status, quote: result.quote, payment: { ...payment, answer: undefined, transaction: undefined } });
  }
} finally {
  fake.close();
}

const total = (outcomes) => rows.filter((row) => outcomes.includes(row.payment.outcome)).reduce((sum, row) => sum + BigInt(row.quote?.amount ?? 0), 0n);
const summary = { asked: usdc(total(["paid", "held", "refused"])), paid: usdc(total(["paid"])), stopped: usdc(total(["held", "refused"])) };
console.log(`\nAsked ${summary.asked} USDC on Solana. Paid ${summary.paid}, stopped ${summary.stopped}.`);
console.log(`Locked terms: ${JSON.stringify(await view(VAULT, "services", {}))}`);
if (process.argv[2]) {
  writeFileSync(process.argv[2], `${JSON.stringify({ vault: VAULT, solana, api: API, at: new Date().toISOString(), summary, rows }, null, 2)}\n`);
}
