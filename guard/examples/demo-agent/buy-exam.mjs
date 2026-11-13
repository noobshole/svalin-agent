// The buying exam: the demo agent asks a vault on NEAR testnet to buy tokens, once honestly and then
// with three tricks, and prints what the vault did with each.
//
//   VAULT=vault.example.testnet AGENT_KEY=~/.svalin/agent.json node buy-exam.mjs [results.json]
//
// The grades and their proofs come from Svalin's API, and the vault asks the registry on NEAR to
// confirm each one. The vault needs buying rules that approve TOKEN in pool POOL, and test USDC.
// Every row is a real testnet transaction. On the test network the market is a stand-in that keeps
// what it is sent, since the tokens the Index grades trade only on mainnet.
//
// The forged grade counts toward the freeze: three look-alikes or forged grades within an hour
// freeze the vault, and the other exams make look-alikes too.
import { writeFileSync } from "node:fs";

import { DemoAgent } from "./agent.mjs";
import { loadKey, steadyFetch, view } from "./near.mjs";

const VAULT = process.env.VAULT;
const KEY_FILE = process.env.AGENT_KEY;
if (!VAULT || !KEY_FILE) throw new Error("usage: VAULT=<vault> AGENT_KEY=<key file> node buy-exam.mjs [results.json]");
const API = process.env.SVALIN_API ?? "https://svalin-api.noobshole.workers.dev";
const TOKEN = process.env.TOKEN ?? "token.rhealab.near";
const WEAK_TOKEN = process.env.WEAK_TOKEN ?? "a.alphaai.near";
const POOL = Number(process.env.POOL ?? 1);
const GRADES = ["A", "B", "C", "D", "F"];

const usdc = (atomic) => (Number(atomic) / 1e6).toFixed(2);

/** A token's grade in the latest sealed edition, with its Merkle proof, as the vault takes it. */
async function gradeOf(token) {
  const response = await steadyFetch(`${API}/v1/demo/proof/${token}`);
  if (!response.ok) return null;
  const { grade } = await response.json();
  return { day: grade.day, grade: grade.grade, backing_usd: grade.backing_usd, proof: grade.proof };
}

const key = loadKey(KEY_FILE, VAULT);
const status = await view(VAULT, "status");
if (status.frozen) throw new Error(`${VAULT} is frozen`);
if (!status.buying) throw new Error(`${VAULT} has buying switched off`);
if (!status.buying.pools?.some((pool) => pool.token === TOKEN && pool.pool_id === POOL)) throw new Error(`${VAULT} has not approved pool ${POOL} for ${TOKEN}`);
console.log(`Vault ${VAULT}, agent key ${key.publicKeyText}, buying grade ${status.buying.min_grade} or better`);

const real = await gradeOf(TOKEN);
if (!real) throw new Error(`${API} has no grade for ${TOKEN}`);
// A token below the owner's minimum. The vault refuses it on the grade alone, before any proof.
const weak = (await gradeOf(WEAK_TOKEN)) ?? { day: real.day, grade: "F", backing_usd: 0, proof: [] };
// The real proof with a better grade written over it, or with more backing if the grade is already the best.
const forged = real.grade === "A" ? { ...real, backing_usd: real.backing_usd * 10 } : { ...real, grade: "A" };

const scenes = [
  { trick: "honest", title: `Buys ${TOKEN}, graded ${real.grade}, in the approved pool`, token: TOKEN, amount: 100_000, poolId: POOL, grade: real },
  { trick: "weak-token", title: `Asks to buy ${WEAK_TOKEN}, graded ${weak.grade}`, token: WEAK_TOKEN, amount: 100_000, poolId: POOL, grade: weak },
  { trick: "other-pool", title: `Asks to buy ${TOKEN} in pool ${POOL + 998}, which the owner never approved`, token: TOKEN, amount: 100_000, poolId: POOL + 998, grade: real },
  // Another amount than the honest buy, or the vault would refuse it as a repeat before asking the registry.
  { trick: "forged-grade", title: `Claims ${TOKEN} is graded ${forged.grade} with $${forged.backing_usd.toLocaleString("en-US")} behind it`, token: TOKEN, amount: 120_000, poolId: POOL, grade: forged },
];

const agent = new DemoAgent({ vault: VAULT, key });
const rows = [];
for (const scene of scenes) {
  const result = await agent.buy(scene);
  const why = result.reasons.length ? ` ${result.reasons.join(", ")}` : "";
  const spent = result.outcome === "bought" ? `, the market used ${usdc(result.used)} USDC and Svalin's fee was ${Number(result.fee) / 1e6} USDC` : "";
  console.log(`${scene.trick}: ${usdc(scene.amount)} USDC for ${scene.token}: ${result.outcome}${why}${spent}  ${result.link}`);
  if (result.failures?.length) console.log(`  failure: ${result.failures[0]}`);
  rows.push({ trick: scene.trick, title: scene.title, token: scene.token, amount: String(scene.amount), pool: scene.poolId, claimed: { grade: scene.grade.grade, day: scene.grade.day, backing_usd: scene.grade.backing_usd }, ...result });
}

const total = (outcome) => rows.filter((row) => row.outcome === outcome).reduce((sum, row) => sum + BigInt(row.amount), 0n);
const summary = { asked: usdc(rows.reduce((sum, row) => sum + BigInt(row.amount), 0n)), bought: usdc(total("bought")), refused: usdc(total("refused")) };
console.log(`\nAsked to buy with ${summary.asked} USDC. Bought with ${summary.bought}, refused ${summary.refused}.`);
if (GRADES.indexOf(real.grade) > GRADES.indexOf(status.buying.min_grade)) console.log(`Note: ${TOKEN} is graded ${real.grade} today, below this vault's minimum, so the honest buy was refused too.`);
if ((await view(VAULT, "status")).frozen) console.log("The vault has frozen itself: that was the third look-alike or forged grade within an hour.");

if (process.argv[2]) {
  writeFileSync(process.argv[2], `${JSON.stringify({ vault: VAULT, api: API, at: new Date().toISOString(), summary, rows }, null, 2)}\n`);
}
