import { describe, expect, it } from "vitest";

import { KeyStoreCore, MemoryStorage, keyId, passUntil, type PassPayment, type PassRecord } from "../src/lib/key-store.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 29, 12);
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const NEAR = "near:testnet";
const rules = { networks: [MAINNET, NEAR], proCallsPerDay: 3 };
const planDays = { month: 30, year: 365 };

const payment = (tx: string, at: number, days = 30, network = MAINNET): PassPayment => ({ tx, network, atomic: "5000000", at, days });

function agentKey(calls: number, at = NOW): PassRecord {
  return { kind: "key", plan: "business", payments: [payment("x402", at, 30)], calls, used: 0, usedSince: at };
}

describe("pass periods", () => {
  it("stacks each payment where the previous one ends", () => {
    expect(passUntil([payment("a", NOW), payment("b", NOW + DAY)], [MAINNET])).toBe(NOW + 60 * DAY);
    // A renewal after a gap starts on its own day.
    expect(passUntil([payment("a", NOW), payment("b", NOW + 40 * DAY)], [MAINNET])).toBe(NOW + 70 * DAY);
  });

  it("only counts payments on the networks Svalin takes now", () => {
    expect(passUntil([payment("a", NOW, 30, DEVNET)], [MAINNET])).toBeNull();
    expect(passUntil([payment("a", NOW, 30, DEVNET), payment("b", NOW)], [MAINNET])).toBe(NOW + 30 * DAY);
  });
});

describe("key store", () => {
  it("counts an agent key's calls until they are used up, and gives back failed ones", async () => {
    const store = new KeyStoreCore(new MemoryStorage());
    expect(await store.issue("k", agentKey(2))).toBe(true);
    expect(await store.issue("k", agentKey(2))).toBe(false);

    expect(await store.use("k", NOW, rules)).toEqual({ ok: true, callsLeft: 1, callsPer: "period" });
    await store.refund("k", NOW);
    expect(await store.use("k", NOW, rules)).toMatchObject({ ok: true, callsLeft: 1 });
    expect(await store.use("k", NOW, rules)).toMatchObject({ ok: true, callsLeft: 0 });
    expect(await store.use("k", NOW, rules)).toMatchObject({ ok: false, reason: "used_up" });
    expect(await store.status("k", NOW, rules)).toMatchObject({ kind: "key", plan: "business", active: true, callsLeft: 0 });
  });

  it("refuses unknown and ended keys", async () => {
    const store = new KeyStoreCore(new MemoryStorage());
    expect(await store.use("missing", NOW, rules)).toEqual({ ok: false, reason: "unknown", until: null });
    await store.issue("old", agentKey(10, NOW - 31 * DAY));
    expect(await store.use("old", NOW, rules)).toMatchObject({ ok: false, reason: "expired" });
    // Bought with test USDC: it ends when that chain moves to real USDC.
    await store.issue("test", { ...agentKey(10), payments: [payment("x402", NOW, 30, DEVNET)] });
    expect(await store.use("test", NOW, rules)).toEqual({ ok: false, reason: "expired", until: null });
  });

  it("gives a Pro code its fair use each UTC day", async () => {
    const store = new KeyStoreCore(new MemoryStorage());
    expect(await store.claim("pro", [payment("sig1", NOW - DAY)])).toBe(1);
    for (const left of [2, 1, 0]) expect(await store.use("pro", NOW, rules)).toEqual({ ok: true, callsLeft: left, callsPer: "day" });
    expect(await store.use("pro", NOW, rules)).toMatchObject({ ok: false, reason: "daily_limit" });
    expect(await store.use("pro", NOW + DAY, rules)).toMatchObject({ ok: true, callsLeft: 2 });
  });

  it("counts a payment once, for the first code that claims it", async () => {
    const store = new KeyStoreCore(new MemoryStorage());
    expect(await store.claim("a", [payment("sig1", NOW)])).toBe(1);
    expect(await store.claim("a", [payment("sig1", NOW)])).toBe(0);
    // One transaction carrying a second code's reference does not pay twice.
    expect(await store.claim("b", [payment("sig1", NOW)])).toBe(0);
    expect(await store.status("b", NOW, rules)).toBeNull();
    expect(await store.claim("a", [payment("sig2", NOW + DAY)])).toBe(1);
    expect((await store.status("a", NOW, rules))?.until).toBe(new Date(NOW + 60 * DAY).toISOString());
  });

  it("never turns an agent key into a Pro code", async () => {
    const store = new KeyStoreCore(new MemoryStorage());
    await store.issue("k", agentKey(5));
    expect(await store.claim("k", [payment("sig1", NOW)])).toBe(0);
  });
});

describe("exact NEAR amounts", () => {
  it("reserves one amount per code and plan, just above the price", async () => {
    const store = new KeyStoreCore(new MemoryStorage(), () => 4216);
    const first = await store.reserveNear("a", "month", NEAR, "5000000", NOW);
    expect(first).toMatchObject({ plan: "month", atomic: "5004217", createdAt: NOW, expiresAt: NOW + 2 * DAY });
    expect(await store.reserveNear("a", "month", NEAR, "5000000", NOW + 1000)).toEqual(first);
    expect(await store.pending("a", NOW)).toHaveLength(1);
  });

  it("never hands one amount to two codes", async () => {
    const picks = [7, 7, 7, 8];
    const store = new KeyStoreCore(new MemoryStorage(), () => picks.shift() ?? 9);
    expect((await store.reserveNear("a", "month", NEAR, "5000000", NOW))?.atomic).toBe("5000008");
    expect((await store.reserveNear("b", "month", NEAR, "5000000", NOW))?.atomic).toBe("5000009");
  });

  it("credits a payment of exactly the reserved amount to its code, whoever looks", async () => {
    const store = new KeyStoreCore(new MemoryStorage(), () => 41);
    await store.reserveNear("a", "year", NEAR, "48000000", NOW);
    const paid = { tx: "hash1", network: NEAR, atomic: "48000042", at: NOW + 60_000 };

    expect(await store.claimNear([{ ...paid, atomic: "48000000" }], planDays)).toEqual([]);
    expect(await store.claimNear([paid], planDays)).toEqual(["a"]);
    expect(await store.claimNear([paid], planDays)).toEqual([]);
    expect(await store.pending("a", NOW)).toEqual([]);
    expect(await store.status("a", NOW, rules)).toMatchObject({ kind: "pro", active: true, until: new Date(NOW + 60_000 + 365 * DAY).toISOString() });
  });

  it("does not match a payment made before the amount was reserved", async () => {
    const store = new KeyStoreCore(new MemoryStorage(), () => 41);
    await store.reserveNear("a", "month", NEAR, "5000000", NOW);
    expect(await store.claimNear([{ tx: "old", network: NEAR, atomic: "5000042", at: NOW - 1 }], planDays)).toEqual([]);
  });
});

describe("throttle", () => {
  it("limits each caller per hour and everyone per day, per bucket", async () => {
    const store = new KeyStoreCore(new MemoryStorage());
    expect(await store.throttle("lookup", "ip1", NOW, 2, 3)).toBe(true);
    expect(await store.throttle("lookup", "ip1", NOW, 2, 3)).toBe(true);
    expect(await store.throttle("lookup", "ip1", NOW, 2, 3)).toBe(false);
    expect(await store.throttle("lookup", "ip2", NOW, 2, 3)).toBe(true);
    expect(await store.throttle("lookup", "ip3", NOW, 2, 3)).toBe(false);
    // Another bucket counts on its own.
    expect(await store.throttle("near-amount", "ip1", NOW, 2, 3)).toBe(true);
    expect(await store.throttle("lookup", "ip1", NOW + DAY, 2, 3)).toBe(true);
  });
});

describe("key ids", () => {
  it("stores a fingerprint, never the secret", async () => {
    const id = await keyId("svp_secret");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain("secret");
    expect(await keyId("svp_secret")).toBe(id);
  });
});
