import type { FacilitatorClient } from "@x402/core/server";

import { loadConfig } from "../src/env.js";

export const SOLANA_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const NEAR_WALLET = "svalin-sample.near";
export const PAY_TO_SOLANA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const PAY_TO_NEAR = "svalin-pay.testnet";

export function testConfig(overrides: Record<string, string | undefined> = {}) {
  return loadConfig({ NODE_ENV: "test", PORTFOLIO_SOURCE: "mock", ...overrides });
}

/** A facilitator stub mirroring PayAI's /supported shape for the test networks. */
export function fakeFacilitator(): FacilitatorClient & { verifyCalls: number; settleCalls: number } {
  const stub = {
    verifyCalls: 0,
    settleCalls: 0,
    async getSupported() {
      return {
        kinds: [
          { x402Version: 2, scheme: "exact", network: "near:testnet" as const },
          {
            x402Version: 2,
            scheme: "exact",
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const,
            extra: { feePayer: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" },
          },
        ],
        extensions: ["bazaar"],
        signers: {},
      };
    },
    async verify() {
      stub.verifyCalls += 1;
      return { isValid: false, invalidReason: "test_stub" } as never;
    },
    async settle() {
      stub.settleCalls += 1;
      return { success: false, errorReason: "test_stub", transaction: "", network: "near:testnet" } as never;
    },
  };
  return stub;
}

export function decodeHeader(value: string | null) {
  if (!value) throw new Error("missing header");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}
