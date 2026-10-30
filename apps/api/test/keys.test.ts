import { newSvalinKey, proReference } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { createApp, type ProPaymentFinder } from "../src/app.js";
import { MAX_ROUTE_DESCRIPTION_LENGTH, keyRouteDescription, KEY_PLAN_IDS } from "../src/catalog.js";
import { ApiError } from "../src/lib/errors.js";
import { KeyStoreCore, MemoryStorage } from "../src/lib/key-store.js";
import type { FoundPayment } from "../src/payments/pro-payments.js";
import { MockPortfolioSource } from "../src/sources/mock-source.js";
import { PAY_TO_NEAR, PAY_TO_SOLANA, SOLANA_WALLET, decodeHeader, fakeFacilitator, testConfig } from "./helpers.js";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const config = testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet" });

/** A facilitator that accepts every payment, and settles it unless told not to. */
function acceptingFacilitator(settles = true) {
  const facilitator = fakeFacilitator();
  facilitator.verify = async () => {
    facilitator.verifyCalls += 1;
    return { isValid: true, payer: "payer.testnet" } as never;
  };
  facilitator.settle = async (_payload, requirements) => {
    facilitator.settleCalls += 1;
    return (settles
      ? { success: true, transaction: "settled-tx", network: requirements.network, payer: "payer.testnet" }
      : { success: false, errorReason: "insufficient_funds", transaction: "", network: requirements.network }) as never;
  };
  return facilitator;
}

/** Pays the 402 a route answered, on NEAR testnet. */
async function paymentFor(response: Response) {
  const required = decodeHeader(response.headers.get("PAYMENT-REQUIRED"));
  const accepted = required.accepts.find((accept: { network: string }) => accept.network === "near:testnet");
  const payload = { x402Version: 2, resource: required.resource, accepted, payload: { signedDelegateAction: "signed" } };
  return { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64") };
}

async function buyKey(app: ReturnType<typeof createApp>, plan = "business", renew?: string) {
  const headers: Record<string, string> = renew ? { Authorization: `Bearer ${renew}` } : {};
  const unpaid = await app.request(`/v1/keys/${plan}`, { method: "POST", headers });
  return app.request(`/v1/keys/${plan}`, { method: "POST", headers: { ...headers, ...(await paymentFor(unpaid)) } });
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

describe("Svalin passes over x402", () => {
  it("sells Svalin Business over x402 for its price", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    const unpaid = await app.request("/v1/keys/business", { method: "POST" });
    expect(unpaid.status).toBe(402);
    const offers = decodeHeader(unpaid.headers.get("PAYMENT-REQUIRED")).accepts.map((accept: { network: string; amount: string }) => [accept.network, accept.amount]);
    expect(offers).toEqual(expect.arrayContaining([[DEVNET, "79000000"], ["near:testnet", "79000000"]]));

    const bought = await buyKey(app);
    expect(bought.status).toBe(200);
    const body = await bought.json();
    expect(body.key).toMatch(/^svk_[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(body.status).toMatchObject({ kind: "key", plan: "business", active: true, callsLeft: 200_000, callsPer: "period" });
  });

  it("sells agents the same Svalin Pro that people buy, at the monthly price", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    const unpaid = await app.request("/v1/keys/pro", { method: "POST" });
    expect(decodeHeader(unpaid.headers.get("PAYMENT-REQUIRED")).accepts[0].amount).toBe("5000000");
    const { key, status } = await (await buyKey(app, "pro")).json();
    expect(key).toMatch(/^svp_/);
    expect(status).toMatchObject({ kind: "pro", plan: "pro", active: true, callsLeft: 100, callsPer: "day" });
    expect((await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: bearer(key) })).headers.get("X-Calls-Left")).toBe("99");
  });

  it("renews a pass bought again with it: the days add on, and Business calls too", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    const pro = await (await buyKey(app, "pro")).json();
    const renewed = await (await buyKey(app, "pro", pro.key)).json();
    expect(renewed.key).toBe(pro.key);
    expect(Date.parse(renewed.status.until) - Date.parse(pro.status.until)).toBeGreaterThanOrEqual(30 * 86_400_000 - 5_000);

    const business = await (await buyKey(app, "business")).json();
    expect((await (await buyKey(app, "business", business.key)).json()).status.callsLeft).toBe(400_000);
  });

  it("refuses to renew an unknown key, or another kind of pass, before any payment", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    const unknown = await app.request("/v1/keys/pro", { method: "POST", headers: bearer(newSvalinKey("svp_")) });
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("PAYMENT-REQUIRED")).toBeNull();

    const { key } = await (await buyKey(app, "business")).json();
    const other = await app.request("/v1/keys/pro", { method: "POST", headers: bearer(key) });
    expect(other.status).toBe(409);
    expect(other.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it("lets the key pay for paid calls instead of x402, and counts them", async () => {
    const facilitator = acceptingFacilitator();
    const app = createApp(config, { facilitator });
    const { key } = await (await buyKey(app, "business")).json();
    const settled = facilitator.settleCalls;

    const report = await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: bearer(key) });
    expect(report.status).toBe(200);
    expect(report.headers.get("PAYMENT-REQUIRED")).toBeNull();
    expect(report.headers.get("X-Calls-Left")).toBe("199999");
    expect(facilitator.settleCalls).toBe(settled);

    const me = await app.request("/v1/keys/me", { headers: bearer(key) });
    expect(await me.json()).toMatchObject({ kind: "key", plan: "business", callsLeft: 199_999 });
  });

  it("never hands out a key whose payment did not settle", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator(false) });
    const response = await buyKey(app);
    expect(response.status).toBe(402);
    expect(JSON.stringify(await response.json())).not.toContain("svk_");
  });

  it("uses no call on a request that can only fail, and gives back a call that failed", async () => {
    const failing = new MockPortfolioSource();
    failing.getOverview = async () => {
      throw new ApiError(502, "upstream_unavailable", "Down.");
    };
    const app = createApp(config, { facilitator: acceptingFacilitator(), portfolioSource: failing });
    const { key } = await (await buyKey(app)).json();

    expect((await app.request("/v1/risk/Definitely-Not-Valid", { headers: bearer(key) })).status).toBe(400);
    expect((await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: bearer(key) })).status).toBe(502);
    expect((await (await app.request("/v1/keys/me", { headers: bearer(key) })).json()).callsLeft).toBe(200_000);
  });

  it("answers a malformed or unknown key with 401, never a payment request", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    for (const [authorization, code] of [
      ["Bearer nonsense", "invalid_key"],
      ["Basic abc", "invalid_key"],
      [`Bearer ${newSvalinKey("svk_")}`, "unknown_key"],
    ]) {
      const response = await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: { Authorization: authorization } });
      expect(response.status).toBe(401);
      expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
      expect((await response.json()).code).toBe(code);
    }
    expect((await app.request("/v1/keys/me")).status).toBe(401);
  });

  it("stops asking the key store about a caller whose keys keep being refused", async () => {
    const keyStore = new KeyStoreCore(new MemoryStorage());
    let storeCalls = 0;
    const use = keyStore.use.bind(keyStore);
    keyStore.use = async (...args) => (storeCalls++, use(...args));
    const app = createApp(config, { facilitator: acceptingFacilitator(), keyStore, clientIp: (c) => c.req.header("X-Test-Ip") ?? "1.1.1.1" });

    const statuses: number[] = [];
    for (let call = 0; call < 31; call += 1) {
      statuses.push((await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: bearer(newSvalinKey("svk_")) })).status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(storeCalls).toBe(30);
    expect((await app.request("/v1/keys/me", { headers: bearer(newSvalinKey("svk_")) })).status).toBe(429);
    // Another caller is still asked about.
    expect((await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: { ...bearer(newSvalinKey("svk_")), "X-Test-Ip": "2.2.2.2" } })).status).toBe(401);
    expect(storeCalls).toBe(31);
  });

  it("answers an unknown plan with 404 before any payment", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    const response = await app.request("/v1/keys/platinum", { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it("lists the keys with their prices, within the facilitator's description limit", async () => {
    const app = createApp(config, { facilitator: acceptingFacilitator() });
    const manifest = await (await app.request("/")).json();
    const keys = manifest.endpoints.filter((endpoint: { path: string }) => endpoint.path.startsWith("/v1/keys/"));
    expect(keys.map((endpoint: { method: string; path: string; price: string | null }) => [endpoint.method, endpoint.path, endpoint.price])).toEqual([
      ["POST", "/v1/keys/pro", "$5"],
      ["POST", "/v1/keys/business", "$79"],
      ["GET", "/v1/keys/me", null],
    ]);
    for (const plan of KEY_PLAN_IDS) expect(keyRouteDescription(plan, 100).length).toBeLessThanOrEqual(MAX_ROUTE_DESCRIPTION_LENGTH);
    const openapi = await (await app.request("/openapi.json")).json();
    expect(openapi.components.securitySchemes.svalinKey).toMatchObject({ type: "http", scheme: "bearer" });
    expect(openapi.paths["/v1/keys/business"].post["x-payment-info"].price.amount).toBe("79.000000");
  });
});

describe("Svalin Pro", () => {
  /** Finds the Solana payments a test hands it, made with this code's reference. */
  function finder(code: string, solana: FoundPayment[] = [], near: FoundPayment[] = []): ProPaymentFinder {
    return {
      solana: async (offer, reference) => {
        expect(offer).toMatchObject({ network: DEVNET, payTo: PAY_TO_SOLANA, mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" });
        return reference === (await proReference(code)) ? solana : [];
      },
      near: async () => near,
    };
  }
  const activate = (app: ReturnType<typeof createApp>, code: string) =>
    app.request("/v1/pro/activate", { method: "POST", body: JSON.stringify({ code }), headers: { "Content-Type": "application/json" } });

  it("says what Pro costs and where to pay", async () => {
    const app = createApp(config, { facilitator: fakeFacilitator() });
    expect(await (await app.request("/v1/pro")).json()).toEqual({
      plans: [
        { id: "month", usd: 5, days: 30 },
        { id: "year", usd: 48, days: 365 },
      ],
      callsPerDay: 100,
      solana: { network: DEVNET, environment: "testnet", payTo: PAY_TO_SOLANA, mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
      near: { network: "near:testnet", environment: "testnet", payTo: PAY_TO_NEAR, token: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af" },
    });
  });

  it("finds a Solana Pay payment by the code's reference; the code then works as a key", async () => {
    const code = newSvalinKey("svp_");
    const paid = { tx: "sig1", network: DEVNET, atomic: "5000000", at: Date.now() - 1000 };
    const app = createApp(config, { facilitator: fakeFacilitator(), proPayments: finder(code, [paid]) });

    const first = await (await activate(app, code)).json();
    expect(first).toMatchObject({ found: 1, pending: [], status: { kind: "pro", plan: "pro", active: true, callsLeft: 100, callsPer: "day" } });
    expect(Date.parse(first.status.until)).toBe(paid.at + 30 * 86_400_000);
    expect((await (await activate(app, code)).json()).found).toBe(0);

    const report = await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: bearer(code) });
    expect(report.status).toBe(200);
    expect(report.headers.get("X-Calls-Left")).toBe("99");
    // Another code has another reference, so this payment is not found for it.
    expect((await (await activate(app, newSvalinKey("svp_"))).json()).status).toBeNull();
  });

  it("does not count a payment below the monthly price", async () => {
    const code = newSvalinKey("svp_");
    const app = createApp(config, { facilitator: fakeFacilitator(), proPayments: finder(code, [{ tx: "sig", network: DEVNET, atomic: "4999999", at: Date.now() }]) });
    expect(await (await activate(app, code)).json()).toEqual({ status: null, found: 0, pending: [] });
  });

  it("reserves an exact NEAR amount and matches the payment by it", async () => {
    const code = newSvalinKey("svp_");
    const near: FoundPayment[] = [];
    const app = createApp(config, { facilitator: fakeFacilitator(), proPayments: finder(code, [], near) });

    const checkout = await app.request("/v1/pro/near", { method: "POST", body: JSON.stringify({ code, plan: "year" }) });
    expect(checkout.status).toBe(200);
    const reserved = await checkout.json();
    expect(reserved).toMatchObject({ plan: "year", network: "near:testnet", payTo: PAY_TO_NEAR });
    expect(reserved.amount).toMatch(/^48\.00\d{4}$/);
    expect(reserved.amount).not.toBe("48.000000");

    expect((await (await activate(app, code)).json()).pending).toEqual([reserved]);
    near.push({ tx: "hash1", network: "near:testnet", atomic: reserved.amount.replace(".", "").replace(/^0+/, ""), at: Date.now() });
    const activated = await (await activate(app, code)).json();
    expect(activated).toMatchObject({ found: 1, pending: [], status: { active: true } });
    expect(Date.parse(activated.status.until) - Date.now()).toBeGreaterThan(364 * 86_400_000);
  });

  it("rejects a malformed code or plan with 400, before any lookup", async () => {
    const lookups: string[] = [];
    const app = createApp(config, {
      facilitator: fakeFacilitator(),
      proPayments: { solana: async () => (lookups.push("solana"), []), near: async () => (lookups.push("near"), []) },
    });
    const huge = JSON.stringify({ code: newSvalinKey("svp_"), padding: "x".repeat(5000) });
    for (const body of ["not json", JSON.stringify({ code: "svk_notpro" }), JSON.stringify({ code: `svp_${"1".repeat(60)}` }), huge]) {
      const response = await app.request("/v1/pro/activate", { method: "POST", body });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("invalid_code");
    }
    const plan = await app.request("/v1/pro/near", { method: "POST", body: JSON.stringify({ code: newSvalinKey("svp_"), plan: "decade" }) });
    expect((await plan.json()).code).toBe("invalid_plan");
    expect(lookups).toEqual([]);
  });

  it("hands one caller only a few NEAR amounts an hour", async () => {
    const app = createApp(config, { facilitator: fakeFacilitator() });
    const statuses: number[] = [];
    for (let call = 0; call < 11; call += 1) {
      const body = JSON.stringify({ code: newSvalinKey("svp_"), plan: "month" });
      statuses.push((await app.request("/v1/pro/near", { method: "POST", body })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("stops a caller who looks too often, then stops asking the store about them", async () => {
    const code = newSvalinKey("svp_");
    const keyStore = new KeyStoreCore(new MemoryStorage());
    let throttleCalls = 0;
    const throttle = keyStore.throttle.bind(keyStore);
    keyStore.throttle = async (...args) => (throttleCalls++, throttle(...args));
    const app = createApp(config, { facilitator: fakeFacilitator(), proPayments: finder(code), keyStore });
    let last = 0;
    for (let call = 0; call <= 120; call += 1) last = (await activate(app, code)).status;
    expect(last).toBe(429);
    for (let call = 0; call < 10; call += 1) expect((await activate(app, code)).status).toBe(429);
    expect(throttleCalls).toBe(121);
  });

  it("reads each Solana transaction from the chain once, whether it paid or not", async () => {
    const code = newSvalinKey("svp_");
    const chain: FoundPayment[] = [
      { tx: "pay", network: DEVNET, atomic: "5000000", at: Date.now() - 2000 },
      { tx: "dust", network: DEVNET, atomic: "1", at: Date.now() - 1000 },
    ];
    const fetched: string[] = [];
    const proPayments: ProPaymentFinder = {
      solana: async (_offer, reference, unread) => {
        if (reference !== (await proReference(code))) return [];
        const fresh = await unread(chain.map((entry) => entry.tx));
        fetched.push(...fresh);
        return chain.filter((entry) => fresh.includes(entry.tx));
      },
      near: async () => [],
    };
    const app = createApp(config, { facilitator: fakeFacilitator(), proPayments });

    expect((await (await activate(app, code)).json()).found).toBe(1);
    expect(await (await activate(app, code)).json()).toMatchObject({ found: 0, status: { active: true } });
    expect(fetched).toEqual(["pay", "dust"]);
  });

  it("reads each NEAR transaction once, and still credits a checkout paid after them", async () => {
    const code = newSvalinKey("svp_");
    const history: FoundPayment[] = [{ tx: "per-call", network: "near:testnet", atomic: "2000", at: Date.now() }];
    const fetched: string[] = [];
    const proPayments: ProPaymentFinder = {
      solana: async () => [],
      near: async (_offer, _since, unread) => {
        const fresh = await unread(history.map((entry) => entry.tx));
        fetched.push(...fresh);
        return history.filter((entry) => fresh.includes(entry.tx));
      },
    };
    const app = createApp(config, { facilitator: fakeFacilitator(), proPayments });
    const reserved = await (await app.request("/v1/pro/near", { method: "POST", body: JSON.stringify({ code, plan: "month" }) })).json();

    expect((await (await activate(app, code)).json()).found).toBe(0);
    history.push({ tx: "pro", network: "near:testnet", atomic: reserved.amount.replace(".", "").replace(/^0+/, ""), at: Date.now() });
    expect(await (await activate(app, code)).json()).toMatchObject({ found: 1, pending: [], status: { active: true } });
    expect(fetched).toEqual(["per-call", "pro"]);
  });
});
