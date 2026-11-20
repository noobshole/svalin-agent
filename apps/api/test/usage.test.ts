import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { AnalyticsUsage, chainOf, routeNamer, type UsageEvent } from "../src/lib/usage.js";
import { NEAR_WALLET, PAY_TO_NEAR, PAY_TO_SOLANA, SOLANA_WALLET, acceptingFacilitator, paymentFor, testConfig } from "./helpers.js";

const config = testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet" });

function counted() {
  const events: UsageEvent[] = [];
  const app = createApp(config, { facilitator: acceptingFacilitator(), usage: { record: (event) => events.push(event) } });
  return { app, events };
}

describe("usage counts", () => {
  it("counts a free call by route and chain, and never keeps the address", async () => {
    const { app, events } = counted();
    expect((await app.request(`/v1/demo/risk/${SOLANA_WALLET}`)).status).toBe(200);
    expect((await app.request(`/v1/demo/risk/${NEAR_WALLET}`)).status).toBe(200);
    expect(events).toEqual([
      { route: "demo/risk", outcome: "free", reason: "", network: "", chain: "solana" },
      { route: "demo/risk", outcome: "free", reason: "", network: "", chain: "near" },
    ]);
    const stored = JSON.stringify(events);
    expect(stored).not.toContain(SOLANA_WALLET);
    expect(stored).not.toContain(NEAR_WALLET);
  });

  it("tells a request for payment from a paid call, and names the network that settled it", async () => {
    const { app, events } = counted();
    const unpaid = await app.request(`/v1/risk/${SOLANA_WALLET}`);
    expect(unpaid.status).toBe(402);
    expect((await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: await paymentFor(unpaid) })).status).toBe(200);
    expect(events).toEqual([
      { route: "risk", outcome: "payment_required", reason: "", network: "", chain: "solana" },
      { route: "risk", outcome: "paid_x402", reason: "", network: "near:testnet", chain: "solana" },
    ]);
    expect(JSON.stringify(events)).not.toContain("payer.testnet");
  });

  it("counts a call a Svalin pass paid for, without the key", async () => {
    const { app, events } = counted();
    const unpaid = await app.request("/v1/keys/business", { method: "POST" });
    const { key } = await (await app.request("/v1/keys/business", { method: "POST", headers: await paymentFor(unpaid) })).json();
    expect((await app.request(`/v1/check/${NEAR_WALLET}`, { headers: { Authorization: `Bearer ${key}` } })).status).toBe(200);
    expect(events.map((event) => [event.route, event.outcome, event.network])).toEqual([
      ["keys/business", "payment_required", ""],
      ["keys/business", "paid_x402", "near:testnet"],
      ["check", "paid_key", "key"],
    ]);
    expect(JSON.stringify(events)).not.toContain(key);
  });

  it("counts a refusal with its error code, so nobody charged is counted as paid", async () => {
    const { app, events } = counted();
    const refused = await app.request("/v1/risk/Definitely-Not-Valid");
    expect(refused.status).toBe(400);
    const { code } = await refused.json();
    expect((await app.request("/nowhere")).status).toBe(404);
    expect(events).toEqual([
      { route: "risk", outcome: "refused", reason: code, network: "", chain: "" },
      { route: "other", outcome: "refused", reason: "not_found", network: "", chain: "" },
    ]);
  });

  it("counts a look-alike the recipient check caught", async () => {
    const { app, events } = counted();
    const check = await (await app.request("/v1/demo/check/intent5.near")).json();
    expect(check.verdict).toBe("block");
    expect(events).toEqual([{ route: "demo/check", outcome: "free", reason: "lookalike", network: "", chain: "near" }]);
  });

  it("leaves out the health check, and never lets counting change an answer", async () => {
    const app = createApp(config, {
      usage: {
        record() {
          throw new Error("counter down");
        },
      },
    });
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request(`/v1/demo/risk/${SOLANA_WALLET}`)).status).toBe(200);
  });
});

describe("usage names", () => {
  const name = routeNamer(["/v1/risk/", "/v1/demo/risk/"], ["/", "/openapi.json", "/v1/keys/pro"]);

  it("names a route without its address, and only routes it knows", () => {
    expect(name("/v1/risk/alice.near")).toEqual({ route: "risk", address: "alice.near" });
    expect(name("/v1/demo/risk/alice.near")).toEqual({ route: "demo/risk", address: "alice.near" });
    expect(name("/")).toEqual({ route: "root", address: null });
    expect(name("/openapi.json")).toEqual({ route: "openapi.json", address: null });
    expect(name("/v1/keys/pro")).toEqual({ route: "keys/pro", address: null });
    for (const path of ["/v1/risk/", "/v1/riskier/alice.near", "/v1/keys/professional", "/wp-admin.php"]) {
      expect(name(path)).toEqual({ route: "other", address: null });
    }
  });

  it("keeps only the chain of an address", () => {
    expect(chainOf(SOLANA_WALLET)).toBe("solana");
    expect(chainOf("alice.near")).toBe("near");
    expect(chainOf("%E0%A4%A")).toBe("");
    expect(chainOf(null)).toBe("");
  });

  it("writes one data point per event to Analytics Engine, and drops a write that fails", () => {
    const points: unknown[] = [];
    new AnalyticsUsage({ writeDataPoint: (point) => points.push(point) }).record({
      route: "risk",
      outcome: "paid_x402",
      reason: "",
      network: "near:testnet",
      chain: "near",
    });
    expect(points).toEqual([{ indexes: ["risk"], blobs: ["risk", "paid_x402", "", "near:testnet", "near"], doubles: [1] }]);
    const failing = new AnalyticsUsage({
      writeDataPoint() {
        throw new Error("over the daily limit");
      },
    });
    expect(() => failing.record({ route: "risk", outcome: "free", reason: "", network: "", chain: "" })).not.toThrow();
  });
});
