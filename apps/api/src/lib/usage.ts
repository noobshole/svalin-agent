/**
 * Usage counts: one data point per request, saying which route it reached and how it ended. Counts
 * only: never an address, an IP, a key, a header or what a request asked for. On Cloudflare Workers
 * they go to Workers Analytics Engine (binding USAGE), which takes them without waiting and never
 * holds up or fails a request; elsewhere nothing is counted.
 */
import { detectAddressFamily } from "@svalin-agent/shared";

/**
 * How a request ended. `paid_x402` and `paid_key` are paid calls that were answered; `free` is any
 * other answer below 400; `payment_required` is the 402 that asks for a payment; `refused` is any
 * other 4xx, so nobody was charged; `error` is a 5xx.
 */
export type UsageOutcome = "paid_x402" | "paid_key" | "free" | "payment_required" | "refused" | "error";

export type UsageEvent = {
  /** The route's name, such as `risk` or `demo/check`; `other` for anything unknown. */
  route: string;
  outcome: UsageOutcome;
  /** The error code of a refusal, or a recipient check's verdict (`lookalike` when it caught one). */
  reason: string;
  /** The x402 network a paid call settled on (CAIP-2), `key` when a Svalin pass paid, or empty. */
  network: string;
  /** `solana` or `near` for routes about an address; empty otherwise. */
  chain: string;
};

export type UsageRecorder = { record(event: UsageEvent): void };

/** The part of the Workers Analytics Engine binding this file uses. */
export type AnalyticsDataset = {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
};

export const noUsage: UsageRecorder = { record() {} };

/** Writes each event as one data point: blob1 route, blob2 outcome, blob3 reason, blob4 network, blob5 chain. */
export class AnalyticsUsage implements UsageRecorder {
  constructor(private readonly dataset: AnalyticsDataset) {}

  record(event: UsageEvent) {
    try {
      this.dataset.writeDataPoint({
        indexes: [event.route],
        blobs: [event.route, event.outcome, event.reason, event.network, event.chain],
        doubles: [1],
      });
    } catch {
      // A count that cannot be written is dropped; the request it describes is unaffected.
    }
  }
}

/**
 * Names a request's route without its address: `/v1/risk/alice.near` is `risk`. Only the given
 * prefixes and exact paths are named, so nothing a caller typed can become a name.
 */
export function routeNamer(prefixes: string[], exact: string[]): (path: string) => { route: string; address: string | null } {
  const byLength = [...prefixes].sort((a, b) => b.length - a.length);
  const exactPaths = new Set(exact);
  return (path) => {
    const prefix = byLength.find((candidate) => path.startsWith(candidate) && path.length > candidate.length);
    if (prefix) return { route: nameOf(prefix), address: path.slice(prefix.length) };
    if (exactPaths.has(path)) return { route: path === "/" ? "root" : nameOf(path), address: null };
    return { route: "other", address: null };
  };
}

/** `/v1/demo/risk/` is `demo/risk`, `/openapi.json` is `openapi.json`. */
function nameOf(path: string): string {
  return path.replace(/^\/(v1\/)?/, "").replace(/\/$/, "");
}

/** `solana` or `near` for an address a route was asked about, never the address itself. */
export function chainOf(address: string | null): string {
  if (!address) return "";
  let decoded = address;
  try {
    decoded = decodeURIComponent(address);
  } catch {
    return "";
  }
  return detectAddressFamily(decoded) ?? "";
}
