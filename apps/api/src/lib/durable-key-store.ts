/**
 * Svalin keys on Cloudflare Workers. Every isolate asks one Durable Object, which runs each
 * request on its own, so two calls can never spend the same last call or claim the same payment.
 */
import { KeyStoreCore, type KeyStore, type KvStorage } from "./key-store.js";
import type { DemoLimiterNamespace } from "./durable-demo-limiter.js";

type Method = keyof KeyStore;
const METHODS = new Set<Method>([
  "use",
  "refund",
  "status",
  "issue",
  "extend",
  "claim",
  "reserveNear",
  "pending",
  "claimNear",
  "unread",
  "markRead",
  "throttle",
]);

/** Durable Object class (binding KEY_STORE in wrangler.toml). */
export class KeyStoreObject {
  private readonly core: KeyStoreCore;

  constructor(state: { storage: KvStorage }) {
    this.core = new KeyStoreCore(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const { method, args } = (await request.json()) as { method: Method; args: unknown[] };
    if (!METHODS.has(method)) return new Response("unknown method", { status: 400 });
    const call = this.core[method] as (...values: unknown[]) => Promise<unknown>;
    const result = await call.apply(this.core, args);
    return Response.json(result === undefined ? null : result);
  }
}

/** Client used by the API. A store that does not answer is an error (503), never a free pass. */
export class DurableKeyStore implements KeyStore {
  constructor(private readonly namespace: DemoLimiterNamespace | undefined) {}

  private async call<T>(method: Method, args: unknown[]): Promise<T> {
    if (!this.namespace) throw new Error("KEY_STORE binding missing");
    const stub = this.namespace.get(this.namespace.idFromName("keys"));
    const response = await stub.fetch("https://key-store/call", { method: "POST", body: JSON.stringify({ method, args }) });
    if (!response.ok) throw new Error(`key store ${response.status}`);
    return (await response.json()) as T;
  }

  use: KeyStore["use"] = (...args) => this.call("use", args);
  refund: KeyStore["refund"] = (...args) => this.call("refund", args);
  status: KeyStore["status"] = (...args) => this.call("status", args);
  issue: KeyStore["issue"] = (...args) => this.call("issue", args);
  extend: KeyStore["extend"] = (...args) => this.call("extend", args);
  claim: KeyStore["claim"] = (...args) => this.call("claim", args);
  reserveNear: KeyStore["reserveNear"] = (...args) => this.call("reserveNear", args);
  pending: KeyStore["pending"] = (...args) => this.call("pending", args);
  claimNear: KeyStore["claimNear"] = (...args) => this.call("claimNear", args);
  unread: KeyStore["unread"] = (...args) => this.call("unread", args);
  markRead: KeyStore["markRead"] = (...args) => this.call("markRead", args);
  throttle: KeyStore["throttle"] = (...args) => this.call("throttle", args);
}
