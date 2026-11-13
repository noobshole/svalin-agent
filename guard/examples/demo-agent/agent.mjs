// The demo agent: a scripted buyer that pays through a Svalin Guard vault. It holds only the vault's
// agent key, which can call nothing but the vault's requests: `request_payment`, `request_buy` and
// `request_solana_payment`, and `collect_solana_withdrawal` for a withdrawal the owner has waited for.
//
// It is written to fall for every trick: it pays whatever a 402 answer asks, pays again when told
// the payment did not arrive, and follows instructions it finds in the data. So what is tested is the
// vault, not the agent.
import { createPublicKey, randomBytes, verify } from "node:crypto";

import { EXPLORER, call, settled, steadyFetch, view } from "./near.mjs";
import { SOLANA_DEVNET, SOLANA_EXPLORER, key, latestBlockhash, paymentMessage, tokenAccount } from "./solana.mjs";

const DECIDED = new Set(["payment_sent", "payment_held", "payment_refused"]);

/** The vault's decision on a payment, from its events. */
function decision(events) {
  const ours = events.filter((event) => event.standard === "svalin-guard");
  const last = ours.filter((event) => DECIDED.has(event.event)).at(-1);
  const failed = ours.some((event) => event.event === "payment_failed");
  if (!last) return { outcome: "unknown", reasons: [] };
  const outcome = failed ? "failed" : { payment_sent: "paid", payment_held: "held", payment_refused: "refused" }[last.event];
  return { outcome, reasons: last.data[0].reasons, imitates: last.data[0].imitates, heldId: last.data[0].held_id, checked: ours.some((e) => e.event === "payee_checked") };
}

/** An x402 v2 402 answer: the `PAYMENT-REQUIRED` header (base64 JSON), else the body. */
function paymentRequired(response, body) {
  const header = response.headers.get("payment-required");
  if (header) return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  return body;
}

export class DemoAgent {
  constructor({ vault, key }) {
    this.vault = vault;
    this.key = key;
  }

  /** Asks the vault to pay for one 402 quote. */
  async pay(url, quote, note = "") {
    const { origin, pathname, search } = new URL(url);
    const purchase = { service: origin, item: pathname + search, quote_expires_ms: quote.expiresAt };
    const tx = await call(this.key, this.vault, "request_payment", { payee: quote.payTo, amount: quote.amount, memo: `x402 ${pathname}${note}`, purchase });
    const { events, failures } = await settled(tx, this.vault, (found) => {
      const decided = decision(found);
      // A payment is settled once the token's transfer is in too.
      return decided.outcome === "held" || decided.outcome === "refused" || decided.outcome === "failed" || found.some((event) => event.standard === "nep141");
    });
    return { tx, link: `${EXPLORER}${tx}`, ...decision(events), failures };
  }

  /** Fetches `url`, paying through the vault when the service asks. */
  async get(url) {
    const first = await fetch(url);
    if (first.status !== 402) return { status: first.status, body: await first.json() };
    const quote = await first.json();
    const payment = await this.pay(url, quote);
    if (payment.outcome !== "paid") return { status: 402, quote, payment };
    const second = await fetch(url, { headers: { "x-payment-tx": payment.tx } });
    return { status: second.status, quote, payment, body: await second.json() };
  }

  /**
   * Asks the vault to buy `token` with `amount` of its own token in market pool `poolId`, showing
   * the liquidity grade it claims and that grade's proof. The vault answers through its events.
   */
  async buy({ token, amount, poolId, minOut = "1", grade }) {
    const tx = await call(this.key, this.vault, "request_buy", { token, amount: String(amount), pool_id: poolId, min_out: String(minOut), grade });
    const decided = (found) => found.filter((event) => event.standard === "svalin-guard" && ["buy_refused", "buy_settled"].includes(event.event));
    const { events, failures } = await settled(tx, this.vault, (found) => decided(found).length > 0);
    const last = decided(events).at(-1);
    const data = last?.data[0] ?? {};
    const outcome = !last ? "unknown" : last.event === "buy_refused" ? "refused" : BigInt(data.used ?? 0) > 0n ? "bought" : "failed";
    return { tx, link: `${EXPLORER}${tx}`, outcome, reasons: data.reasons ?? [], used: data.used, fee: data.fee, failures };
  }

  /** The vault's Solana settings and address, once. */
  async solana() {
    if (!this.solanaStatus) {
      const status = await view(this.vault, "status");
      if (!status.solana || !status.solana_address) throw new Error(`${this.vault} does not pay on Solana`);
      this.solanaStatus = { ...status.solana, address: status.solana_address };
    }
    return this.solanaStatus;
  }

  /**
   * Asks the vault to pay one x402 Solana quote. When it pays, the answer is the transaction NEAR's
   * signing network signed; the agent checks it is the payment it asked for before using it.
   */
  async paySolana(url, accept) {
    const solana = await this.solana();
    const { origin, pathname, search } = new URL(url);
    const purchase = { service: origin, item: pathname + search, quote_expires_ms: Date.now() + (accept.maxTimeoutSeconds ?? 60) * 1000 };
    const memo = accept.extra?.memo ?? randomBytes(16).toString("hex");
    const transaction = {
      fee_payer: accept.extra.feePayer,
      recent_blockhash: accept.extra.recentBlockhash ?? (await latestBlockhash()),
      source: tokenAccount(solana.address, solana.mint),
      destination: tokenAccount(accept.payTo, solana.mint),
    };
    // Enough for the vault, the signing network and the callback; NEAR reserves more than it burns.
    const tx = await call(this.key, this.vault, "request_solana_payment", { pay_to: accept.payTo, amount: accept.amount, memo, purchase, transaction }, { gas: 120_000_000_000_000n });
    const { events, failures, value } = await settled(tx, this.vault, (_, answer) => answer !== undefined);
    const result = { tx, link: `${EXPLORER}${tx}`, ...decision(events), failures, answer: value };
    if (value?.outcome !== "paid" || !value.payment) return { ...result, outcome: value?.outcome ?? result.outcome, reasons: value?.reasons ?? result.reasons };

    // Belt and braces: the signed message must be the payment asked for, signed by the vault.
    const wire = Buffer.from(value.payment.transaction, "base64");
    const message = wire.subarray(1 + 128);
    const expected = paymentMessage({
      feePayer: transaction.fee_payer,
      authority: solana.address,
      source: transaction.source,
      destination: transaction.destination,
      mint: solana.mint,
      amount: accept.amount,
      decimals: solana.decimals,
      memo,
      blockhash: transaction.recent_blockhash,
    });
    const vaultKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key(solana.address)]), format: "der", type: "spki" });
    if (!message.equals(expected) || !verify(null, message, vaultKey, wire.subarray(65, 129))) {
      return { ...result, outcome: "failed", reasons: ["NOT_THE_PAYMENT_ASKED_FOR"] };
    }
    return { ...result, outcome: "paid", transaction: value.payment.transaction };
  }

  /** Fetches `url` from an x402 seller on Solana, paying through the vault when it asks. */
  async getSolana(url) {
    const first = await steadyFetch(url);
    const firstBody = await first.json().catch(() => ({}));
    if (first.status !== 402) return { status: first.status, body: firstBody };
    const required = paymentRequired(first, firstBody);
    const solana = await this.solana();
    const accept = required.accepts?.find((option) => option.scheme === "exact" && option.network === solana.network && option.asset === solana.mint);
    if (!accept) return { status: 402, quote: null, payment: { outcome: "refused", reasons: ["NO_SOLANA_QUOTE_FOR_THIS_VAULT"] } };
    const quote = { ...accept, expiresAt: Date.now() + (accept.maxTimeoutSeconds ?? 60) * 1000 };
    const payment = await this.paySolana(url, accept);
    if (payment.outcome !== "paid") return { status: 402, quote, payment };

    const signature = { x402Version: 2, payload: { transaction: payment.transaction }, extensions: required.extensions, resource: required.resource, accepted: accept };
    // Safe to send again: the signed payment can land on Solana only once.
    const second = await steadyFetch(url, { headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(signature)).toString("base64") } }, { timeoutMs: 60_000 });
    const settledHeader = second.headers.get("payment-response");
    const settlement = settledHeader ? JSON.parse(Buffer.from(settledHeader, "base64").toString("utf8")) : null;
    if (settlement?.transaction) {
      payment.solanaTx = settlement.transaction;
      payment.solanaLink = `${SOLANA_EXPLORER}${settlement.transaction}${solana.network === SOLANA_DEVNET ? "?cluster=devnet" : ""}`;
    }
    return { status: second.status, quote, payment, settlement, body: await second.json().catch(() => ({})) };
  }
}
