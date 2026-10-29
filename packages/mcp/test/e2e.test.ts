/**
 * End-to-end payment path, fully offline:
 *   MCP client -> svalin-mcp server -> x402 fetch (real NEAR ed25519 signature) -> Svalin API
 *   paywall -> stub facilitator (decodes and verifies the signed delegate) -> handler -> ledger.
 * A local stub stands in for NEAR RPC (access-key nonce and block height); the test key is
 * generated per run and never holds funds.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { base58 } from "@scure/base";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { decodeSignedDelegateB64, parseFtTransferArgs } from "@x402/near";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../apps/api/src/app.js";
import { loadConfig } from "../../../apps/api/src/env.js";
import { ApiError } from "../../../apps/api/src/lib/errors.js";
import { KeyStoreCore, MemoryStorage, keyId } from "../../../apps/api/src/lib/key-store.js";
import type { PaymentRecord } from "../../../apps/api/src/payments/ledger.js";
import { MockPortfolioSource } from "../../../apps/api/src/sources/mock-source.js";
import { createSvalinClient } from "../src/client.js";
import { loadMcpConfig } from "../src/config.js";
import { createSvalinMcpServer } from "../src/server.js";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MISSING_ACCOUNT = "nobody-here.testnet";
const PAY_TO_NEAR = "svalin-pay.testnet";
const PAYER = "svalin-buyer.testnet";
const TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const NEAR_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** A fresh ed25519 key in NEAR's `ed25519:<base58(seed || publicKey)>` format. */
function testNearKey(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return `ed25519:${base58.encode(Buffer.concat([seed, pub]))}`;
}

/** Answers the two NEAR RPC reads the client signer makes: access-key nonce and latest block. */
function startNearRpcStub(): Promise<Server> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id, method, params } = JSON.parse(body) as { id: string; method: string; params: { request_type?: string } };
      const result =
        method === "block"
          ? { author: "stub.testnet", header: { height: 1_000, hash: "11111111111111111111111111111111" }, chunks: [] }
          : params.request_type === "view_access_key"
            ? { nonce: 41, permission: "FullAccess", block_height: 1_000, block_hash: "11111111111111111111111111111111" }
            : null;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code: -32601, message: "unsupported" } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

type NearPayload = { payload?: { signedDelegateAction?: string } };

function harness() {
  const settled: PaymentRecord[] = [];
  const keyStore = new KeyStoreCore(new MemoryStorage());
  const facilitator = {
    verifyCalls: 0,
    /** Every signed delegate the paywall asked to verify, base64 Borsh. */
    signedDelegates: [] as string[],
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: "near:testnet" as const }], extensions: [], signers: {} };
    },
    async verify(payload: NearPayload) {
      facilitator.verifyCalls += 1;
      facilitator.signedDelegates.push(payload.payload?.signedDelegateAction ?? "");
      const decoded = decodeSignedDelegateB64(payload.payload?.signedDelegateAction ?? "");
      return { isValid: decoded.verifySignature(), payer: decoded.delegate.senderId } as never;
    },
    async settle(payload: NearPayload) {
      const { delegate } = decodeSignedDelegateB64(payload.payload?.signedDelegateAction ?? "");
      return { success: true, transaction: "near-tx-1", network: "near:testnet", payer: delegate.senderId } as never;
    },
  };

  // Sample data, except one account that does not exist (as the live NEAR source reports it).
  class SampleSource extends MockPortfolioSource {
    async getOverview(wallet: string) {
      if (wallet === MISSING_ACCOUNT) throw new ApiError(404, "account_not_found", "This NEAR account does not exist.");
      return super.getOverview(wallet);
    }
  }

  const api = createApp(loadConfig({ NODE_ENV: "test", PORTFOLIO_SOURCE: "mock", PAY_TO_NEAR, X402_ENV: "testnet" }), {
    facilitator,
    keyStore,
    portfolioSource: new SampleSource(),
    ledger: { record: async (entry) => void settled.push(entry) },
    indexFeed: {
      latest: async () =>
        JSON.stringify({
          generatedAt: "2026-10-25T00:40:00.000Z",
          methodology: "near-token-backing-v1",
          counts: { A: 0, B: 1, C: 0, D: 0, F: 0 },
          rows: [["token.v2.ref-finance.near", "REF", 2, 100_000, "B", 5_000_000, 41.2, 12_000]],
        }),
    },
  });
  const apiFetch = ((input: RequestInfo | URL, init?: RequestInit) => api.fetch(new Request(input, init))) as typeof fetch;

  return { apiFetch, facilitator, settled, keyStore };
}

/** A Svalin Business key with calls left, as POST /v1/keys/business would sell it. */
async function issueKey(keyStore: KeyStoreCore, calls = 10) {
  const key = `svk_${"7".repeat(43)}`;
  const now = Date.now();
  await keyStore.issue(await keyId(key), {
    kind: "key",
    plan: "business",
    payments: [{ tx: "x402", network: "near:testnet", atomic: "79000000", at: now, days: 30 }],
    calls,
    used: 0,
    usedSince: now,
  });
  return key;
}

/** A fresh payee memory file per connection, so tests never touch ~/.svalin. */
const memoryFile = () => join(mkdtempSync(join(tmpdir(), "svalin-mcp-")), "payees.json");

async function connect(apiFetch: typeof fetch, env: Record<string, string>) {
  const svalin = await createSvalinClient(
    loadMcpConfig({ SVALIN_API_URL: "http://svalin.test", SVALIN_PAYEE_MEMORY: memoryFile(), ...env }),
    apiFetch,
  );
  const server = createSvalinMcpServer(svalin);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, svalin };
}

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;

describe("svalin-mcp end to end", () => {
  let rpc: Server;
  let nearWallet: Record<string, string>;

  beforeAll(async () => {
    rpc = await startNearRpcStub();
    nearWallet = {
      SVALIN_NEAR_ACCOUNT_ID: PAYER,
      SVALIN_NEAR_PRIVATE_KEY: testNearKey(),
      SVALIN_NEAR_RPC_URL: `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`,
      SVALIN_PREFERRED_NETWORK: "near",
    };
  });
  afterAll(() => new Promise<void>((resolve) => rpc.close(() => resolve())));

  it("lists read-only tools", async () => {
    const { apiFetch } = harness();
    const { client } = await connect(apiFetch, {});
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "svalin_brief",
      "svalin_check_recipient",
      "svalin_check_recipient_free",
      "svalin_check_x402_payment",
      "svalin_portfolio",
      "svalin_risk_report",
      "svalin_risk_scan",
      "svalin_spend_status",
      "svalin_token_exit",
      "svalin_token_exit_free",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("quotes exit prices: a free trial, and the paid tool with your own sale size", async () => {
    const trial = await (await connect(harness().apiFetch, {})).client.callTool({
      name: "svalin_token_exit_free",
      arguments: { contract: "token.v2.ref-finance.near" },
    });
    expect(JSON.parse(textOf(trial)).exit.quotes).toHaveLength(3);

    const { apiFetch, settled } = harness();
    const { client } = await connect(apiFetch, nearWallet);
    const result = await client.callTool({ name: "svalin_token_exit", arguments: { contract: "token.v2.ref-finance.near", amountUsd: 2_500 } });
    expect(result.isError).toBeFalsy();
    const exit = JSON.parse(textOf(result));
    expect(exit.grade).toBe("B");
    expect(exit.exit.quotes.map((quote: { saleUsd: number }) => quote.saleUsd)).toEqual([1_000, 2_500, 10_000, 100_000]);
    expect(settled[0]).toMatchObject({ network: "near:testnet", amount: "2000" });
  });

  it("checks a recipient before paying, passing the payer and amount to the API", async () => {
    const { apiFetch } = harness();
    const { client } = await connect(apiFetch, {});
    const result = await client.callTool({
      name: "svalin_check_recipient_free",
      arguments: { address: WALLET, payer: WALLET, amountUsd: 12.5 },
    });
    expect(JSON.parse(textOf(result))).toMatchObject({ recipient: WALLET, payer: WALLET, amountUsd: 12.5, verdict: "allow" });
  });

  it("free scan works without a wallet; paid tools explain how to enable payment", async () => {
    const { apiFetch } = harness();
    const { client } = await connect(apiFetch, {});
    const scan = await client.callTool({ name: "svalin_risk_scan", arguments: { address: WALLET } });
    expect(JSON.parse(textOf(scan)).grade).toMatch(/[A-F]/);

    const paid = await client.callTool({ name: "svalin_risk_report", arguments: { address: WALLET } });
    expect(paid.isError).toBe(true);
    expect(textOf(paid)).toMatch(/SVALIN_NEAR_PRIVATE_KEY/);
  });

  it("uses a Svalin key instead of paying, and never sends it to another service", async () => {
    const { apiFetch, facilitator, keyStore } = harness();
    const key = await issueKey(keyStore);
    const seen: { url: string; authorization: string | null }[] = [];
    const recording = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({ url: request.url, authorization: request.headers.get("Authorization") });
      return new URL(request.url).hostname === "svalin.test" ? apiFetch(request) : Promise.resolve(new Response("no", { status: 404 }));
    }) as typeof fetch;
    const { client } = await connect(recording, { SVALIN_API_KEY: key });

    const report = await client.callTool({ name: "svalin_risk_report", arguments: { address: WALLET } });
    expect(report.isError).toBeFalsy();
    expect(JSON.parse(textOf(report)).grade).toMatch(/[A-F]/);
    expect(facilitator.verifyCalls).toBe(0);
    const status = JSON.parse(textOf(await client.callTool({ name: "svalin_spend_status", arguments: {} })));
    expect(status.svalinKey).toMatchObject({ kind: "key", plan: "business", callsLeft: 9 });

    await client.callTool({ name: "svalin_check_x402_payment", arguments: { url: "https://other.test/paid" } });
    expect(seen.find((entry) => entry.url.startsWith("https://other.test"))?.authorization).toBeNull();
    expect(seen.filter((entry) => entry.url.startsWith("http://svalin.test")).every((entry) => entry.authorization === `Bearer ${key}`)).toBe(true);
  });

  it("pays $0.02 in USDC on NEAR for a brief and the API records the payment", async () => {
    const { apiFetch, settled, facilitator } = harness();
    const { client, svalin } = await connect(apiFetch, nearWallet);

    const result = await client.callTool({ name: "svalin_brief", arguments: { address: "svalin-sample.near" } });
    expect(result.isError).toBeFalsy();
    const brief = JSON.parse(textOf(result));
    expect(brief.headline).toMatch(/^Grade [A-F]/);
    expect(brief.risk.chain).toBe("near");

    // The payment is a real NEAR delegate action: one ft_transfer of the USDC price to the payee.
    const decoded = decodeSignedDelegateB64(facilitator.signedDelegates[0]);
    expect(decoded.verifySignature()).toBe(true);
    expect(decoded.delegate).toMatchObject({ senderId: PAYER, receiverId: TESTNET_USDC, nonce: 42n });
    expect(parseFtTransferArgs(decoded.delegate.functionCall!.args)).toMatchObject({ receiver_id: PAY_TO_NEAR, amount: "20000" });

    expect(facilitator.verifyCalls).toBe(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ network: "near:testnet", payTo: PAY_TO_NEAR, amount: "20000", payer: PAYER });
    expect(svalin.payers.near).toBe(PAYER);
  });

  it("does not settle a payment when the account does not exist", async () => {
    const { apiFetch, settled, facilitator } = harness();
    const { client } = await connect(apiFetch, nearWallet);

    const result = await client.callTool({ name: "svalin_risk_report", arguments: { address: MISSING_ACCOUNT } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/404/);
    expect(facilitator.verifyCalls).toBe(1);
    expect(settled).toHaveLength(0);
  });

  it("refuses to pay past the session budget", async () => {
    const { apiFetch, settled } = harness();
    const { client } = await connect(apiFetch, { ...nearWallet, SVALIN_BUDGET_USD: "0.03" });

    const first = await client.callTool({ name: "svalin_brief", arguments: { address: WALLET } });
    expect(first.isError).toBeFalsy();
    const second = await client.callTool({ name: "svalin_brief", arguments: { address: WALLET } });
    expect(second.isError).toBe(true);
    expect(textOf(second)).toMatch(/session budget/);
    expect(settled).toHaveLength(1);
  });

  it("checks an x402 payment before paying: remembers the payee, then blocks a changed one", async () => {
    const { apiFetch } = harness();
    let payTo = "good-shop.near";
    const shop = (async () => {
      const header = encodePaymentRequiredHeader({
        x402Version: 2,
        resource: { url: "https://shop.test/report" },
        accepts: [{ scheme: "exact", network: "near:mainnet", asset: NEAR_USDC, amount: "10000", payTo, maxTimeoutSeconds: 60, extra: {} }],
      });
      return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header } });
    }) as typeof fetch;
    const routed = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).startsWith("https://shop.test") ? shop(input, init) : apiFetch(input, init)) as typeof fetch;
    const { client } = await connect(routed, {});

    const first = JSON.parse(textOf(await client.callTool({ name: "svalin_check_x402_payment", arguments: { url: "https://shop.test/report" } })));
    expect(first.options[0]).toMatchObject({ network: "near:mainnet", payTo: "good-shop.near", price: "$0.01" });
    const firstCodes = first.options[0].reasons.map((reason: { code: string }) => reason.code);
    expect(firstCodes).toContain("new-service");
    // Svalin's recipient check of the payee ran too (the free trial: this server has no wallet).
    expect(firstCodes.some((code: string) => code.startsWith("payee-"))).toBe(true);

    payTo = "g00d-shop.near";
    const second = JSON.parse(textOf(await client.callTool({ name: "svalin_check_x402_payment", arguments: { url: "https://shop.test/report" } })));
    expect(second.verdict).toBe("block");
    expect(second.options[0].reasons.map((reason: { code: string }) => reason.code)).toContain("payee-changed");
  });

  it("refuses to pay Svalin itself if its payee changed since first seen", async () => {
    const { apiFetch, settled } = harness();
    const file = memoryFile();
    writeFileSync(
      file,
      JSON.stringify({
        "http://svalin.test": { "near:testnet": { payTo: "someone-else.testnet", asset: TESTNET_USDC, amount: "20000", firstSeen: "2026-10-20T00:00:00.000Z" } },
      }),
    );
    const { client } = await connect(apiFetch, { ...nearWallet, SVALIN_PAYEE_MEMORY: file });

    const result = await client.callTool({ name: "svalin_brief", arguments: { address: WALLET } });
    expect(result.isError).toBe(true);
    expect(settled).toHaveLength(0);
  });
});
