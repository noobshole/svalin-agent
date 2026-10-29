import type { ChainFamily } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { MAX_ROUTE_DESCRIPTION_LENGTH, paidRoutes, paymentNetworks, type PaidRouteKey } from "../src/catalog.js";
import { loadConfig } from "../src/env.js";
import { createClientIpResolver, visitorKey } from "../src/lib/client-ip.js";
import { tokenAddressError } from "../src/lib/errors.js";
import { facilitatorClients } from "../src/payments/x402.js";
import { RemoteIndexFeed } from "../src/sources/index-feed.js";
import { MockPortfolioSource } from "../src/sources/mock-source.js";
import { startupSummary } from "../src/startup-log.js";
import {
  NEAR_WALLET,
  PAY_TO_NEAR,
  PAY_TO_SOLANA,
  SOLANA_WALLET,
  decodeHeader,
  fakeFacilitator,
  testConfig,
} from "./helpers.js";

describe("free surface", () => {
  const app = createApp(testConfig());

  it("serves a manifest that promises read-only behaviour", async () => {
    const response = await app.request("/");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.readOnly).toBe(true);
    expect(body.canMoveFunds).toBe(false);
    expect(body.endpoints.map((endpoint: { path: string }) => endpoint.path)).toContain("/v1/risk/{address}");
  });

  it("serves openapi and llms.txt", async () => {
    expect((await app.request("/openapi.json")).status).toBe(200);
    const llms = await (await app.request("/llms.txt")).text();
    expect(llms).toContain("/v1/risk/");
  });

  it("publishes discovery metadata that x402 explorers read", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    expect(spec.info["x-guidance"]).toContain("/v1/risk/{address}");
    const risk = spec.paths["/v1/risk/{address}"].get;
    expect(risk["x-payment-info"]).toEqual({
      price: { mode: "fixed", currency: "USD", amount: "0.004000" },
      protocols: [{ x402: {} }],
    });
    expect(risk.responses["402"]).toBeDefined();
    expect(spec.paths["/v1/demo/risk/{address}"].get["x-payment-info"]).toBeUndefined();
  });

  it("rejects invalid addresses with 400", async () => {
    const response = await app.request("/v1/demo/risk/Not-An-Address");
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_address");
  });

  it("returns 404 JSON for unknown routes", async () => {
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });

  it("rate limits the free demo per client", async () => {
    const limited = createApp(testConfig({ DEMO_REQUESTS_PER_DAY: "2" }), { clientIp: () => "1.2.3.4" });
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await limited.request(`/v1/demo/risk/${SOLANA_WALLET}`)).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("shares one daily allowance across every free route and says how much is left", async () => {
    const edition = JSON.stringify({ generatedAt: "2026-10-26T00:00:00.000Z", methodology: "near-token-backing-v1", rows: [["token.v2.ref-finance.near", "REF", 2, 100_000, "B", null, null, null]] });
    const limited = createApp(testConfig({ DEMO_REQUESTS_PER_DAY: "3" }), { clientIp: () => "1.2.3.4", indexFeed: { latest: async () => edition } });
    const scan = await limited.request(`/v1/demo/risk/${SOLANA_WALLET}`);
    expect(scan.headers.get("X-Free-Remaining")).toBe("2");
    const check = await limited.request(`/v1/demo/check/${SOLANA_WALLET}`);
    expect(check.headers.get("X-Free-Remaining")).toBe("1");
    expect((await limited.request("/v1/demo/exit/token.v2.ref-finance.near")).headers.get("X-Free-Remaining")).toBe("0");
    const refused = await limited.request(`/v1/demo/risk/${SOLANA_WALLET}`);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-Free-Remaining")).toBe("0");
    expect((await refused.json()).error).toContain("00:00 UTC");
  });

  it("leaves next steps out of the free report only when the lock is on, never out of the paid one", async () => {
    const open = await (await app.request(`/v1/demo/risk/${SOLANA_WALLET}`)).json();
    expect(open.findings.length).toBeGreaterThan(0);
    expect(open.findings.every((finding: { action: string | null }) => typeof finding.action === "string")).toBe(true);
    expect(open.locked).toBeUndefined();

    const locking = createApp(testConfig({ LOCK_FREE_NEXT_STEPS: "true" }));
    const free = await (await locking.request(`/v1/demo/risk/${SOLANA_WALLET}`)).json();
    expect(free.findings.every((finding: { action: string | null }) => finding.action === null)).toBe(true);
    expect(free.locked.nextSteps).toBe(true);
    expect(JSON.stringify(free)).not.toContain(open.findings[0].action);

    const paid = await (await locking.request(`/v1/risk/${SOLANA_WALLET}`)).json();
    expect(paid.findings[0].action).toBe(open.findings[0].action);
    expect(paid.locked).toBeUndefined();
  });

  it("answers broken percent-encoding with 400, never a server error", async () => {
    for (const path of ["/v1/risk/%E0%A4%A", "/v1/demo/risk/%", "/v1/exit/%ZZ", "/v1/check/%25E0"]) {
      const response = await app.request(path);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("invalid_address");
    }
  });

  it("ignores a caller-chosen X-Forwarded-For entry when rate limiting the demo", async () => {
    const limited = createApp(testConfig({ DEMO_REQUESTS_PER_DAY: "1" }));
    // Our proxy appends the real client IP last; everything before it is whatever the caller sent.
    const call = (spoofed: string) =>
      limited.request(`/v1/demo/risk/${SOLANA_WALLET}`, { headers: { "x-forwarded-for": `${spoofed}, 203.0.113.7` } });
    expect((await call("10.0.0.1")).status).toBe(200);
    expect((await call("10.0.0.2")).status).toBe(429);
  });

  it("groups IPv6 visitors by /64 network for the demo limit", () => {
    expect(visitorKey("203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa:bb::/64");
    expect(visitorKey("2001:0DB8:00aa:00bb::9")).toBe("2001:db8:aa:bb::/64");
    expect(visitorKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorKey("2001:db8:aa:cc::1")).not.toBe(visitorKey("2001:db8:aa:bb::1"));
  });

  it("keys the demo on CF-Connecting-IP on Cloudflare, ignoring X-Forwarded-For", async () => {
    const limited = createApp(testConfig({ DEMO_REQUESTS_PER_DAY: "1" }), {
      clientIp: createClientIpResolver({ trustedProxyHops: 0, cloudflare: true }),
    });
    const call = (connecting: string, spoofed: string) =>
      limited.request(`/v1/demo/risk/${SOLANA_WALLET}`, {
        headers: { "cf-connecting-ip": connecting, "x-forwarded-for": spoofed },
      });
    expect((await call("2001:db8:aa:bb::1", "10.0.0.1")).status).toBe(200);
    // Another address in the same /64, with a different spoofed header: same visitor.
    expect((await call("2001:db8:aa:bb::2", "10.0.0.2")).status).toBe(429);
    expect((await call("2001:db8:aa:cc::1", "10.0.0.3")).status).toBe(200);
  });

  it("gives each website visitor their own demo allowance only when the web app proves the shared secret", async () => {
    const secret = "s".repeat(32);
    const limited = createApp(testConfig({ DEMO_REQUESTS_PER_DAY: "1", WEB_FORWARDING_SECRET: secret }));
    const viaWeb = (visitor: string, presented: string) =>
      limited.request(`/v1/demo/risk/${SOLANA_WALLET}`, {
        headers: {
          "x-forwarded-for": "198.51.100.1",
          "x-svalin-client-ip": visitor,
          "x-svalin-forwarding-secret": presented,
        },
      });

    expect((await viaWeb("192.0.2.1", secret)).status).toBe(200);
    expect((await viaWeb("192.0.2.2", secret)).status).toBe(200);
    expect((await viaWeb("192.0.2.1", secret)).status).toBe(429);

    // A wrong secret is ignored: the claimed visitor IP does not count, the proxy-seen address does.
    const wrong = "w".repeat(32);
    expect((await viaWeb("192.0.2.3", wrong)).status).toBe(200);
    expect((await viaWeb("192.0.2.4", wrong)).status).toBe(429);
  });

  it("serves paid routes for free in development when payments are not configured", async () => {
    const response = await app.request(`/v1/brief/${SOLANA_WALLET}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.narrator).toBe("template");
    expect(body.risk.wallet).toBe(SOLANA_WALLET);
  });

  it("refuses paid routes in production when payments are not configured", async () => {
    const config = loadConfig({ NODE_ENV: "production", HELIUS_API_KEY: "test" });
    const prod = createApp(config, { portfolioSource: new MockPortfolioSource() });
    const response = await prod.request(`/v1/risk/${SOLANA_WALLET}`);
    expect(response.status).toBe(503);
  });

  it("explains when an instance cannot serve a wallet's chain", async () => {
    const config = loadConfig({ NODE_ENV: "test", HELIUS_API_KEY: "test" });
    class SolanaOnlySource extends MockPortfolioSource {
      supports(family: ChainFamily): boolean {
        return family === "solana";
      }
    }
    const live = createApp(config, { portfolioSource: new SolanaOnlySource() });
    const response = await live.request(`/v1/demo/risk/${NEAR_WALLET}`);
    expect(response.status).toBe(501);
    expect((await response.json()).code).toBe("chain_not_supported");
  });

  it("analyses NEAR accounts as well as Solana wallets", async () => {
    const response = await app.request(`/v1/demo/risk/${NEAR_WALLET}`);
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.chain).toBe("near");
    expect(report.metrics.largestVolatilePosition.symbol).toBe("NEAR (incl. staked)");
  });

  it("answers a token address with 422 and the token's grade instead of a wallet report", async () => {
    const token = { chain: "near" as const, address: "jambo-1679.meme-cooking.near", symbol: "JAMBO", grade: "C" as const, backingUsd: 44627 };
    class TokenSource extends MockPortfolioSource {
      async getOverview(): Promise<never> {
        throw tokenAddressError(token);
      }
    }
    const live = createApp(testConfig(), { portfolioSource: new TokenSource() });
    const response = await live.request(`/v1/demo/risk/${token.address}`);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ code: "token_address", token });
    expect(body.hint).toContain("grade C: $44,627");
  });

  it("rejects EVM addresses, which Svalin no longer serves", async () => {
    const response = await app.request("/v1/demo/risk/0xAbCdEf0000000000000000000000000000000001");
    expect(response.status).toBe(400);
  });
});

describe("startup guards", () => {
  it("refuses to run production on mock data", () => {
    expect(() => loadConfig({ NODE_ENV: "production", PORTFOLIO_SOURCE: "mock" })).toThrow(/mock/);
  });

  it("validates payTo addresses", () => {
    expect(() => testConfig({ PAY_TO_SOLANA: "0xnope" })).toThrow(/PAY_TO_SOLANA/);
    expect(() => testConfig({ PAY_TO_NEAR: "Not A Near Account" })).toThrow(/PAY_TO_NEAR/);
  });

  it("rejects a guessable web forwarding secret", () => {
    expect(() => testConfig({ WEB_FORWARDING_SECRET: "short" })).toThrow(/WEB_FORWARDING_SECRET/);
  });

  it("needs both CDP keys or neither", () => {
    expect(() => testConfig({ CDP_API_KEY_ID: "key-id" })).toThrow(/CDP_API_KEY/);
    expect(() => testConfig({ CDP_API_KEY_SECRET: "secret" })).toThrow(/CDP_API_KEY/);
  });
});

describe("startup log", () => {
  it("names what is running without ever including a key", () => {
    const keys = {
      HELIUS_API_KEY: "helius-secret-value",
      ANTHROPIC_API_KEY: "anthropic-secret-value",
      NEAR_FACILITATOR_API_KEY: "near-secret-value",
      WEB_FORWARDING_SECRET: "forwarding-secret-value-0123456789",
    };
    const summary = startupSummary(testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet", ...keys }));
    expect(summary).toMatchObject({ payments: "x402", facilitators: ["near", "x402.org"], webVisitorForwarding: "on" });
    const logged = JSON.stringify(summary);
    for (const value of Object.values(keys)) expect(logged).not.toContain(value);
  });
});

describe("facilitators", () => {
  it("uses the default facilitator alone for Solana-only payments", () => {
    expect(facilitatorClients(testConfig({ PAY_TO_SOLANA, X402_ENV: "mainnet" })).map((entry) => entry.name)).toEqual(["payai"]);
    expect(facilitatorClients(testConfig({ PAY_TO_SOLANA, X402_ENV: "testnet" })).map((entry) => entry.name)).toEqual(["x402.org"]);
  });

  it("adds the NEAR facilitator when a NEAR payTo is set", () => {
    const config = testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet" });
    expect(facilitatorClients(config).map((entry) => entry.name)).toEqual(["near", "x402.org"]);
  });

  it("sets each chain's network on its own: Solana on mainnet while NEAR stays on testnet", async () => {
    const config = testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet", X402_ENV_SOLANA: "mainnet" });
    expect(config.payments.networks).toEqual({ solana: "mainnet", near: "testnet" });
    expect(paymentNetworks(config).map((network) => `${network.caip2} ${network.environment}`)).toEqual([
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp mainnet",
      "near:testnet testnet",
    ]);
    // Solana settles through the mainnet facilitator; NEAR keeps its testnet facilitator.
    expect(facilitatorClients(config).map((entry) => entry.name)).toEqual(["near", "payai"]);
    // As on Workers: payment kinds are read on the first paid request, so reading the manifest needs none.
    const app = createApp(config, { facilitator: fakeFacilitator(), paymentInitialization: "first-paid-request", paymentDiscovery: false });
    const manifest = await (await app.request("/")).json();
    expect(manifest.payments.networks.map((network: { label: string; environment: string }) => `${network.label} ${network.environment}`)).toEqual([
      "Solana mainnet",
      "NEAR Testnet testnet",
    ]);
  });

  it("puts CDP first when keys are set, so Bazaar-eligible settlements go through it", () => {
    const config = testConfig({
      PAY_TO_SOLANA,
      PAY_TO_NEAR,
      X402_ENV: "mainnet",
      CDP_API_KEY_ID: "key-id",
      CDP_API_KEY_SECRET: "key-secret",
    });
    expect(facilitatorClients(config).map((entry) => entry.name)).toEqual(["cdp", "near", "payai"]);
  });
});

describe("Cloudflare Workers mode", () => {
  function countingFacilitator(failFirst = false) {
    const facilitator = fakeFacilitator();
    const supported = facilitator.getSupported.bind(facilitator);
    const calls = { supported: 0 };
    facilitator.getSupported = async () => {
      calls.supported += 1;
      if (failFirst && calls.supported === 1) throw new Error("facilitator down");
      return supported();
    };
    return { facilitator, calls };
  }
  const workersDeps = { paymentInitialization: "first-paid-request", paymentDiscovery: false } as const;
  const config = testConfig({ PAY_TO_SOLANA, X402_ENV: "testnet" });

  it("loads the facilitators inside the first paid request only, without Bazaar metadata", async () => {
    const { facilitator, calls } = countingFacilitator();
    const app = createApp(config, { facilitator, ...workersDeps });

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request(`/v1/demo/risk/${SOLANA_WALLET}`)).status).toBe(200);
    expect(calls.supported).toBe(0);

    const first = await app.request(`/v1/risk/${SOLANA_WALLET}`);
    expect(first.status).toBe(402);
    expect(decodeHeader(first.headers.get("PAYMENT-REQUIRED")).extensions?.bazaar).toBeUndefined();
    expect((await app.request(`/v1/brief/${SOLANA_WALLET}`)).status).toBe(402);
    expect(calls.supported).toBe(1);
  });

  it("answers 503 when no facilitator responds, and retries on the next paid request", async () => {
    const { facilitator, calls } = countingFacilitator(true);
    const app = createApp(config, { facilitator, ...workersDeps });

    const failed = await app.request(`/v1/risk/${SOLANA_WALLET}`);
    expect(failed.status).toBe(503);
    expect((await failed.json()).code).toBe("facilitator_unavailable");
    expect((await app.request(`/v1/risk/${SOLANA_WALLET}`)).status).toBe(402);
    expect(calls.supported).toBe(2);
  });
});

describe("x402 paywall", () => {
  const facilitator = fakeFacilitator();
  const app = createApp(testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet" }), { facilitator });

  it("answers paid routes with 402 and offers USDC on both Solana and NEAR", async () => {
    const response = await app.request(`/v1/risk/${SOLANA_WALLET}`);
    expect(response.status).toBe(402);

    const required = decodeHeader(response.headers.get("PAYMENT-REQUIRED"));
    expect(required.x402Version).toBe(2);
    const offers = required.accepts.map((accept: { network: string; payTo: string; amount: string }) => [
      accept.network,
      accept.payTo,
      accept.amount,
    ]);
    expect(offers).toEqual(
      expect.arrayContaining([
        ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", PAY_TO_SOLANA, "4000"],
        ["near:testnet", PAY_TO_NEAR, "4000"],
      ]),
    );
    expect(required.extensions?.bazaar).toBeDefined();
  });

  it("prices each endpoint independently", async () => {
    const amounts: Record<string, string> = {};
    for (const route of ["portfolio", "risk", "brief"]) {
      const response = await app.request(`/v1/${route}/${SOLANA_WALLET}`);
      amounts[route] = decodeHeader(response.headers.get("PAYMENT-REQUIRED")).accepts[0].amount;
    }
    expect(amounts).toEqual({ portfolio: "2000", risk: "4000", brief: "20000" });
  });

  it("describes paid routes for Bazaar discovery within the facilitator's limits", async () => {
    for (const key of Object.keys(paidRoutes) as PaidRouteKey[]) {
      expect(paidRoutes[key].description.length).toBeLessThanOrEqual(MAX_ROUTE_DESCRIPTION_LENGTH);
    }
    const required = decodeHeader((await app.request(`/v1/risk/${SOLANA_WALLET}`)).headers.get("PAYMENT-REQUIRED"));
    const discovery = JSON.stringify(required.extensions.bazaar);
    expect(discovery).toContain("address");
    expect(discovery).not.toContain("var1");
  });

  it("never asks for payment on a request that can only fail", async () => {
    const response = await app.request("/v1/risk/Definitely-Not-Valid");
    expect(response.status).toBe(400);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it("keeps the demo free and free endpoints unpaywalled", async () => {
    expect((await app.request(`/v1/demo/risk/${SOLANA_WALLET}`)).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
  });

  it("rejects a forged payment without running the handler", async () => {
    const forged = Buffer.from(JSON.stringify({ x402Version: 2, payload: {} })).toString("base64");
    const response = await app.request(`/v1/risk/${SOLANA_WALLET}`, { headers: { "PAYMENT-SIGNATURE": forged } });
    expect(response.status).toBe(402);
    expect(facilitator.settleCalls).toBe(0);
  });
});

describe("Svalin Index", () => {
  it("serves the latest published edition as JSON, free and unpaywalled", async () => {
    const app = createApp(testConfig({ PAY_TO_SOLANA }), {
      facilitator: fakeFacilitator(),
      indexFeed: { latest: async () => '{"rows":[]}' },
    });
    const response = await app.request("/v1/index/near-tokens");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ rows: [] });
  });

  it("answers 503 when the edition cannot be fetched, and tries again on the next request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 500 }) : Response.json({ rows: [] });
    }) as typeof fetch;
    const app = createApp(testConfig(), { indexFeed: new RemoteIndexFeed("https://index.example/latest.json", fetchImpl) });

    expect((await app.request("/v1/index/near-tokens")).status).toBe(503);
    expect((await app.request("/v1/index/near-tokens")).status).toBe(200);
  });
});

describe("exit prices for one token", () => {
  const edition = JSON.stringify({
    generatedAt: "2026-10-25T00:40:00.000Z",
    methodology: "near-token-backing-v1",
    counts: { A: 0, B: 1, C: 0, D: 0, F: 0 },
    rows: [["token.v2.ref-finance.near", "REF", 2, 100_000, "B", 5_000_000, 41.2, 12_000]],
  });
  const indexFeed = { latest: async () => edition };
  const app = createApp(testConfig(), { indexFeed });
  const paywalled = createApp(testConfig({ PAY_TO_SOLANA }), { facilitator: fakeFacilitator(), indexFeed });

  it("answers a token's grade and exit prices, with the caller's own sale size", async () => {
    const response = await app.request("/v1/exit/token.v2.ref-finance.near?amountUsd=25000");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.grade).toBe("B");
    expect(body.exit.quotes.map((quote: { saleUsd: number }) => quote.saleUsd)).toEqual([1_000, 10_000, 25_000, 100_000]);
    expect(body.edition).toEqual({ generatedAt: "2026-10-25T00:40:00.000Z", methodology: "near-token-backing-v1" });
  });

  it("is paid, and asks for payment only for a token it can answer", async () => {
    const graded = await paywalled.request("/v1/exit/token.v2.ref-finance.near");
    expect(graded.status).toBe(402);
    expect(graded.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
    for (const [path, code] of [
      ["/v1/exit/unknown.near", "not_in_index"],
      ["/v1/exit/wrap.near", "trusted_token"],
      ["/v1/exit/token.v2.ref-finance.near?amountUsd=-5", "invalid_amount"],
    ]) {
      const response = await paywalled.request(path);
      expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
      expect((await response.json()).code).toBe(code);
    }
  });

  it("has a free trial at the standard sizes; your own size needs the paid route", async () => {
    const trial = await paywalled.request("/v1/demo/exit/token.v2.ref-finance.near");
    expect(trial.status).toBe(200);
    expect((await trial.json()).exit.quotes).toHaveLength(3);
    const custom = await paywalled.request("/v1/demo/exit/token.v2.ref-finance.near?amountUsd=25000");
    expect(custom.status).toBe(400);
    expect((await custom.json()).code).toBe("amount_needs_paid_route");
  });

  it("accepts a contract typed in capitals", async () => {
    expect((await app.request("/v1/exit/TOKEN.v2.ref-finance.near")).status).toBe(200);
  });

  it("rejects a bad contract or amount with 400", async () => {
    expect((await app.request("/v1/exit/not%20a%20token!")).status).toBe(400);
    for (const amount of ["0", "-5", "abc", "1e13"]) {
      const response = await app.request(`/v1/exit/token.v2.ref-finance.near?amountUsd=${amount}`);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("invalid_amount");
    }
  });
});
