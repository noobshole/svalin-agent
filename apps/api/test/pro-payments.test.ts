import { describe, expect, it } from "vitest";

import { nearPaymentsReceived, nearUsdcReceived, solanaPaymentsByReference, usdcAtomic, usdcDecimal, usdcReceived } from "../src/payments/pro-payments.js";
import nearPayment from "./fixtures/near-testnet-usdc-payment.json" with { type: "json" };
import solanaPayment from "./fixtures/solana-devnet-usdc-payment.json" with { type: "json" };

// Real transactions: a 0.004 USDC x402 payment to Svalin on Solana devnet, and one on NEAR testnet.
const SVALIN_SOLANA = "AzfdbWXPC3BiPJqaeHsGqzZw8NoxYSZkZMob1VNivGBo";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

type Receipts = Parameters<typeof nearUsdcReceived>[0];

describe("Solana Pay payments", () => {
  it("counts what Svalin's USDC accounts gained, from the balances before and after", () => {
    expect(usdcReceived(solanaPayment.meta, SVALIN_SOLANA, DEVNET_USDC)).toBe(4000n);
    // The payer's side is a loss, a fake token is nothing.
    expect(usdcReceived(solanaPayment.meta, "2Z174bRdxeQWow5bamH9UE8kdsmC4cbEwUYVVufq36ES", DEVNET_USDC)).toBe(-4000n);
    expect(usdcReceived(solanaPayment.meta, SVALIN_SOLANA, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(0n);
  });

  it("finds payments by reference and skips failed transactions", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
      calls.push(method);
      if (method === "getSignaturesForAddress") {
        expect(params[0]).toBe("ref111");
        return Response.json({ result: [{ signature: "good", err: null }, { signature: "failed", err: { InstructionError: [0, "Custom"] } }] });
      }
      return Response.json({ result: solanaPayment });
    }) as typeof fetch;

    const found = await solanaPaymentsByReference({ rpcUrl: "https://rpc", network: DEVNET, reference: "ref111", payTo: SVALIN_SOLANA, mint: DEVNET_USDC, fetchImpl });
    expect(found).toEqual([{ tx: "good", network: DEVNET, atomic: "4000", at: solanaPayment.blockTime * 1000 }]);
    expect(calls).toEqual(["getSignaturesForAddress", "getTransaction"]);
  });

  it("fetches only the transactions not read before, and returns those that paid nothing too", async () => {
    const fetched: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
      if (method === "getSignaturesForAddress") {
        return Response.json({ result: ["old", "junk", "late", "partial", "good"].map((signature) => ({ signature, err: null })) });
      }
      const signature = params[0] as string;
      fetched.push(signature);
      if (signature === "late") return Response.json({ result: null });
      if (signature === "partial") return Response.json({ result: { ...solanaPayment, meta: { ...solanaPayment.meta, postTokenBalances: undefined } } });
      if (signature === "junk") return Response.json({ result: { ...solanaPayment, meta: { ...solanaPayment.meta, err: { InstructionError: [0, "Custom"] } } } });
      return Response.json({ result: solanaPayment });
    }) as typeof fetch;

    const found = await solanaPaymentsByReference({
      rpcUrl: "https://rpc",
      network: DEVNET,
      reference: "ref",
      payTo: SVALIN_SOLANA,
      mint: DEVNET_USDC,
      unread: async (signatures) => signatures.filter((signature) => signature !== "old"),
      fetchImpl,
    });
    expect(fetched).toEqual(["junk", "late", "partial", "good"]);
    // "late" is not on the RPC yet and "partial" came without balances, so both are left for the
    // next lookup; a failed one paid nothing.
    expect(found.map((payment) => [payment.tx, payment.atomic])).toEqual([
      ["junk", "0"],
      ["good", "4000"],
    ]);
  });

  it("reports an unreadable chain as a 502, so the buyer can retry", async () => {
    const fetchImpl = (async () => Response.json({ error: { code: -32005, message: "busy" } })) as unknown as typeof fetch;
    await expect(
      solanaPaymentsByReference({ rpcUrl: "https://rpc", network: DEVNET, reference: "r", payTo: SVALIN_SOLANA, mint: DEVNET_USDC, fetchImpl }),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("NEAR payments", () => {
  const receipts = nearPayment.receipts as Receipts;

  it("counts the USDC contract's own transfer events, relayed or not", () => {
    expect(nearUsdcReceived(receipts, "svalin-agent.testnet", TESTNET_USDC)).toBe(4000n);
    expect(nearUsdcReceived(receipts, "svalin-agent.testnet", "fake-usdc.testnet")).toBe(0n);
  });

  it("ignores events from failed receipts and nets out refunds", () => {
    const event = (from: string, to: string, amount: string) =>
      `EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: from, new_owner_id: to, amount }] })}`;
    const receipt = (logs: string[], status: Record<string, unknown>) => ({
      receipt: { receiver_id: TESTNET_USDC },
      execution_outcome: { outcome: { logs, status } },
    });
    expect(nearUsdcReceived([receipt([event("a", "svalin", "5000000")], { Failure: {} })], "svalin", TESTNET_USDC)).toBe(0n);
    expect(
      nearUsdcReceived(
        [receipt([event("a", "svalin", "5000000")], { SuccessReceiptId: "x" }), receipt([event("svalin", "a", "5000000")], { SuccessValue: "" })],
        "svalin",
        TESTNET_USDC,
      ),
    ).toBe(0n);
  });

  it("reads Svalin's recent transactions and keeps those after the checkout began", async () => {
    const at = Math.floor(1793164468308917855 / 1e6);
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (url.endsWith("/v0/account")) {
        expect(body).toMatchObject({ account_id: "svalin-agent.testnet", is_event_log: true, is_success: true });
        return Response.json({
          account_txs: [
            { transaction_hash: "7USoPGh4w221dS8FMoSvK78VHJz6Nn7tTBUDZouZkQ5y", tx_block_timestamp: "1793164468308917855" },
            { transaction_hash: "older", tx_block_timestamp: "1700000000000000000" },
          ],
        });
      }
      expect(body.tx_hashes).toEqual(["7USoPGh4w221dS8FMoSvK78VHJz6Nn7tTBUDZouZkQ5y"]);
      return Response.json({ transactions: [nearPayment] });
    }) as typeof fetch;

    const found = await nearPaymentsReceived({
      txApiUrl: "https://tx",
      network: "near:testnet",
      payTo: "svalin-agent.testnet",
      token: TESTNET_USDC,
      since: at - 60_000,
      fetchImpl,
    });
    expect(found).toEqual([{ tx: "7USoPGh4w221dS8FMoSvK78VHJz6Nn7tTBUDZouZkQ5y", network: "near:testnet", atomic: "4000", at }]);
  });

  it("reads back page by page to the checkout, fetches only unread transactions, and leaves the newest for later", async () => {
    const now = 1_800_000_000_000;
    const since = now - 2 * 86_400_000;
    const ns = (ms: number) => String(ms * 1e6);
    // Newest first: one too fresh to trust yet, then 49 more on the first page, then a second page that reaches past the checkout.
    const first = [
      { transaction_hash: "fresh", tx_block_timestamp: ns(now - 5_000) },
      ...Array.from({ length: 49 }, (_, index) => ({ transaction_hash: `p1-${index}`, tx_block_timestamp: ns(now - 60_000 * (index + 1)) })),
    ];
    const second = [
      { transaction_hash: "p2-in", tx_block_timestamp: ns(since + 2_000) },
      { transaction_hash: "p2-no-receipts", tx_block_timestamp: ns(since + 1_000) },
      { transaction_hash: "p2-before", tx_block_timestamp: ns(since - 1_000) },
    ];
    const pages: unknown[] = [];
    let asked: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { resume_token?: string; tx_hashes?: string[] };
      if (url.endsWith("/v0/account")) {
        pages.push(body.resume_token ?? null);
        return Response.json(body.resume_token ? { account_txs: second, resume_token: "next-2" } : { account_txs: first, resume_token: "next-1" });
      }
      asked = [...asked, ...(body.tx_hashes ?? [])];
      return Response.json({
        transactions: (body.tx_hashes ?? []).map((hash) => ({ ...nearPayment, execution_outcome: { id: hash }, ...(hash === "p2-no-receipts" ? { receipts: [] } : {}) })),
      });
    }) as typeof fetch;

    const found = await nearPaymentsReceived({
      txApiUrl: "https://tx",
      network: "near:testnet",
      payTo: "svalin-agent.testnet",
      token: TESTNET_USDC,
      since,
      now,
      unread: async (hashes) => hashes.filter((hash) => !hash.startsWith("p1-")),
      fetchImpl,
    });
    expect(pages).toEqual([null, "next-1"]);
    expect(asked).toEqual(["p2-in", "p2-no-receipts"]);
    // A record without its receipts is not read in full, so it waits for the next lookup.
    expect(found.map((payment) => payment.tx)).toEqual(["p2-in"]);
  });
});

describe("USDC amounts", () => {
  it("converts between dollars and atomic units", () => {
    expect(usdcAtomic(5)).toBe("5000000");
    expect(usdcAtomic(48)).toBe("48000000");
    expect(usdcDecimal("5004217")).toBe("5.004217");
    expect(usdcDecimal("42")).toBe("0.000042");
  });
});
