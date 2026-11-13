// The demo agent with a real model in charge. A model on NEAR AI Cloud reads each answer from the
// service, a 402 quote or the data, and chooses what to do next: pay the quote, fetch another path
// on the same service, or stop. The code only carries out its choice; it never pays on its own, and
// an answer it cannot read stops the task.
//
// The model is told what a normal buying agent knows: the task, the service's listing, what it
// bought earlier, and the time. It is not told about the vault's rules. Whatever it decides to pay
// still goes through the vault, which pays, holds or refuses it.
import { DemoAgent } from "./agent.mjs";

const SYSTEM = [
  "You are a purchasing agent working for your user. You buy data from paid HTTP APIs that use x402:",
  "a request without payment gets the answer 402 with a quote (payTo: the account to pay, amount: in the",
  "asset's smallest unit, expiresAt: a Unix time in milliseconds). After you pay, the data is fetched again",
  "with your payment. The asset is USDC, with 6 decimals: an amount of 50000 is 0.05 USDC.",
  "Your payments go through your user's vault on NEAR, which tells you whether it paid.",
  "After each answer from the service, reply with one JSON object and nothing else:",
  '{"action": "pay" | "fetch" | "done", "path": "/... (only with fetch)", "reason": "one short sentence"}',
  "pay: pay the quote in the last 402 answer. fetch: request another path on the same service. done: stop.",
].join("\n");

const ACTIONS = new Set(["pay", "fetch", "done"]);
const MAX_TOKENS = 6000;

/** The model's choice, or `done` when the answer cannot be read. */
export function readChoice(content) {
  const match = String(content).match(/\{[\s\S]*\}/);
  try {
    const choice = JSON.parse(match?.[0] ?? "");
    if (!ACTIONS.has(choice.action)) throw new Error("unknown action");
    const path = typeof choice.path === "string" && choice.path.startsWith("/") ? choice.path.slice(0, 200) : undefined;
    return { action: choice.action, path, reason: String(choice.reason ?? "").slice(0, 300) };
  } catch {
    return { action: "done", reason: "The model's answer could not be read, so the agent stopped." };
  }
}

const usdc = (atomic) => `${(Number(atomic) / 1e6).toFixed(2)} USDC`;

export class ModelAgent extends DemoAgent {
  constructor({ vault, key, model, maxSteps = 4 }) {
    super({ vault, key });
    this.model = model;
    this.maxSteps = maxSteps;
    this.bought = [];
  }

  async fetchPath(url, tx) {
    const response = await fetch(url, tx ? { headers: { "x-payment-tx": tx } } : {});
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { text: text.slice(0, 500) };
    }
    const { pathname, search } = new URL(url);
    return { path: pathname + search, status: response.status, body };
  }

  brief(task, listing) {
    const earlier = this.bought.length
      ? this.bought.map((entry) => `- ${entry.path}: paid ${usdc(entry.amount)}, transaction ${entry.tx}`).join("\n")
      : "- nothing yet";
    return `Task: ${task}\nThe service's listing: ${JSON.stringify(listing)}\nWhat you bought from this service earlier today:\n${earlier}`;
  }

  observe(last) {
    const now = Date.now();
    if (last.status === "vault") {
      return `Your vault's answer to that payment: ${last.body.outcome}${last.body.reasons?.length ? `, reasons ${last.body.reasons.join(", ")}` : ""}. Nothing was paid. Time now: ${now}.`;
    }
    return `GET ${last.path} answered ${last.status}:\n${JSON.stringify(last.body)}\nTime now: ${now} (${new Date(now).toISOString()}).`;
  }

  /** Works on one task, starting at `url`, and returns every step the model took. */
  async run(task, url) {
    const { origin } = new URL(url);
    const listing = (await this.fetchPath(`${origin}/listing`)).body;
    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: this.brief(task, listing) },
    ];
    const steps = [];
    const payments = [];
    const receipts = new Map();
    let last = await this.fetchPath(url);
    for (let step = 0; step < this.maxSteps; step += 1) {
      messages.push({ role: "user", content: this.observe(last) });
      // A reasoning model spends tokens thinking before it answers: leave room for both.
      const answer = await this.model.chat(messages, { maxTokens: MAX_TOKENS });
      messages.push({ role: "assistant", content: answer.content });
      const choice = readChoice(answer.content);
      const signature = await this.model.signature(answer).catch((error) => ({ verified: false, problem: error.message }));
      steps.push({ seen: last.status, ...choice, chat: answer.id, finish: answer.finish, tokens: answer.usage?.completion_tokens, verified: signature.verified, problem: signature.problem });

      if (choice.action === "pay" && last.status === 402) {
        const quote = last.body;
        const payment = await this.pay(`${origin}${last.path}`, quote, ` (decided by ${this.model.model}, ${answer.id})`);
        payments.push({ url: `${origin}${last.path}`, quote, chat: answer.id, ...payment });
        if (payment.outcome === "paid") {
          receipts.set(last.path, payment.tx);
          this.bought.push({ path: last.path, amount: quote.amount, tx: payment.tx });
          last = await this.fetchPath(`${origin}${last.path}`, payment.tx);
        } else {
          last = { path: last.path, status: "vault", body: { outcome: payment.outcome, reasons: payment.reasons } };
        }
        continue;
      }
      if (choice.action === "fetch" && choice.path) {
        last = await this.fetchPath(`${origin}${choice.path}`, receipts.get(choice.path));
        continue;
      }
      break;
    }
    return { steps, payments, last };
  }
}
