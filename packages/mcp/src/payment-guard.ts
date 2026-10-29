import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { decodePaymentRequiredHeader } from "@x402/core/http";

import { atomicToUsd } from "./budget.js";

/**
 * The payment guard judges an x402 payment request before anything is signed. x402 assumes the
 * server is honest; a hostile or hijacked one can raise its price, ask for a different token, or
 * name a new address to be paid. The guard remembers each service's payee and price the first time
 * it sees them, compares every later request with them, and leaves the on-chain check of the payee
 * to Svalin's recipient check. It only reads: the wallet that pays is never touched.
 */

/** USDC on the networks x402 settles on most, as the x402 packages' own default assets. */
export const USDC_BY_NETWORK: Readonly<Record<string, string>> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "near:mainnet": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "near:testnet": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/** Networks whose payees Svalin's recipient check can read (it reads mainnet only). */
export const CHECKABLE_NETWORKS: Readonly<Record<string, "solana" | "near">> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana",
  "near:mainnet": "near",
};

/** x402 v1 named its networks; v2 uses CAIP-2. */
const V1_NETWORKS: Readonly<Record<string, string>> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

/**
 * A hostile service controls every byte of its payment request. These limits keep it from
 * exhausting memory, and only text made of these characters is ever passed back to the agent,
 * so a "payee" cannot carry instructions.
 */
const MAX_HEADER_CHARS = 16 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_OPTIONS = 10;
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;

/** What a payee address looks like on each network family. */
const PAYEE_FORMATS: readonly [string, RegExp][] = [
  ["solana:", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/],
  ["near:", /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/],
  ["eip155:", /^0x[0-9a-fA-F]{40}$/],
];

/** The same request checked again within this many minutes is a possible "payment failed, pay again". */
export const REPEAT_WINDOW_MINUTES = 15;

/** A price this many times the remembered one gets a caution, and this many times a block. */
export const PRICE_JUMP_CAUTION = 2n;
export const PRICE_JUMP_BLOCK = 10n;

export type PaymentOption = { network: string; asset: string; amount: bigint; payTo: string };
export type PaymentRequest = { resourceUrl: string | null; options: PaymentOption[] };

export type GuardSeverity = "block" | "caution" | "info";
export type GuardReason = { code: string; severity: GuardSeverity; message: string };
export type GuardVerdict = "allow" | "caution" | "block";

/** What a service asked for the first time the guard saw it, per network. */
export type ServicePin = { payTo: string; asset: string; amount: string; firstSeen: string };
type PinFile = Record<string, Record<string, ServicePin>>;

/** The x402 payment request in a 402 response (v2 header or v1 body), or null when it is not one. */
export async function readPaymentRequest(response: Response): Promise<PaymentRequest | null> {
  if (response.status !== 402) return null;
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (header) {
    if (header.length > MAX_HEADER_CHARS) throw new Error("The payment request is too large to read.");
    const required = decodePaymentRequiredHeader(header);
    return {
      resourceUrl: typeof required.resource?.url === "string" ? required.resource.url : null,
      options: (Array.isArray(required.accepts) ? required.accepts.slice(0, MAX_OPTIONS) : []).flatMap((accept) =>
        option(accept.network, accept.asset, accept.amount, accept.payTo),
      ),
    };
  }
  let body: { x402Version?: number; accepts?: { network?: string; asset?: string; maxAmountRequired?: string; payTo?: string; resource?: string }[] } | null;
  try {
    body = JSON.parse(await readLimited(response, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof TooLarge) throw error;
    return null;
  }
  if (body?.x402Version !== 1 || !Array.isArray(body.accepts)) return null;
  const accepts = body.accepts.slice(0, MAX_OPTIONS);
  return {
    resourceUrl: typeof accepts[0]?.resource === "string" ? accepts[0].resource : null,
    options: accepts.flatMap((accept) =>
      option(V1_NETWORKS[accept.network ?? ""] ?? accept.network, accept.asset, accept.maxAmountRequired, accept.payTo),
    ),
  };
}

class TooLarge extends Error {}

/** The body as text, refusing to read more than `maxBytes`. */
async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new TooLarge("The payment request is too large to read.");
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** One way to pay, kept only when every field is plain address-like text. */
function option(network: unknown, asset: unknown, amount: unknown, payTo: unknown): PaymentOption[] {
  if (typeof network !== "string" || typeof asset !== "string" || typeof payTo !== "string") return [];
  if (![network, asset, payTo].every((value) => SAFE_TOKEN.test(value))) return [];
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount)) return [];
  return [{ network, asset, amount: BigInt(amount), payTo }];
}

const sameAddress = (network: string, left: string, right: string) =>
  network.startsWith("eip155:") ? left.toLowerCase() === right.toLowerCase() : left === right;

/** USDC amounts in USD; null when the asset is not USDC, so the amount means nothing in dollars. */
export function amountUsd(option: PaymentOption): number | null {
  const usdc = USDC_BY_NETWORK[option.network];
  return usdc && sameAddress(option.network, usdc, option.asset) ? Number(option.amount) / 1e6 : null;
}

/**
 * Judges one way to pay against what the guard remembers and what the caller expects. Pure: the
 * caller loads the pin and runs the on-chain payee check.
 */
export function judgePayment(input: {
  requestedUrl: string;
  request: PaymentRequest;
  option: PaymentOption;
  pin: ServicePin | undefined;
  expectedUsd?: number;
  maxUsd?: number;
  memoryFile?: string;
  /** Minutes since this same request (service, URL, payee, amount) was last checked; undefined if not recently. */
  repeatedAfterMinutes?: number;
}): GuardReason[] {
  const { option, pin } = input;
  const reasons: GuardReason[] = [];

  if (input.repeatedAfterMinutes !== undefined) {
    const ago = input.repeatedAfterMinutes < 1 ? "under a minute" : `${Math.round(input.repeatedAfterMinutes)} minute${Math.round(input.repeatedAfterMinutes) === 1 ? "" : "s"}`;
    reasons.push({
      code: "repeat-request",
      severity: "caution",
      message:
        `This exact payment (same site, payee and amount) was checked ${ago} ago. If the service now says the first payment failed, ` +
        "confirm on-chain that it really did before paying again: \"payment failed, pay again\" is a common trick.",
    });
  }
  const usdc = USDC_BY_NETWORK[option.network];
  const usd = amountUsd(option);
  const price = usd === null ? `${option.amount} units of ${option.asset}` : atomicToUsd(option.amount);

  const format = PAYEE_FORMATS.find(([prefix]) => option.network.startsWith(prefix))?.[1];
  if (format && !format.test(option.payTo)) {
    reasons.push({ code: "malformed-payee", severity: "block", message: `${option.payTo} is not a valid address on ${option.network}.` });
  }

  if (!usdc) {
    reasons.push({
      code: "unknown-network",
      severity: "caution",
      message: `Svalin does not know USDC's address on ${option.network}, so it cannot confirm which token or how much is asked for.`,
    });
  } else if (usd === null) {
    reasons.push({ code: "not-usdc", severity: "block", message: `It asks to be paid in ${option.asset}, which is not USDC on ${option.network}.` });
  }

  if (usd !== null && input.maxUsd !== undefined && usd > input.maxUsd) {
    reasons.push({ code: "over-limit", severity: "block", message: `It asks ${price}, above your limit of $${input.maxUsd}.` });
  }
  if (usd !== null && input.expectedUsd !== undefined && usd > input.expectedUsd) {
    const inflated = usd >= input.expectedUsd * 2;
    reasons.push({
      code: inflated ? "price-inflated" : "price-above-expected",
      severity: inflated ? "block" : "caution",
      message: `It asks ${price}; you expected $${input.expectedUsd}.`,
    });
  }

  const requested = safeOrigin(input.requestedUrl);
  const resource = input.request.resourceUrl ? safeOrigin(input.request.resourceUrl) : null;
  if (resource && requested && resource !== requested) {
    reasons.push({
      code: "resource-mismatch",
      severity: "caution",
      message: `The payment is for ${resource}, not the site you called (${requested}): a proxy or redirect may be in between.`,
    });
  }

  if (!pin) {
    reasons.push({ code: "new-service", severity: "info", message: "First payment request seen from this service on this network. Its payee and price are remembered from now on." });
    return reasons;
  }
  if (!sameAddress(option.network, pin.payTo, option.payTo)) {
    reasons.push({
      code: "payee-changed",
      severity: "block",
      message:
        `This service asked to be paid at ${pin.payTo} since ${pin.firstSeen.slice(0, 10)}; now it names ${option.payTo}. ` +
        `If the service really moved, its owner should confirm it, then delete the service's entry in ${input.memoryFile ?? "the payee memory file"}.`,
    });
  }
  const before = BigInt(pin.amount);
  if (before > 0n && sameAddress(option.network, pin.asset, option.asset) && option.amount >= before * PRICE_JUMP_CAUTION) {
    const block = option.amount >= before * PRICE_JUMP_BLOCK;
    reasons.push({
      code: "price-jump",
      severity: block ? "block" : "caution",
      message: `It asks ${price}; the first time it asked ${usd === null ? `${pin.amount} units` : atomicToUsd(before)}.`,
    });
  }
  if (!reasons.some((reason) => reason.severity !== "info")) {
    reasons.push({ code: "known-service", severity: "info", message: `Same payee as first seen on ${pin.firstSeen.slice(0, 10)}.` });
  }
  return reasons;
}

export function verdictOf(reasons: GuardReason[]): GuardVerdict {
  if (reasons.some((reason) => reason.severity === "block")) return "block";
  return reasons.some((reason) => reason.severity === "caution") ? "caution" : "allow";
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const defaultMemoryFile = () => join(homedir(), ".svalin", "payees.json");

/**
 * The payees and prices first seen per service, in a JSON file the owner can read and edit. A pin is
 * never overwritten here, so neither a later request nor an agent can move it; only the owner can,
 * by deleting the entry.
 */
export class PayeeMemory {
  /** When each payment request was last checked in this session, by service, URL, payee and amount. */
  private readonly checked = new Map<string, number>();

  constructor(readonly file: string = defaultMemoryFile()) {}

  /**
   * Records a check of this request and returns the minutes since the same request was last checked,
   * if that was within REPEAT_WINDOW_MINUTES. Kept in memory: a repeat matters within a session.
   */
  noteCheck(service: string, url: string, option: PaymentOption, now = Date.now()): number | undefined {
    const key = [service, url, option.network, option.payTo, option.asset, option.amount.toString()].join("|");
    const last = this.checked.get(key);
    this.checked.set(key, now);
    if (this.checked.size > 500) this.checked.delete(this.checked.keys().next().value as string);
    const minutes = last === undefined ? undefined : (now - last) / 60_000;
    return minutes !== undefined && minutes <= REPEAT_WINDOW_MINUTES ? minutes : undefined;
  }

  private read(): PinFile {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${this.file} is not a payee memory file.`);
    return parsed as PinFile;
  }

  get(service: string, network: string): ServicePin | undefined {
    return this.read()[service]?.[network];
  }

  /** Remembers a service's payee and price on a network, unless one is remembered already. */
  remember(service: string, option: PaymentOption, now = new Date()): void {
    const pins = this.read();
    if (pins[service]?.[option.network]) return;
    pins[service] = {
      ...pins[service],
      [option.network]: { payTo: option.payTo, asset: option.asset, amount: option.amount.toString(), firstSeen: now.toISOString() },
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(pins, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}

/** The service a payment request belongs to: the origin of the URL being paid for. */
export function serviceOf(url: string): string {
  return safeOrigin(url) ?? url;
}
