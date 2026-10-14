import { describe, expect, it } from "vitest";

import { SpendBudget, atomicToUsd, usdToAtomic } from "../src/budget.js";
import { loadMcpConfig } from "../src/config.js";

describe("spend budget", () => {
  it("converts USD to USDC atomic units and back", () => {
    expect(usdToAtomic(0.01)).toBe(10_000n);
    expect(usdToAtomic(1)).toBe(1_000_000n);
    expect(atomicToUsd(30_000n)).toBe("$0.03");
    expect(atomicToUsd(1_000_000n)).toBe("$1.00");
    expect(atomicToUsd(5_000n)).toBe("$0.005");
  });

  it("enforces the per-call limit and the session cap", () => {
    const budget = new SpendBudget(usdToAtomic(0.05), usdToAtomic(0.06));
    expect(budget.check(usdToAtomic(0.1))).toMatch(/per-call limit/);
    expect(budget.check(usdToAtomic(0.03))).toBeNull();
    budget.commit(usdToAtomic(0.03));
    budget.commit(usdToAtomic(0.03));
    expect(budget.check(usdToAtomic(0.01))).toMatch(/session budget/);
    expect(budget.status()).toMatchObject({ paidCalls: 2, spent: "$0.06", remaining: "$0.00" });
  });

  it("requires an API URL and validates keys", () => {
    expect(() => loadMcpConfig({})).toThrow(/SVALIN_API_URL/);
    expect(() =>
      loadMcpConfig({ SVALIN_API_URL: "http://x.test", SVALIN_NEAR_ACCOUNT_ID: "a.near", SVALIN_NEAR_PRIVATE_KEY: "nope" }),
    ).toThrow(/SVALIN_NEAR_PRIVATE_KEY/);
    expect(() => loadMcpConfig({ SVALIN_API_URL: "http://x.test", SVALIN_NEAR_ACCOUNT_ID: "a.near" })).toThrow(/both/);
    expect(() =>
      loadMcpConfig({ SVALIN_API_URL: "http://x.test", SVALIN_NEAR_ACCOUNT_ID: "Not A Near Account", SVALIN_NEAR_PRIVATE_KEY: "ed25519:abc" }),
    ).toThrow(/SVALIN_NEAR_ACCOUNT_ID/);
    expect(loadMcpConfig({ SVALIN_API_URL: "http://x.test", SVALIN_SOLANA_PRIVATE_KEY: "" }).SVALIN_SOLANA_PRIVATE_KEY).toBeUndefined();
  });
});
