// Makes a key for your agent. The private half is saved to a file only the agent reads; the
// public half is printed, to paste into the vault page. Plain Node (22 or newer), no packages.
//
//   node new-key.mjs ~/.svalin/my-agent.json
//
// The file has the shape near-cli writes, `{ account_id, public_key, private_key }`, with no
// account: the agent signs for the vault it is given (VAULT=...). It never overwrites a file.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { base58Encode } from "./near.mjs";

const asked = process.argv[2] ?? "~/.svalin/agent-key.json";
const file = resolve(asked.replace(/^~(?=$|[\\/])/, homedir()));
if (existsSync(file)) {
  console.error(`${file} already exists. Choose another file name: this script never overwrites a key.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
const record = {
  account_id: "",
  public_key: `ed25519:${base58Encode(pub)}`,
  private_key: `ed25519:${base58Encode(Buffer.concat([seed, pub]))}`,
};

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });

console.log(`Saved the agent's key to ${file}`);
console.log("Keep that file private and on the computer that runs the agent. Never paste it anywhere.\n");
console.log("The agent's public key, to paste into the vault page:");
console.log(record.public_key);
