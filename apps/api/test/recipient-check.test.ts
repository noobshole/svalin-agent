import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { assessRecipient, looksAlike, namesLookAlike, namesNearlyAlike, type RecipientSignals } from "../src/risk/check.js";
import { HeliusPortfolioSource, transferCounterparties, type SolanaParsedTransaction } from "../src/sources/helius-source.js";
import { NearPortfolioSource, transferCounterpartiesNear } from "../src/sources/near-source.js";
import { SOLANA_WALLET, testConfig } from "./helpers.js";

const NOW = new Date("2026-10-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const PAYEE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
// Same first and last four characters as PAYEE, different in between: an address-poisoning lure.
const LURE = "9WzDzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzAWWM";

const base: RecipientSignals = {
  chain: "solana",
  recipient: PAYEE,
  payer: SOLANA_WALLET,
  kind: "wallet",
  createdAt: NOW.getTime() - 300 * DAY,
  transactions: 250,
  transactionsAtLeast: false,
  payerSentTo: [],
  payerReceivedFrom: [],
  dataSource: "test",
};
const codes = (check: ReturnType<typeof assessRecipient>) => check.reasons.map((reason) => reason.code);

describe("recipient check rules", () => {
  it("allows an established wallet, and says why", () => {
    const check = assessRecipient(base, 50, NOW);
    expect(check.verdict).toBe("allow");
    expect(codes(check)).toEqual(["established"]);
    expect(check.reasons[0].message).toBe("An established address: 300 days old, 250 transactions.");
  });

  it("blocks an address that imitates one the payer paid, the address-poisoning pattern", () => {
    expect(looksAlike(LURE, PAYEE)).toBe(true);
    expect(looksAlike(PAYEE, PAYEE)).toBe(false);
    expect(looksAlike("alice.near", "alice.near")).toBe(false);

    const check = assessRecipient({ ...base, recipient: LURE, payerSentTo: [PAYEE], payerReceivedFrom: [LURE] }, 10, NOW);
    expect(check.verdict).toBe("block");
    expect(check.signals).toMatchObject({ lookalikeOf: PAYEE, sentToPayer: true, paidBefore: false });
    expect(check.reasons[0].message).toContain("sent this wallet a transfer first");
  });

  it("blocks NEAR names that read like one the payer paid, and cautions on names one letter off", () => {
    expect(namesLookAlike("binancehot.near", "binance-hot.near")).toBe(true);
    expect(namesLookAlike("b1nance-wallet.near", "blnance-wallet.near")).toBe(true);
    expect(namesLookAlike("rnyshop.near", "myshop.near")).toBe(true);
    expect(namesLookAlike("mail.near", "mall.near")).toBe(false);
    expect(namesLookAlike("alice.near", "bob.near")).toBe(false);
    expect(namesLookAlike("a".repeat(64), "a".repeat(63) + "b")).toBe(false);
    expect(namesNearlyAlike("treasuryops.near", "treasuryop.near")).toBe(true);
    expect(namesNearlyAlike("bob1.near", "bob2.near")).toBe(false);

    const near = { ...base, chain: "near" as const, payer: "payer.near" };
    const lure = assessRecipient({ ...near, recipient: "binancehot.near", payerSentTo: ["binance-hot.near"] }, 10, NOW);
    expect([lure.verdict, codes(lure), lure.signals.lookalikeOf]).toEqual(["block", ["lookalike"], "binance-hot.near"]);
    const typo = assessRecipient({ ...near, recipient: "treasuryop.near", payerSentTo: ["treasuryops.near"] }, 10, NOW);
    expect([typo.verdict, codes(typo), typo.signals.similarTo]).toEqual(["caution", ["similar-name"], "treasuryops.near"]);
    // Solana addresses keep the first-and-last-characters rule only.
    expect(codes(assessRecipient({ ...base, payerSentTo: [PAYEE.toLowerCase()] }, 10, NOW))).toEqual(["established"]);
  });

  it("blocks addresses that are not wallets, and NEAR accounts that do not exist", () => {
    expect(assessRecipient({ ...base, kind: "token" }, null, NOW).verdict).toBe("block");
    expect(assessRecipient({ ...base, kind: "program" }, null, NOW).verdict).toBe("block");
    expect(assessRecipient({ ...base, kind: "token-account" }, null, NOW).verdict).toBe("block");
    const missing = assessRecipient({ ...base, chain: "near", recipient: "nobody-here.near", kind: "missing" }, null, NOW);
    expect([missing.verdict, codes(missing)]).toEqual(["block", ["missing-account"]]);
  });

  it("cautions on new, barely used, unused, contract and unreadable recipients", () => {
    const fresh = assessRecipient({ ...base, createdAt: NOW.getTime() - 2 * 60 * 60 * 1000, transactions: 2 }, null, NOW);
    expect([fresh.verdict, codes(fresh)]).toEqual(["caution", ["new-recipient", "few-transactions"]]);
    expect(fresh.reasons[0].message).toContain("less than a day old");

    expect(codes(assessRecipient({ ...base, kind: "unused", createdAt: null, transactions: 0 }, null, NOW))).toEqual(["unused-address"]);
    expect(codes(assessRecipient({ ...base, chain: "near", recipient: "dao.sputnik-dao.near", kind: "contract" }, null, NOW))).toEqual([
      "contract-account",
    ]);
    expect(codes(assessRecipient({ ...base, createdAt: null, transactions: null }, null, NOW))).toEqual(["history-unavailable"]);
    // A capped count means "at least this many": not a reason for caution.
    expect(assessRecipient({ ...base, createdAt: null, transactions: 1000, transactionsAtLeast: true }, null, NOW).verdict).toBe("allow");
  });

  it("cautions on a large first payment, and notes a payee paid before", () => {
    expect(codes(assessRecipient(base, 250, NOW))).toEqual(["first-payment"]);
    expect(assessRecipient(base, 99, NOW).verdict).toBe("allow");
    // Without a payer there is no history to compare, so no first-payment caution either.
    expect(assessRecipient({ ...base, payer: null, payerSentTo: null, payerReceivedFrom: null }, 5000, NOW).verdict).toBe("allow");
    const repeat = assessRecipient({ ...base, payerSentTo: [PAYEE] }, 5000, NOW);
    expect([repeat.verdict, codes(repeat)]).toEqual(["allow", ["paid-before", "established"]]);
  });

  it("never reads an unreadable payer history as 'no payments'", () => {
    const unknown = assessRecipient({ ...base, recipient: LURE, payerSentTo: null, payerReceivedFrom: null }, 250, NOW);
    expect([unknown.verdict, codes(unknown)]).toEqual(["caution", ["payer-history-unavailable"]]);
  });
});

describe("Solana history", () => {
  it("finds whom the payer paid and was paid by, in SOL and in tokens", () => {
    const transaction: SolanaParsedTransaction = {
      meta: {
        err: null,
        innerInstructions: [],
        preTokenBalances: [
          { accountIndex: 1, mint: "USDC", owner: SOLANA_WALLET, uiTokenAmount: { amount: "5000000" } },
          { accountIndex: 2, mint: "USDC", owner: PAYEE, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: "USDC", owner: SOLANA_WALLET, uiTokenAmount: { amount: "4000000" } },
          { accountIndex: 2, mint: "USDC", owner: PAYEE, uiTokenAmount: { amount: "1000000" } },
        ],
      },
      transaction: {
        message: {
          instructions: [{ program: "system", parsed: { type: "transfer", info: { source: LURE, destination: SOLANA_WALLET } } }],
        },
      },
    };
    expect(transferCounterparties(SOLANA_WALLET, transaction)).toEqual({ sentTo: [PAYEE], receivedFrom: [LURE] });
    expect(transferCounterparties(SOLANA_WALLET, { ...transaction, meta: { ...transaction.meta, err: { failed: true } } })).toEqual({
      sentTo: [],
      receivedFrom: [],
    });
  });

  it("reads kind, age and activity, and treats a never-used address as unused", async () => {
    const calls: string[] = [];
    const source = new HeliusPortfolioSource("https://rpc.example", (async (_url, init) => {
      const { method, params } = JSON.parse(String(init?.body));
      calls.push(method);
      if (method === "getAccountInfo") return Response.json({ result: { value: null } });
      if (method === "getSignaturesForAddress" && params[0] === LURE) return Response.json({ result: [] });
      if (method === "getSignaturesForAddress") return Response.json({ result: [{ signature: "s1", blockTime: 1_700_000_000 }] });
      return Response.json({ result: { meta: { err: null }, transaction: { message: { instructions: [] } } } });
    }) as typeof fetch);

    const unused = await source.inspectRecipient(LURE, null);
    expect(unused).toMatchObject({ kind: "unused", transactions: 0, createdAt: null, payerSentTo: null });

    const known = await source.inspectRecipient(PAYEE, SOLANA_WALLET);
    expect(known).toMatchObject({ kind: "wallet", transactions: 1, createdAt: 1_700_000_000_000, payerSentTo: [], payerReceivedFrom: [] });
    expect(calls.filter((method) => method === "getTransaction")).toHaveLength(1);
  });
});

describe("NEAR history", () => {
  const payer = "payer.near";
  const args = (value: object) => btoa(JSON.stringify(value));
  // The payer's recent transactions, in the FastNEAR transactions API's raw format.
  const records = [
    { transaction: { signer_id: payer, receiver_id: "friend.near", actions: [{ Transfer: { deposit: "1" } }] } },
    { transaction: { signer_id: payer, receiver_id: "app.near", actions: [{ FunctionCall: { method_name: "vote", args: args({}) } }] } },
    {
      // A relayed USDC payment, the way x402 pays on NEAR: the relayer signs, the payer sends.
      transaction: {
        signer_id: "relayer.near",
        receiver_id: payer,
        actions: [
          {
            Delegate: {
              delegate_action: {
                sender_id: payer,
                receiver_id: "usdc.near",
                actions: [{ FunctionCall: { method_name: "ft_transfer", args: args({ receiver_id: "shop.near", amount: "5" }) } }],
              },
            },
          },
        ],
      },
    },
    // Bait: someone else sends the payer a token first.
    {
      transaction: {
        signer_id: "bait.near",
        receiver_id: "usdc.near",
        actions: [{ FunctionCall: { method_name: "ft_transfer", args: args({ receiver_id: payer, amount: "1" }) } }],
      },
    },
  ];

  function nearSource(view: "wallet" | "contract" | "missing", txApiDown = false) {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("prices.example")) return Response.json({ "token.v2.ref-finance.near": { price: "0.05", decimal: 18, symbol: "REF" } });
      if (target.includes("rpc.example")) {
        if (view === "missing") return Response.json({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } });
        return Response.json({ result: { code_hash: view === "contract" ? "Cx1" : "11111111111111111111111111111111" } });
      }
      if (target === "https://tx.example/v0/transactions") {
        return txApiDown ? new Response("busy", { status: 503 }) : Response.json({ transactions: records });
      }
      if (target === "https://tx.example/v0/account") {
        const body = JSON.parse(String(init?.body)) as { account_id: string; desc?: boolean };
        if (body.account_id === payer) {
          return Response.json({ account_txs: ["h1", "h2", "h3", "h4"].map((hash) => ({ transaction_hash: hash })), txs_count: 4 });
        }
        if (body.desc === false) {
          return Response.json({ account_txs: [{ transaction_hash: "c1", tx_block_timestamp: String((NOW.getTime() - 2 * DAY) * 1e6) }] });
        }
        return Response.json({ account_txs: [{ transaction_hash: "l1" }], txs_count: 3 });
      }
      throw new Error(`unexpected ${target} ${String(init?.body)}`);
    }) as typeof fetch;
    return new NearPortfolioSource(
      {
        apiUrl: "https://fastnear.example",
        rpcUrl: "https://rpc.example",
        priceUrl: "https://prices.example/list",
        poolsUrl: "https://pools.example/list",
        txApiUrl: "https://tx.example",
      },
      fetchImpl,
    );
  }

  it("reads age, activity and the payer's recent transfers, relayed ones included", async () => {
    const signals = await nearSource("wallet").inspectRecipient("friend.near", payer);
    expect(signals).toMatchObject({
      kind: "wallet",
      createdAt: NOW.getTime() - 2 * DAY,
      transactions: 3,
      payerSentTo: ["friend.near", "shop.near"],
      payerReceivedFrom: ["bait.near"],
      dataSource: "fastnear",
    });
    const check = assessRecipient(signals, 20, NOW);
    expect([check.verdict, codes(check)]).toEqual(["caution", ["new-recipient", "few-transactions", "paid-before"]]);
  });

  it("finds counterparties in a batch of raw transactions", () => {
    expect(transferCounterpartiesNear(payer, records)).toEqual({ sentTo: ["friend.near", "shop.near"], receivedFrom: ["bait.near"] });
    // A contract call that pays the payer from inside the contract; refunds and failed steps do not count.
    const transfer = (from: string, to: string) => ({ receipt: { predecessor_id: from, receiver_id: to, receipt: { Action: { actions: [{ Transfer: { deposit: "5" } }] } } } });
    const payout = {
      transaction: { signer_id: "launchpad.near", receiver_id: "launchpad.near", actions: [{ FunctionCall: { method_name: "pay_holders", args: args({}) } }] },
      receipts: [
        transfer("launchpad.near", payer),
        transfer("system", payer),
        { ...transfer(payer, "gone.near"), execution_outcome: { outcome: { status: { Failure: {} } } } },
      ],
    };
    expect(transferCounterpartiesNear(payer, [payout])).toEqual({ sentTo: [], receivedFrom: ["launchpad.near"] });
    expect(transferCounterpartiesNear(payer, [{ transaction: { signer_id: payer, receiver_id: "x.near", actions: [{ FunctionCall: { args: "not base64!" } }] } }])).toEqual({
      sentTo: [],
      receivedFrom: [],
    });
  });

  it("reports the payer's history as unreadable when part of it fails", async () => {
    const signals = await nearSource("wallet", true).inspectRecipient("friend.near", payer);
    expect(signals.payerSentTo).toBeNull();
    expect(codes(assessRecipient(signals, 20, NOW))).toContain("payer-history-unavailable");
  });

  it("tells tokens, contracts and missing accounts apart", async () => {
    expect((await nearSource("wallet").inspectRecipient("token.v2.ref-finance.near", null)).kind).toBe("token");
    expect((await nearSource("contract").inspectRecipient("dao.sputnik-dao.near", null)).kind).toBe("contract");
    expect((await nearSource("missing").inspectRecipient("nobody-here.near", null)).kind).toBe("missing");
    expect((await nearSource("missing").inspectRecipient("a".repeat(64), null)).kind).toBe("unused");
  });
});

describe("recipient check routes", () => {
  const app = createApp(testConfig());

  it("answers the free demo with a verdict", async () => {
    const response = await app.request(`/v1/demo/check/${PAYEE}?payer=${SOLANA_WALLET}&amountUsd=25`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ recipient: PAYEE, payer: SOLANA_WALLET, amountUsd: 25, verdict: "allow" });
    // The free demo skips the payer's history, and says so instead of cautioning.
    expect(body.reasons.map((reason: { code: string }) => reason.code)).toEqual(["payer-history-skipped", "established"]);
  });

  it("rejects a bad payer or amount before any payment", async () => {
    const mismatch = await app.request(`/v1/check/${PAYEE}?payer=alice.near`);
    expect([mismatch.status, (await mismatch.json()).code]).toEqual([400, "chain_mismatch"]);
    const amount = await app.request(`/v1/check/${PAYEE}?amountUsd=-5`);
    expect([amount.status, (await amount.json()).code]).toEqual([400, "invalid_amount"]);
    const payer = await app.request(`/v1/check/${PAYEE}?payer=Not-An-Address`);
    expect([payer.status, (await payer.json()).code]).toEqual([400, "invalid_payer"]);
  });

  it("documents the check with its query parameters", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    const names = spec.paths["/v1/check/{address}"].get.parameters.map((parameter: { name: string }) => parameter.name);
    expect(names).toEqual(["address", "payer", "amountUsd"]);
    expect(spec.paths["/v1/check/{address}"].get["x-payment-info"].price.amount).toBe("0.002000");
  });
});
