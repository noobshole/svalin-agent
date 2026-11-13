// A small client for NEAR AI Cloud (OpenAI-compatible) in plain Node, with the checks that tie
// each answer to a model running in a TEE:
//
// - attest(): asks for the model's attestation report with a fresh nonce, and keeps the model's
//   ed25519 signing key from it. The report carries Intel TDX and NVIDIA GPU evidence; this client
//   checks the nonce and that the report is there, and leaves the hardware quote to NEAR AI's own
//   verifiers (see the README).
// - chat(): sends the exact request bytes and keeps the exact response bytes, so their SHA-256 can
//   be compared with what the model signed.
// - signature(): fetches the model's signature over "<model>:<sha256 request>:<sha256 response>",
//   checks the signed text against our own hashes, checks the ed25519 signature, and checks that
//   the signer is the key from the attestation.
//
// The API key comes from NEAR_AI_API_KEY or ~/.svalin/near-ai.env and is never printed.
//
// OpenRouterModel, at the end, is the plain alternative: the same chat call to an ordinary hosted
// model, with no TEE, no attestation and no signature. Its key comes from OPENROUTER_API_KEY or
// ~/.svalin/openrouter.env.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { steadyFetch } from "./near.mjs";

export const API = process.env.NEAR_AI_URL ?? "https://cloud-api.near.ai/v1";

/** A key from the environment, or from a `NAME=value` line in a file under ~/.svalin. */
function keyFrom(name, fileName) {
  if (process.env[name]) return process.env[name].trim();
  const file = join(homedir(), ".svalin", fileName);
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  const key = line?.slice(name.length + 1).trim();
  if (!key || /\s|["']/.test(key)) throw new Error(`${file} has no usable ${name} line`);
  return key;
}

export const loadApiKey = () => keyFrom("NEAR_AI_API_KEY", "near-ai.env");

/** One chat completion on an OpenAI-compatible API; keeps the exact bytes sent and received. */
async function complete(api, headers, model, messages, { temperature = 0, maxTokens = 1000, json = true } = {}) {
  const body = JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, ...(json ? { response_format: { type: "json_object" } } : {}) });
  // Asking again after a dropped connection makes a new answer; only the one that arrives is used.
  const response = await steadyFetch(`${api}/chat/completions`, { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Accept-Encoding": "identity" }, body }, { timeoutMs: 180_000 });
  const raw = Buffer.from(await response.arrayBuffer());
  // A model that does not take the JSON setting is asked again without it; the prompt asks for JSON anyway.
  if (response.status === 400 && json && /response_format/i.test(raw.toString("utf8"))) return complete(api, headers, model, messages, { temperature, maxTokens, json: false });
  if (!response.ok) throw new Error(`${new URL(api).hostname} answered ${response.status}: ${raw.toString("utf8").slice(0, 200)}`);
  const result = JSON.parse(raw.toString("utf8"));
  return {
    id: result.id,
    content: result.choices?.[0]?.message?.content ?? "",
    usage: result.usage,
    finish: result.choices?.[0]?.finish_reason,
    requestHash: sha256(Buffer.from(body, "utf8")),
    responseHash: sha256(raw),
  };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (text) => String(text).replace(/^0x/, "");

function ed25519Key(publicHex) {
  // An ed25519 public key in DER: the fixed SubjectPublicKeyInfo prefix, then the 32 key bytes.
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex(publicHex), "hex")]), format: "der", type: "spki" });
}

export class NearAiModel {
  constructor({ model, apiKey = loadApiKey() }) {
    this.model = model;
    this.apiKey = apiKey;
    this.signers = new Set();
  }

  headers(extra = {}) {
    return { Accept: "application/json", Authorization: `Bearer ${this.apiKey}`, "x-no-aliasing": "true", ...extra };
  }

  /** The model's attestation report, asked for with a fresh nonce; keeps its signing keys. */
  async attest() {
    const nonce = randomBytes(32).toString("hex");
    const query = new URLSearchParams({ model: this.model, provider: "near", include_tls_fingerprint: "false", signing_algo: "ed25519", nonce });
    const response = await steadyFetch(`${API}/attestation/report?${query}`, { headers: this.headers() }, { timeoutMs: 60_000 });
    const report = await response.json();
    const reports = report.model_attestations ?? [];
    if (!response.ok || reports.length === 0) throw new Error(`${this.model} has no NEAR model attestation (${response.status})`);
    for (const entry of reports) {
      if (entry.request_nonce !== undefined && entry.request_nonce !== nonce) throw new Error("The attestation report does not echo our nonce");
      if (!entry.intel_quote) throw new Error("The attestation report has no Intel TDX quote");
      if (entry.signing_algo === "ed25519" && entry.signing_address) this.signers.add(hex(entry.signing_address));
    }
    if (this.signers.size === 0) throw new Error("The attestation report names no ed25519 signing key");
    return { model: this.model, nonce, signers: [...this.signers], gpu: reports.some((entry) => Boolean(entry.nvidia_payload)) };
  }

  /** One chat completion; returns the answer and the hashes of the exact bytes sent and received. */
  chat(messages, options) {
    return complete(API, this.headers(), this.model, messages, options);
  }

  /** The model's signature over one answer, checked against our hashes and the attested key. */
  async signature(answer) {
    let body;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await steadyFetch(`${API}/signature/${encodeURIComponent(answer.id)}?signing_algo=ed25519`, { headers: this.headers() });
      body = await response.json().catch(() => ({}));
      if (response.ok && body.signature && !body.error_code) break;
      body = undefined;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!body) return { verified: false, problem: "no signature" };
    const expected = `${this.model}:${answer.requestHash}:${answer.responseHash}`;
    const check = { kind: body.signature_kind, signer: hex(body.signing_address), text: body.text, signature: hex(body.signature) };
    if (body.signature_kind !== "provider_tee") return { ...check, verified: false, problem: "not signed inside the model's TEE" };
    if (body.text !== expected) return { ...check, verified: false, problem: "the signed text is not our request and answer" };
    if (!this.signers.has(check.signer)) return { ...check, verified: false, problem: "the signer is not the attested key" };
    const valid = verify(null, Buffer.from(body.text, "utf8"), ed25519Key(check.signer), Buffer.from(check.signature, "hex"));
    return valid ? { ...check, verified: true } : { ...check, verified: false, problem: "bad signature" };
  }
}

export const OPENROUTER_API = process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1";

/**
 * An ordinary hosted model on OpenRouter, for running the exam with a real model when there is no
 * NEAR AI Cloud credit. Nothing here is attested or signed: the exam says so on every step.
 */
export class OpenRouterModel {
  constructor({ model, apiKey = keyFrom("OPENROUTER_API_KEY", "openrouter.env") }) {
    this.model = model;
    this.apiKey = apiKey;
  }

  chat(messages, options) {
    return complete(OPENROUTER_API, { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` }, this.model, messages, options);
  }

  async signature() {
    return { verified: false, problem: "OpenRouter does not sign answers" };
  }
}
