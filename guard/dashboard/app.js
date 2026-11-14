// Svalin Guard dashboard: one vault's rules, the payments waiting for its owner, and every decision
// it made, read straight from NEAR. The owner's wallet changes the rules from here, and creates a
// new vault. The page has no server, and the wallet's key never reaches it; the two keys the browser
// does make (a fingerprint's device key, and a new vault's setup key, deleted when the vault is set
// up) cannot be read back out of it.
//
// Payees, memos, items and services are written by the agent or by a seller, so everything read
// from the chain goes on the page as text, never as HTML.
"use strict";

(() => {
  const NETWORKS = {
    testnet: {
      name: "testnet",
      label: "NEAR testnet",
      rpc: "https://rpc.testnet.fastnear.com",
      history: "https://tx.test.fastnear.com",
      explorer: "https://testnet.nearblocks.io/txns/",
    },
    mainnet: {
      name: "mainnet",
      label: "NEAR mainnet",
      rpc: "https://rpc.mainnet.fastnear.com",
      history: "https://tx.main.fastnear.com",
      explorer: "https://nearblocks.io/txns/",
    },
  };
  /**
   * The code hashes of the Svalin Guard builds this page trusts: 0.2.0, the build it deploys
   * itself (guard.wasm), and three earlier testnet builds that run the project's own demo vaults.
   * Any contract can answer `status()` with your name as its owner, so a vault is only treated as
   * one when it runs a build listed here and no key has full access to it. Add each new build.
   */
  const RELEASES = new Set([
    "2u1jejWMHwgMU2fX8GW3ut5CkirJU4jF5MwvRKyxve6F", // 0.2.0
    "5Tov3TB3osJJjSqZutVywo8NpBUuQ8PaRhtgGNckED2B", // earlier testnet build (vault7.svalin-demo.testnet)
    "EwBww6PpXguimG1ijW8cGBbKo2v5FoJ93M3AwktSRdoH", // earlier testnet build (vault5.svalin-demo.testnet)
    "8imaKox7WUecR9YeUvS2BRGagB4L48ayE2XxZCqyfKz7", // earlier testnet build (vault2.svalin-demo.testnet)
  ]);
  const ACCOUNT = /^(?=.{2,64}$)(?:(?:[a-z\d]+[-_])*[a-z\d]+\.)*(?:[a-z\d]+[-_])*[a-z\d]+$/;
  const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
  const REFRESH_MS = 20_000;
  /** How long a transaction may still gain events (a TEE check, a transfer callback). */
  const SETTLE_MS = 120_000;
  const PAGE = 200;
  const PAGES = 10;
  const BATCH = 20;
  const HELD_MAX_AGE_MS = 7 * 24 * 3_600_000;
  /** Events whose `id` is a held payment's. */
  const HELD_EVENTS = new Set(["payment_approved", "approval_recorded", "payment_rejected", "payment_cleared"]);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** The vault's reason codes, in plain words. */
  const REASONS = {
    FROZEN: "the vault is frozen",
    ZERO_AMOUNT: "nothing to pay",
    NOT_A_PAYEE: "the vault itself or the token it pays in",
    IMITATES_WELL_KNOWN: "reads like a well-known account",
    RESEMBLES_WELL_KNOWN: "one letter away from a well-known account",
    IMITATES_PAST_PAYEE: "reads like a payee this vault paid before",
    RESEMBLES_PAST_PAYEE: "one letter away from a payee this vault paid before",
    NEW_PAYEE_OVER_LIMIT: "over the limit for a new payee",
    OVER_PAYMENT_LIMIT: "over the per-payment limit",
    OVER_DAILY_LIMIT: "over the daily limit",
    POSSIBLE_DUPLICATE: "the same charge again within 15 minutes",
    PRICE_CHANGED: "more than the service's locked price",
    PAYEE_CHANGED: "not the service's locked payee",
    QUOTE_EXPIRED: "the seller's quote had expired",
    PAYEE_MISSING: "no such account",
    NEW_ACCOUNT: "an account created too recently",
    AGE_UNKNOWN: "an account with no keys to date it by",
    CHECK_FAILED: "the TEE check gave no answer",
    TOO_MANY_CHECKS: "today's checks are used up",
    BUYING_OFF: "buying is switched off",
    GRADE_TOO_LOW: "liquidity grade below the owner's minimum",
    STALE_PROOF: "the grade comes from an edition that is too old",
    BAD_PROOF: "the registry did not confirm the grade",
    NO_USABLE_EDITION: "the registry has no usable edition for that day",
    WRONG_METHODOLOGY: "graded by another methodology",
    SIGNING_FAILED: "NEAR's signing network gave no valid signature, so nothing was paid",
    POOL_NOT_APPROVED: "the owner has not approved this market pool",
    TOKEN_NOT_READY: "the vault could not register with the token, so nothing was bought",
  };
  const SOLANA = "solana:";
  /** Solana's networks as x402 names them, with the explorer's cluster and a public RPC. */
  const SOLANA_NETWORKS = {
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { label: "Solana devnet", cluster: "?cluster=devnet", rpc: "https://api.devnet.solana.com", feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5" },
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { label: "Solana", cluster: "", rpc: "https://api.mainnet-beta.solana.com" },
  };
  /** An approved Solana payment waits this long for the agent to collect it. */
  const CLEARED_MAX_AGE_MS = 3_600_000;

  /** Changes that wait, in plain words, by their `kind`. */
  const CHANGES = {
    raise_limits: "raise the limits",
    add_payee: "add a payee",
    set_agent: "set a new agent key",
    set_guardian: "change the guardian",
    set_delays: "change the waiting times",
    set_checker: "change the check program",
    set_buying: "change the buying rules",
    set_terms: "change a service's terms",
    set_solana: "change paying on Solana",
    withdraw_solana: "send funds out on Solana",
    set_passkey: "add a fingerprint",
    unfreeze: "unfreeze the vault",
    withdraw: "send funds to another account",
    withdraw_token: "send a bought token to another account",
    recover: "hand the vault to a new owner",
  };

  const state = { run: 0, vault: "", net: NETWORKS.testnet, token: null, status: null, genuine: null, held: [], cleared: [], pending: [], txs: new Map(), timer: 0, solanaBalance: null, device: null, knownPayees: new Set() };
  /** The owner's or guardian's wallet, once connected; nothing about it is loaded before that. */
  const wallet = { connector: null, account: "", busy: false, message: "", messagePlace: "wallet", confirmFreeze: false, confirmRevoke: false, forms: {}, open: new Set() };
  const WALLET_FLAG = "svalin-guard-wallet-connected";
  const $ = (id) => document.getElementById(id);

  /* --------------------------------- reading --------------------------------- */

  async function postJson(url, body, timeoutMs = 15_000) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
    return response.json();
  }

  async function rpc(method, params, timeoutMs) {
    const body = await postJson(state.net.rpc, { jsonrpc: "2.0", id: "svalin-dashboard", method, params }, timeoutMs);
    if (body.error) throw new Error(body.error.cause?.name ?? body.error.message ?? "NEAR RPC error");
    return body.result;
  }

  async function view(account, method, args = {}) {
    const result = await rpc("query", {
      request_type: "call_function",
      finality: "final",
      account_id: account,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    });
    if (result.error) throw new Error(result.error);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
  }

  async function accessKeys(account) {
    const result = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: account });
    return result.keys ?? [];
  }

  /** Whether `account` runs a trusted Svalin Guard build and no key could replace that code. */
  async function isGenuine(account) {
    const [info, list] = await Promise.all([rpc("query", { request_type: "view_account", finality: "final", account_id: account }), accessKeys(account)]);
    return RELEASES.has(info.code_hash) && !list.some((key) => key.access_key?.permission === "FullAccess");
  }

  /** The vault's USDC on Solana, summed over its token accounts for the mint; null if unreadable. */
  async function solanaBalance(status) {
    const network = SOLANA_NETWORKS[status.solana?.network];
    if (!network || !status.solana_address) return null;
    const body = await postJson(network.rpc, {
      jsonrpc: "2.0",
      id: "svalin-dashboard",
      method: "getTokenAccountsByOwner",
      params: [status.solana_address, { mint: status.solana.mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
    });
    if (body.error || !Array.isArray(body.result?.value)) return null;
    return body.result.value.reduce((sum, item) => sum + big(item.account?.data?.parsed?.info?.tokenAmount?.amount), 0n);
  }

  async function tokenInfo(token) {
    const metadata = await view(token, "ft_metadata").catch(() => null);
    const symbol = typeof metadata?.symbol === "string" ? metadata.symbol.slice(0, 12) : "";
    const decimals = Number.isInteger(metadata?.decimals) && metadata.decimals >= 0 && metadata.decimals <= 30 ? metadata.decimals : 0;
    return { id: token, symbol, decimals };
  }

  /** New transactions of the vault, newest first from FastNEAR, each with the vault's own events. */
  async function readHistory(vault, token) {
    const fresh = new Map();
    let resume;
    for (let page = 0; page < PAGES; page += 1) {
      const result = await postJson(`${state.net.history}/v0/account`, {
        account_id: vault,
        limit: PAGE,
        ...(resume ? { resume_token: resume } : {}),
      });
      const entries = result.account_txs ?? [];
      let reachedKnown = false;
      for (const entry of entries) {
        const hash = entry.transaction_hash;
        if (typeof hash !== "string" || !TX_HASH.test(hash)) continue;
        const known = state.txs.get(hash);
        // A recent transaction is read again: its TEE check or transfer may still have been running.
        if (known && Date.now() - known.at > SETTLE_MS) reachedKnown = true;
        else fresh.set(hash, Math.floor(Number(entry.tx_block_timestamp) / 1e6));
      }
      resume = result.resume_token;
      if (reachedKnown || !resume || entries.length < PAGE) break;
    }
    const hashes = [...fresh.keys()];
    for (let start = 0; start < hashes.length; start += BATCH) {
      const { transactions = [] } = await postJson(`${state.net.history}/v0/transactions`, { tx_hashes: hashes.slice(start, start + BATCH) });
      for (const record of transactions) {
        const tx = readTransaction(record, vault, token);
        // A transaction the API lists but cannot return yet is asked for again on the next read.
        if (tx && fresh.has(tx.hash)) state.txs.set(tx.hash, { ...tx, at: fresh.get(tx.hash) });
      }
    }
  }

  function succeeded(outcome) {
    const status = outcome?.outcome?.status;
    return typeof status === "object" && status !== null && ("SuccessValue" in status || "SuccessReceiptId" in status);
  }

  function readTransaction(record, vault, token) {
    const tx = record?.transaction ?? {};
    const hash = tx.hash ?? record?.execution_outcome?.id;
    if (typeof hash !== "string" || !TX_HASH.test(hash)) return null;
    const action = tx.actions?.[0];
    const method = action?.FunctionCall?.method_name ?? (typeof action === "string" ? action : Object.keys(action ?? {})[0] ?? "");
    // The memo the agent sent with a payment, e.g. which model decided it.
    let memo = "";
    if (method === "request_payment" && typeof action.FunctionCall.args === "string") {
      try {
        const args = JSON.parse(atob(action.FunctionCall.args));
        if (typeof args.memo === "string") memo = args.memo.slice(0, 200);
      } catch {
        memo = "";
      }
    }
    const events = [];
    const received = [];
    for (const { receipt, execution_outcome: outcome } of record.receipts ?? []) {
      if (!succeeded(outcome)) continue;
      const logs = outcome.outcome.logs ?? [];
      for (const log of logs) {
        if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
        let parsed;
        try {
          parsed = JSON.parse(log.slice("EVENT_JSON:".length));
        } catch {
          continue;
        }
        const data = Array.isArray(parsed?.data) ? parsed.data : [];
        // Only the vault's own receipts speak for the vault; anyone can log a look-alike event.
        if (receipt?.receiver_id === vault && parsed?.standard === "svalin-guard" && typeof parsed.event === "string") {
          events.push({ event: parsed.event, data: data[0] ?? {} });
        }
        // Money that came in, from the token's own transfer events.
        if (receipt?.receiver_id === token && parsed?.standard === "nep141" && parsed.event === "ft_transfer") {
          for (const transfer of data) {
            if (transfer?.new_owner_id === vault && transfer.old_owner_id !== vault) received.push({ from: transfer.old_owner_id, amount: transfer.amount });
          }
        }
      }
    }
    return { hash, signer: typeof tx.signer_id === "string" ? tx.signer_id : "", method, memo, events, received };
  }

  /* ------------------------------- formatting ------------------------------- */

  function big(value) {
    try {
      return BigInt(value ?? 0);
    } catch {
      return 0n;
    }
  }

  function money(atomic, token = state.token) {
    let value = big(atomic);
    const decimals = token?.decimals ?? 0;
    const sign = value < 0n ? "-" : "";
    if (value < 0n) value = -value;
    const base = 10n ** BigInt(decimals);
    let fraction = decimals ? (value % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
    if (decimals >= 2 && fraction.length < 2) fraction = fraction.padEnd(2, "0");
    const whole = (value / base).toLocaleString("en-US");
    return `${sign}${whole}${fraction ? `.${fraction}` : ""}${token?.symbol ? ` ${token.symbol}` : ""}`;
  }

  function near(yocto) {
    const value = big(yocto);
    const hundredths = value / 10n ** 22n;
    return `${(hundredths / 100n).toString()}.${(hundredths % 100n).toString().padStart(2, "0")} NEAR`;
  }

  const pad = (number) => String(number).padStart(2, "0");

  function when(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const date = new Date(ms);
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  }

  function clock(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
  }

  function duration(ms) {
    const minutes = Math.round(Number(ms) / 60_000);
    if (!Number.isFinite(minutes)) return "";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${Math.round(hours / 24)} days`;
  }

  /**
   * An account for display: a 64-character implicit account is shortened, with the full name on
   * hover. A Solana payee is shown in full: a poisoned look-alike differs only in the middle.
   */
  function account(name) {
    const text = String(name ?? "");
    if (text.startsWith(SOLANA)) return el("span", {}, mono(text.slice(SOLANA.length)), " on Solana");
    return /^[0-9a-f]{64}$/.test(text) ? el("span", { class: "mono", title: text }, `${text.slice(0, 8)}…${text.slice(-6)}`) : mono(text);
  }

  /** The vault's Solana address on Solana's explorer. */
  function solanaLink(status, text) {
    const network = SOLANA_NETWORKS[status?.solana?.network];
    if (!network || !status.solana_address) return null;
    return el("a", { class: "link", href: `https://explorer.solana.com/address/${status.solana_address}${network.cluster}`, target: "_blank", rel: "noreferrer" }, text);
  }

  function reason(code, imitates) {
    const words = REASONS[code] ?? String(code).toLowerCase().replaceAll("_", " ");
    return imitates && /IMITATES|RESEMBLES/.test(code) ? `${words} (${imitates})` : words;
  }

  function changeName(change) {
    const kind = typeof change === "string" ? change : change?.kind;
    return CHANGES[kind] ?? String(kind ?? "a change");
  }

  /** Builds an element; strings become text nodes, never HTML. */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const mono = (text) => el("span", { class: "mono" }, text);
  const sub = (...children) => el("span", { class: "sub" }, ...children);
  /** Where an agent's key comes from: the public half goes here, the private half stays with the agent. */
  const agentKeyHint = () => [
    "The public key only. The private key stays with the agent. ",
    el("a", { class: "link", href: "https://svalin.noobshole.workers.dev/docs/guard#agent-key", target: "_blank", rel: "noreferrer" }, "How to make one"),
  ];
  /** A long key as its start and end, e.g. ed25519:49tb…xk2V; the whole key is one click away. */
  const shortKey = (key) => (key.length > 24 ? `${key.slice(0, 12)}…${key.slice(-4)}` : key);
  function keyWithCopy(key) {
    const button = el("button", { class: "copy", type: "button", title: "Copy the whole key" }, "Copy");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(key);
        button.textContent = "Copied";
      } catch {
        button.textContent = key;
      }
    });
    return el("span", { class: "key" }, el("span", { class: "mono", title: key }, shortKey(key)), " ", button);
  }
  const txLink = (hash) => el("a", { class: "mono", href: `${state.net.explorer}${hash}`, target: "_blank", rel: "noreferrer" }, `${hash.slice(0, 8)}…`);

  /** The calls the agent's key can make; anything else the vault's own account signs is its setup. */
  const AGENT_CALLS = new Set(["request_payment", "request_buy", "request_solana_payment", "collect_solana_withdrawal"]);

  function who(signer, method) {
    const status = state.status;
    if (signer === state.vault) return AGENT_CALLS.has(method) ? "Agent" : "The vault";
    if (status && signer === status.owner) return "Owner";
    if (status && signer && signer === status.guardian) return "Guardian";
    return signer ? account(signer) : "Someone";
  }

  /* -------------------------------- decisions -------------------------------- */

  /**
   * This vault's transactions, oldest first, from its latest deployment on: an account name that was
   * deleted and made again starts with a new vault and an empty record.
   */
  function vaultTxs() {
    const all = [...state.txs.values()].sort((a, b) => a.at - b.at);
    const born = all.filter((tx) => tx.method === "DeployContract").at(-1)?.at ?? 0;
    return all.filter((tx) => tx.at >= born);
  }

  function checkNote(check) {
    const report = check?.data?.report;
    if (!report) return "Checked in a TEE first: the check gave no answer.";
    if (!report.exists) return "Checked in a TEE first: the account does not exist.";
    const age = Number.isFinite(report.age_ms) ? `, ${duration(report.age_ms)} old` : ", age unknown";
    return `Checked in a TEE first: it exists, ${report.contract ? "is a contract" : "is not a contract"}${age}.`;
  }

  function purchaseNote(purchase) {
    if (!purchase || typeof purchase !== "object") return null;
    return sub("For ", mono(String(purchase.item ?? "")), " from ", mono(String(purchase.service ?? "")));
  }

  /** One row per decision or owner action, oldest first, and the totals behind the summary. */
  function decisions() {
    const rows = [];
    const totals = { sent: 0n, held: 0n, refused: 0n, approved: 0n, bought: 0n, buyRefused: 0n, buys: 0, refusedBuys: 0, requests: 0 };
    for (const tx of vaultTxs()) {
      const find = (name) => tx.events.find((event) => event.event === name);
      const check = find("payee_checked");
      const locked = find("terms_locked");
      const settled = find("buy_settled");
      const failed = Boolean(find("payment_failed"));
      const base = { at: tx.at, tx: tx.hash, who: who(tx.signer, tx.method) };
      const add = (row) => rows.push({ ...base, ...row });
      const final = tx.events.some((event) => ["payment_sent", "payment_held", "payment_refused"].includes(event.event));
      const bought = tx.events.some((event) => ["buy_sent", "buy_refused"].includes(event.event));
      const signed = find("solana_signed");
      const collected = find("cleared_payment_collected");

      for (const { event, data } of tx.events) {
        const what = data.payee ? [money(data.amount), " to ", account(data.payee)] : null;
        const notes = [];
        switch (event) {
          case "payment_sent": {
            const onSolana = String(data.payee ?? "").startsWith(SOLANA);
            // A Solana payment's signature comes back in the same transaction; until then it is signing.
            const signing = onSolana && !signed && !failed;
            // An approved Solana payment counts once, as approved, when the agent collects it.
            if (collected) {
              totals.approved += failed ? 0n : big(data.amount);
              notes.push(`The owner approved it as #${collected.data.id}; the agent collected it now.`);
            } else {
              totals.requests += 1;
              if (!failed) totals.sent += big(data.amount);
            }
            if (check) notes.push(checkNote(check));
            if (tx.memo) notes.push(`Memo: ${tx.memo}`);
            if (locked && data.purchase && locked.data.service === data.purchase.service) {
              notes.push(["Locked the service's terms: ", account(locked.data.terms?.payee), `, ${money(locked.data.terms?.price)} a call.`]);
            }
            if (signed) notes.push(["Signed by NEAR's signing network for the vault's Solana address; the seller's facilitator sends it. ", solanaLink(state.status, "See it on Solana")]);
            if (failed) notes.push(onSolana ? REASONS.SIGNING_FAILED[0].toUpperCase() + REASONS.SIGNING_FAILED.slice(1) + "." : "The token transfer failed, so nothing was paid.");
            add({
              what: [what, purchaseNote(data.purchase)],
              tone: failed ? "refused" : signing ? "quiet" : "paid",
              verdict: failed ? "Failed" : signing ? "Signing on NEAR" : onSolana ? "Paid on Solana" : "Paid",
              notes,
            });
            break;
          }
          case "payment_cleared":
            add({
              what: [what, sub(`Held payment #${data.id}`)],
              tone: "quiet",
              verdict: "Approved: the agent collects it within the hour",
              notes: [`A Solana payment expires a minute after it is signed, so the vault signs it when the agent asks again, until ${when(Number(data.until_ms))}.`],
            });
            break;
          case "solana_address":
            add({ what: ["The vault's Solana address: ", mono(String(data.address))], tone: "quiet", verdict: "Derived by NEAR's signing network", notes: ["Nobody holds its key; the network signs for it only when this vault asks."] });
            break;
          case "payment_held": {
            totals.requests += 1;
            totals.held += big(data.amount);
            if (check) notes.push(checkNote(check));
            if (tx.memo) notes.push(`Memo: ${tx.memo}`);
            add({
              what: [what, purchaseNote(data.purchase)],
              tone: "held",
              verdict: `Held${data.held_id !== null && data.held_id !== undefined ? ` as #${data.held_id}` : ""}`,
              reasons: (data.reasons ?? []).map((code) => [code, reason(code, data.imitates)]),
              notes,
            });
            break;
          }
          case "payment_refused": {
            totals.requests += 1;
            totals.refused += big(data.amount);
            if (check) notes.push(checkNote(check));
            if (tx.memo) notes.push(`Memo: ${tx.memo}`);
            add({
              what: [what, purchaseNote(data.purchase)],
              tone: "refused",
              verdict: "Refused",
              reasons: (data.reasons ?? []).map((code) => [code, reason(code, data.imitates)]),
              notes,
            });
            break;
          }
          case "payment_checking":
            if (!final) add({ what: [what, purchaseNote(data.purchase)], tone: "quiet", verdict: "Checking the payee in a TEE", notes });
            break;
          case "payment_approved":
            if (!failed) totals.approved += big(data.amount);
            if (locked) notes.push(`Locked the service's terms: ${locked.data.terms?.payee}, ${money(locked.data.terms?.price)} a call.`);
            add({ what: [what, sub(`Held payment #${data.id}`)], tone: failed ? "refused" : "paid", verdict: failed ? "Approved, but the transfer failed" : "Approved and paid", notes });
            break;
          case "approval_recorded":
            add({ what: [`Approved held payment #${data.id}`], tone: "quiet", verdict: `Waiting for ${data.waiting_for}`, notes });
            break;
          case "payment_rejected":
            add({ what: [`Rejected held payment #${data.id}`], tone: "quiet", verdict: data.via === "passkey" ? "Dropped, with the owner's fingerprint" : "Dropped", notes });
            break;
          case "solana_signed":
            if (data.withdrawal) add({ what: [money(data.amount), " to ", account(data.payee)], tone: "quiet", verdict: "The owner's withdrawal, signed", notes: ["It goes out when a facilitator settles it."] });
            break;
          case "solana_withdrawal_failed":
            add({ what: [money(data.amount), " to ", account(data.payee)], tone: "refused", verdict: "Withdrawal not signed", notes: ["Nothing went out; it can be collected again."] });
            break;
          case "passkey_topped_up":
            add({ what: ["Top up the fingerprint's gas"], tone: "quiet", verdict: "Done at once", notes });
            break;
          case "solana_address_failed":
          case "solana_address_mismatch":
            add({ what: ["Ask NEAR's signing network for the vault's Solana address"], tone: "refused", verdict: "No usable answer, so the vault cannot pay on Solana yet", notes: ["Anyone can ask again."] });
            break;
          case "passkey_removed":
            add({ what: ["Remove the owner's fingerprint"], tone: "quiet", verdict: "Done at once", notes });
            break;
          case "buy_sent":
          case "buy_refused": {
            const refused = event === "buy_refused";
            const amount = big(data.amount);
            if (refused) {
              totals.buyRefused += amount;
              totals.refusedBuys += 1;
            } else {
              totals.bought += amount - big(settled?.data.returned);
              totals.buys += 1;
            }
            const claim = sub(`Grade ${data.grade} from the ${data.day} edition, $${Number(data.backing_usd ?? 0).toLocaleString("en-US")} of held backing`);
            if (!refused && settled) notes.push(`The market used ${money(settled.data.used)}; Svalin's fee was ${money(settled.data.fee)}.`);
            add({
              what: [`Buy `, mono(String(data.token)), ` with ${money(data.amount)}`, claim],
              tone: refused ? "refused" : "paid",
              verdict: refused ? "Refused" : "Bought, the registry confirmed the grade",
              reasons: refused ? (data.reasons ?? []).map((code) => [code, reason(code)]) : [],
              notes,
            });
            break;
          }
          case "buy_checking":
            if (!bought) add({ what: [`Buy `, mono(String(data.token)), ` with ${money(data.amount)}`], tone: "quiet", verdict: "Checking the grade", notes });
            break;
          case "auto_frozen":
            add({ what: [`${data.strikes} look-alikes or forged grades within ${duration(data.within_ms)}`], tone: "refused", verdict: "Froze itself", notes });
            break;
          case "frozen":
            add({ what: [`Freeze`], tone: "refused", verdict: data.via === "passkey" ? "Frozen, with the owner's fingerprint" : "Frozen", notes });
            break;
          case "change_proposed":
            add({ what: [`Proposed: ${changeSummary(data.change)}`, sub(`Change #${data.id}`)], tone: "quiet", verdict: `Waits until ${when(data.ready_at_ms)}`, notes });
            break;
          case "change_executed":
            // A withdrawal's transfer can still fail, for instance to an account the token does not know.
            add({
              what: [`Change #${data.id}: ${changeSummary(data.change)}`],
              tone: failed ? "refused" : "quiet",
              verdict: failed ? "The wait was over, but the transfer failed. Nothing left the vault" : "Done, after the wait",
              notes,
            });
            break;
          case "change_cancelled":
            add({ what: [`Cancel change #${data.id}`], tone: "quiet", verdict: "Cancelled", notes });
            break;
          case "agent_revoked":
            add({ what: ["Revoke the agent's key"], tone: "quiet", verdict: "Done at once", notes });
            break;
          case "agent_topped_up":
            add({ what: [`Top up the agent's gas to ${near(data.allowance)}`], tone: "quiet", verdict: "Done at once", notes });
            break;
          case "limits_lowered":
            add({ what: ["Lower the limits"], tone: "quiet", verdict: "Done at once", notes });
            break;
          case "payee_forgotten":
            add({ what: ["Forget ", mono(String(data.payee))], tone: "quiet", verdict: "Done at once", notes });
            break;
          case "withdrawal":
            add({ what: [`Send ${money(data.amount)} home to `, mono(String(data.to))], tone: "quiet", verdict: "Sent", notes });
            break;
          case "terms_locked":
            if (!final && !find("payment_approved")) {
              add({
                what: ["Lock the terms of ", mono(String(data.service)), sub(`${data.terms?.payee}, ${money(data.terms?.price)} a call`)],
                tone: "quiet",
                verdict: "Locked at once",
                notes,
              });
            }
            break;
          default:
            break;
        }
      }
      if (tx.events.length === 0) {
        for (const transfer of tx.received) add({ what: [`${money(transfer.amount)} from `, account(transfer.from)], who: who(tx.signer, tx.method), tone: "quiet", verdict: "Received", notes: [] });
      }
    }
    return { rows, totals };
  }

  /* -------------------------------- rendering -------------------------------- */

  function renderSummary(totals, held) {
    const asked = totals.sent + totals.held + totals.refused;
    const stopped = totals.held + totals.refused - totals.approved;
    const summary = $("summary");
    summary.replaceChildren();
    const fund = $("fund");
    fund.hidden = true;
    // A contract that is not a trusted vault says so before anything else, and asks for no money.
    if (state.genuine === false) {
      summary.append(
        el("strong", { class: "tone-refused" }, "This is not a Svalin Guard vault this page can vouch for."),
        " Its code is not a released build, or a key can still replace it. Do not send it money. ",
      );
    }
    // A frozen vault says so before anything else.
    if (state.status?.frozen) summary.append(el("strong", { class: "tone-refused" }, "This vault is frozen."), " It pays nothing until the owner unfreezes it. ");
    if (totals.requests === 0 && totals.buys + totals.refusedBuys === 0) {
      summary.append("No payments yet. Every request the agent makes will show up here, with what the vault did and why.");
      // A new vault's first need: money to guard.
      const address = state.status?.solana_address;
      const noneOnNear = state.balance !== null && big(state.balance) === 0n;
      // A balance that could not be read is not an empty one.
      const noneOnSolana = !state.status?.solana || (state.solanaBalance !== null && big(state.solanaBalance) === 0n);
      if (noneOnNear && noneOnSolana && state.genuine) {
        fund.replaceChildren(
          el("p", { class: "fund__lead" }, "It holds no USDC yet. To use it, send USDC to the vault:"),
          el("dl", { class: "fund__list" }, el("dt", {}, "On NEAR"), el("dd", {}, mono(state.vault)), ...(address ? [el("dt", {}, "On Solana"), el("dd", {}, mono(address))] : [])),
        );
        fund.hidden = false;
      }
    } else {
      if (totals.requests > 0) {
        summary.append(
          "The agent asked this vault to pay ",
          el("strong", {}, money(asked)),
          ". It paid ",
          el("strong", {}, money(totals.sent)),
          ...(totals.approved > 0 ? [" and the owner approved ", el("strong", {}, money(totals.approved)), " more"] : []),
          ", and stopped ",
          el("strong", {}, money(stopped)),
          ". ",
        );
      }
      if (totals.buys + totals.refusedBuys > 0) {
        summary.append(
          `It bought ${totals.buys} token${totals.buys === 1 ? "" : "s"} for `,
          el("strong", {}, money(totals.bought)),
          ` and refused ${totals.refusedBuys} buy${totals.refusedBuys === 1 ? "" : "s"} worth `,
          el("strong", {}, money(totals.buyRefused)),
          ".",
        );
      }
    }

    const waiting = held.reduce((sum, [, payment]) => sum + big(payment.amount), 0n);
    const number = (value, label, tone) => el("div", { class: "number" }, el("span", { class: `value${tone ? ` tone-${tone}` : ""}` }, value), el("span", { class: "label" }, label));
    const onSolana = Boolean(state.status?.solana);
    const numbers = [
      number(money(totals.sent + totals.approved + totals.bought), totals.buys > 0 ? "Paid, token buys included" : "Paid", "paid"),
      number(money(stopped + totals.buyRefused), "Stopped", stopped + totals.buyRefused > 0n ? "held" : ""),
      number(money(waiting), `Waiting for the owner, ${held.length} payment${held.length === 1 ? "" : "s"}`, ""),
      number(state.balance === null ? "?" : money(state.balance), onSolana ? "In the vault on NEAR" : "In the vault now", ""),
    ];
    if (onSolana) numbers.push(number(state.solanaBalance === null ? "?" : money(state.solanaBalance), "In the vault on Solana", ""));
    $("numbers").replaceChildren(...numbers);
    $("numbers").hidden = false;
  }

  function renderDecisions(rows) {
    const body = $("decisions");
    body.replaceChildren(
      ...rows
        .slice()
        .reverse()
        .map((row) =>
          el(
            "tr",
            {},
            el("td", { class: "when" }, when(row.at)),
            el("td", {}, row.who instanceof Node ? row.who.cloneNode(true) : row.who),
            el("td", { class: "what" }, row.what),
            el(
              "td",
              { class: "verdict" },
              el("span", { class: `outcome tone-${row.tone}` }, row.verdict),
              (row.reasons ?? []).map(([code, words]) => sub(words, " ", el("span", { class: "code" }, code))),
              row.notes.map((note) => sub(note)),
            ),
            el("td", { class: "tx" }, txLink(row.tx)),
          ),
        ),
    );
    $("decisions-note").textContent = rows.length
      ? `${rows.length} decision${rows.length === 1 ? "" : "s"} and actions, newest first. Each row links to its transaction.`
      : "Nothing yet.";
    $("decisions-block").hidden = false;
  }

  function command(label, text) {
    const button = el("button", { type: "button" }, "Copy");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select it";
      }
      setTimeout(() => (button.textContent = "Copy"), 2000);
    });
    return el("div", { class: "command" }, el("div", { class: "row" }, el("span", {}, label), button), el("pre", {}, text));
  }

  function renderHeld(held, status) {
    const list = $("held");
    const now = Date.now();
    // Keep open what the owner opened, across the reads every 20 seconds.
    const open = new Set([...list.querySelectorAll("details[open]")].map((details) => details.dataset.id));
    const cli = (method, id, signer) =>
      `near contract call-function as-transaction ${state.vault} ${method} json-args '{"id":${id}}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as ${signer} network-config ${state.net.name}`;
    list.replaceChildren(
      ...held
        .slice()
        .sort(([a], [b]) => b - a)
        .map(([id, payment]) => {
          const expires = Number(payment.at_ms) + HELD_MAX_AGE_MS;
          const both = status.guardian && big(payment.amount) > big(status.limits?.per_payment);
          const approvedBy = payment.approved_by ?? [];
          return el(
            "article",
            { class: "held" },
            el("div", { class: "head" }, el("span", {}, `#${id}`), el("span", {}, money(payment.amount), " to ", account(payment.payee))),
            (payment.reasons ?? []).map((code) => el("p", { class: "tone-held" }, reason(code), " ", el("span", { class: "code" }, code))),
            payment.purchase ? el("p", {}, "For ", mono(String(payment.purchase.item ?? "")), " from ", mono(String(payment.purchase.service ?? ""))) : null,
            payment.memo ? el("p", { class: "tone-quiet" }, "Memo: ", String(payment.memo)) : null,
            el(
              "p",
              { class: "tone-quiet" },
              `Held ${when(Number(payment.at_ms))}. `,
              now < expires ? `It can be approved until ${when(expires)}.` : "It was held more than 7 days ago, so it can only be rejected.",
            ),
            both
              ? el(
                  "p",
                  { class: "tone-quiet" },
                  approvedBy.length ? `Approved so far by ${approvedBy.join(" and ")}. ` : "",
                  "Above the per-payment limit, so the owner and the guardian both approve it.",
                )
              : null,
            String(payment.payee).startsWith(SOLANA)
              ? el("p", { class: "tone-quiet" }, "On Solana: approving it lets the agent collect it once, within the hour after.")
              : null,
            walletActions(id, payment, status, now < expires),
            fingerprintActions(id, payment, status, now < expires),
            el(
              "details",
              { "data-id": id, open: open.has(String(id)) },
              el("summary", {}, "Approve or reject it with near-cli"),
              now < expires ? command("Approve, from the owner's device", cli("approve", id, status.owner)) : null,
              command("Reject", cli("reject", id, status.owner)),
            ),
          );
        }),
      ...state.cleared
        .slice()
        .sort(([a], [b]) => b - a)
        .map(([id, payment]) => {
          const until = Number(payment.at_ms) + CLEARED_MAX_AGE_MS;
          return el(
            "article",
            { class: "held" },
            el("div", { class: "head" }, el("span", {}, `#${id}`), el("span", {}, money(payment.amount), " to ", account(payment.payee))),
            payment.purchase ? el("p", {}, "For ", mono(String(payment.purchase.item ?? "")), " from ", mono(String(payment.purchase.service ?? ""))) : null,
            el(
              "p",
              { class: now < until ? "tone-paid" : "tone-quiet" },
              now < until
                ? `Approved ${when(Number(payment.at_ms))}. The agent can collect it until ${when(until)}.`
                : `Approved ${when(Number(payment.at_ms))}, but the agent did not collect it within the hour, so it lapsed.`,
            ),
            walletActions(id, payment, status, false),
            fingerprintActions(id, payment, status, false),
          );
        }),
    );
    $("held-block").hidden = held.length + state.cleared.length === 0;
  }

  /* --------------------------------- wallet --------------------------------- */

  // Approving from the owner's own wallet, through NEAR Connect (a pinned copy in vendor/). Each
  // wallet's code runs in a sandboxed frame. The page only asks the wallet to sign one call, approve
  // or reject, with the 1 yoctoNEAR the vault requires; the vault itself checks who signed it.

  async function walletConnector() {
    if (!wallet.connector) {
      const { NearConnector } = await import("./vendor/near-connect-0.11.4.mjs");
      wallet.connector = new NearConnector({ network: state.net.name, features: { signAndSendTransaction: true } });
      wallet.connector.on("wallet:signOut", () => {
        wallet.account = "";
        renderWallet();
        renderHeld(state.held, state.status);
      });
    }
    return wallet.connector;
  }

  function remember(on) {
    try {
      if (on) localStorage.setItem(WALLET_FLAG, "1");
      else localStorage.removeItem(WALLET_FLAG);
    } catch {
      // A browser without storage connects again next time.
    }
  }

  async function connectWallet({ quiet = false } = {}) {
    try {
      const connector = await walletConnector();
      const connected = quiet ? await connector.wallet() : await connector.connect();
      const accounts = await connected.getAccounts();
      wallet.account = String(accounts[0]?.accountId ?? "");
      wallet.message = "";
      remember(Boolean(wallet.account));
    } catch (error) {
      if (!quiet) wallet.message = `The wallet did not connect: ${error?.message ?? error}`;
    }
    renderWallet();
    if (state.status) renderHeld(state.held, state.status);
  }

  async function disconnectWallet() {
    try {
      const connector = await walletConnector();
      await connector.disconnect();
    } catch {
      // Already disconnected.
    }
    wallet.account = "";
    remember(false);
    renderWallet();
    if (state.status) renderHeld(state.held, state.status);
  }

  /** The connected account's role in this vault. */
  function role() {
    const status = state.status;
    // No owner's controls on a contract that is not a trusted vault.
    if (!wallet.account || !status || state.genuine === false) return "";
    if (wallet.account === status.owner) return "owner";
    if (status.guardian && wallet.account === status.guardian) return "guardian";
    return "";
  }

  /**
   * Asks the connected wallet to sign one call to the vault. The owner's and guardian's calls carry
   * the 1 yoctoNEAR the vault requires, which only a full-access key can attach; `execute` is open
   * to anyone and takes none.
   */
  async function sign(method, args, what, { deposit = "1", done, place = "wallet", clear = [] } = {}) {
    if (wallet.busy) return;
    wallet.busy = true;
    wallet.confirmFreeze = false;
    wallet.confirmRevoke = false;
    wallet.messagePlace = place;
    wallet.message = `Asking your wallet to ${what}…`;
    renderWallet();
    try {
      const connector = await walletConnector();
      const connected = await connector.wallet();
      const result = await connected.signAndSendTransaction({
        receiverId: state.vault,
        actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: "150000000000000", deposit } }],
      });
      const hash = result?.transaction?.hash ?? result?.transaction_outcome?.id;
      const failure = result?.status?.Failure;
      wallet.message = failure
        ? `The vault refused it: ${JSON.stringify(failure).slice(0, 200)}`
        : `Sent${typeof hash === "string" && TX_HASH.test(hash) ? ` (${hash.slice(0, 8)}…)` : ""}. The page shows it within 20 seconds.`;
      if (!failure && done) wallet.message = done(hash);
      if (!failure) for (const key of clear) delete wallet.forms[key];
      refresh(state.run);
    } catch (error) {
      wallet.message = `Not sent: ${error?.message ?? error}`;
    } finally {
      wallet.busy = false;
      renderWallet();
    }
  }

  /** Approve and reject buttons on a held payment, for the owner or guardian whose wallet is connected. */
  function walletActions(id, payment, status, approvable) {
    const who = role();
    if (!who) return null;
    const large = status.guardian && big(payment.amount) > big(status.limits?.per_payment);
    const approvedBy = payment.approved_by ?? [];
    const canApprove = approvable && !approvedBy.includes(wallet.account) && (who === "owner" || (who === "guardian" && large));
    const button = (label, method) => {
      const node = el("button", { type: "button", class: method === "approve" ? "primary" : "" }, label);
      node.disabled = wallet.busy;
      node.addEventListener("click", () => sign(method, { id }, `${method} held payment #${id}`));
      return node;
    };
    return el("div", { class: "actions" }, canApprove ? button("Approve", "approve") : null, button("Reject", "reject"));
  }

  function walletButton(label, onClick, kind = "") {
    const node = el("button", { type: "button", class: kind }, label);
    node.disabled = wallet.busy;
    node.addEventListener("click", onClick);
    return node;
  }

  /**
   * Freezing is one tap and a confirmation, for the owner or the guardian: it stops every payment
   * at once. Unfreezing is a change that waits, so a thief with the owner's key cannot undo it.
   */
  function freezeControls(who) {
    const status = state.status;
    if (!status || !who) return [];
    const wait = duration(status.delays?.loosen_ms);
    if (!status.frozen) {
      if (!wallet.confirmFreeze) {
        return [
          el("div", { class: "actions" }, walletButton("Freeze the vault", () => ((wallet.confirmFreeze = true), renderWallet()), "danger")),
          sub("If something looks wrong: it stops every payment at once, on NEAR and on Solana."),
        ];
      }
      return [
        sub(`Freeze now? Every payment stops and the changes waiting are cancelled, except a recovery. Unfreezing waits ${wait}.`),
        el(
          "div",
          { class: "actions" },
          walletButton("Yes, freeze it", () => sign("freeze", {}, "freeze the vault"), "danger"),
          walletButton("Cancel", () => ((wallet.confirmFreeze = false), renderWallet())),
        ),
      ];
    }
    const unfreeze = state.pending.find(([, pending]) => pending.change?.kind === "unfreeze");
    if (unfreeze && Date.now() >= Number(unfreeze[1].ready_at_ms)) {
      return [
        sub("The vault is frozen, and its unfreezing has waited long enough."),
        el("div", { class: "actions" }, walletButton("Unfreeze now", () => sign("execute", { id: unfreeze[0] }, `unfreeze the vault (change #${unfreeze[0]})`, { deposit: "0" }), "primary")),
      ];
    }
    if (unfreeze) return [sub(`The vault is frozen. Unfreezing (change #${unfreeze[0]}) can run from ${when(Number(unfreeze[1].ready_at_ms))}; the owner or the guardian can still cancel it.`)];
    if (who !== "owner") return [sub("The vault is frozen. Only the owner can propose unfreezing it.")];
    return [
      sub(`The vault is frozen. Unfreezing is a change that waits ${wait}.`),
      el("div", { class: "actions" }, walletButton("Propose unfreezing", () => sign("propose", { change: { kind: "unfreeze" } }, "propose unfreezing the vault"))),
    ];
  }

  /* ----------------------------- changing the rules ----------------------------- */

  // Everything here is one call the owner's wallet signs. The vault decides what happens at once and
  // what waits; this page only offers the call and says which it will be.

  /** An amount typed by a person, in the token's smallest units; null if it is not one. */
  function atomic(text, decimals) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(text ?? "").trim());
    if (!match || (match[2]?.length ?? 0) > decimals) return null;
    return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
  }

  /** Smallest units as a number a person would type: 250000 at 6 decimals is 0.25. */
  function typed(value, decimals) {
    const text = big(value).toString().padStart(decimals + 1, "0");
    const fraction = text.slice(text.length - decimals).replace(/0+$/, "");
    return `${text.slice(0, text.length - decimals)}${fraction ? `.${fraction}` : ""}`;
  }

  const formValue = (key, start = "") => wallet.forms[key] ?? start;

  /** A labelled input whose value survives the page's refresh every 20 seconds. */
  function formField(key, label, { start = "", mode, placeholder, help } = {}) {
    const node = el("input", { autocomplete: "off", autocapitalize: "off", spellcheck: "false", inputmode: mode, placeholder });
    node.value = formValue(key, start);
    node.addEventListener("input", () => (wallet.forms[key] = node.value.trim()));
    const field = el("label", { class: "form-field" }, el("span", {}, label), node);
    // The help sits outside the label, so its link does not move the focus into the input.
    return help ? el("div", { class: "form-field-wrap" }, field, el("small", { class: "field-help" }, ...help)) : field;
  }

  function changeSection(id, title, ...body) {
    const node = el("details", { class: "change", open: wallet.open.has(id) }, el("summary", {}, title), el("div", { class: "change__body" }, ...body));
    node.addEventListener("toggle", () => (node.open ? wallet.open.add(id) : wallet.open.delete(id)));
    return node;
  }

  function sayInChanges(message) {
    wallet.messagePlace = "changes";
    wallet.message = message;
    renderWallet();
  }

  const proposeChange = (change, what, clear) => sign("propose", { change }, what, { place: "changes", clear });
  const isAccount = (text) => ACCOUNT.test(text);
  const vaultDecimals = () => state.token?.decimals ?? 6;

  /** The decimals of a token; on the test network a mainnet name cannot be read, and the stand-in market ignores the price. */
  async function tokenDecimals(token) {
    const metadata = await view(token, "ft_metadata").catch(() => null);
    if (Number.isInteger(metadata?.decimals)) return metadata.decimals;
    return state.net === NETWORKS.testnet ? 18 : null;
  }

  function limitsSection(status, wait) {
    const decimals = vaultDecimals();
    const fields = [
      ["limitPayment", "per_payment", "Most for one payment, in USDC"],
      ["limitDaily", "daily", "Most in one day, in USDC"],
      ["limitNew", "new_payee", "Most for someone new, in USDC"],
    ];
    const save = () => {
      const limits = {};
      for (const [key, name] of fields) limits[name] = atomic(formValue(key, typed(status.limits[name], decimals)), decimals);
      if (Object.values(limits).some((value) => value === null)) return sayInChanges("Each limit must be an amount in USDC.");
      if (limits.new_payee > limits.per_payment || limits.per_payment > limits.daily) return sayInChanges("Someone new cannot get more than one payment, and one payment cannot be more than a day's limit.");
      const raised = fields.some(([, name]) => limits[name] > big(status.limits[name]));
      const unchanged = fields.every(([, name]) => limits[name] === big(status.limits[name]));
      if (unchanged) return sayInChanges("Those are the limits already.");
      const sent = Object.fromEntries(fields.map(([, name]) => [name, limits[name].toString()]));
      const clear = fields.map(([key]) => key);
      if (raised) return proposeChange({ kind: "raise_limits", limits: sent }, "raise the limits", clear);
      return sign("lower_limits", { limits: sent }, "lower the limits", { place: "changes", clear });
    };
    return changeSection(
      "limits",
      "Limits",
      sub(`Lowering a limit happens at once. Raising one waits ${wait}.`),
      el("div", { class: "form-row" }, fields.map(([key, name, label]) => formField(key, label, { start: typed(status.limits[name], decimals), mode: "decimal" }))),
      el("div", { class: "actions" }, walletButton("Save the limits", save, "primary")),
    );
  }

  function payeeSection(wait) {
    const add = () => {
      const payee = formValue("payee");
      if (!isAccount(payee) && !/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payee)) return sayInChanges("Give a NEAR account, or solana: and a Solana address.");
      return proposeChange({ kind: "add_payee", payee }, `trust ${payee}`, ["payee"]);
    };
    return changeSection(
      "payee",
      "Trusted payees",
      sub(`A trusted payee gets the full limit from its first payment. Adding one waits ${wait}.`),
      el("div", { class: "form-row" }, formField("payee", "NEAR account, or solana: and an address")),
      el("div", { class: "actions" }, walletButton("Add the payee", add, "primary")),
    );
  }

  function agentSection(status, wait) {
    const replace = () => {
      const key = formValue("agentKey");
      if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(key)) return sayInChanges("Give the agent's public key: ed25519: and its letters and numbers.");
      return proposeChange({ kind: "set_agent", key }, "set a new agent key", ["agentKey"]);
    };
    const remove = status.agent
      ? wallet.confirmRevoke
        ? [
            sub("Remove the agent now? It can ask for nothing until you add a key again, and adding one waits."),
            el(
              "div",
              { class: "actions" },
              walletButton("Yes, remove it", () => sign("revoke_agent", {}, "remove the agent", { place: "changes" }), "danger"),
              walletButton("Keep it", () => ((wallet.confirmRevoke = false), renderWallet())),
            ),
          ]
        : [el("div", { class: "actions" }, walletButton("Remove the agent now", () => ((wallet.confirmRevoke = true), renderWallet()), "danger"))]
      : [sub("This vault has no agent.")];
    return changeSection(
      "agent",
      "The agent",
      ...remove,
      sub(`Removing the agent happens at once. A new key waits ${wait}.`),
      el("div", { class: "form-row" }, formField("agentKey", "New agent public key", { placeholder: "ed25519:…", help: agentKeyHint() })),
      el("div", { class: "actions" }, walletButton("Set the new key", replace)),
    );
  }

  function guardianSection(status, wait) {
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    const startHours = String(Number(status.delays.loosen_ms) / HOUR);
    const startDays = String(Number(status.delays.recovery_ms) / DAY);
    const saveGuardian = () => {
      const guardian = formValue("guardian", status.guardian ?? "");
      if (guardian && !isAccount(guardian)) return sayInChanges("Give a NEAR account, or leave it empty for no guardian.");
      if (guardian === status.owner) return sayInChanges("The guardian must be someone other than the owner.");
      if (guardian === (status.guardian ?? "")) return sayInChanges("That is the guardian already.");
      return proposeChange({ kind: "set_guardian", guardian: guardian || null }, "change the guardian", ["guardian"]);
    };
    const saveDelays = () => {
      const hours = Number(formValue("delayHours", startHours));
      const days = Number(formValue("delayDays", startDays));
      if (!(hours >= 1) || !(days * 24 >= hours)) return sayInChanges("Riskier changes must wait at least 1 hour, and a recovery at least as long.");
      return proposeChange({ kind: "set_delays", delays: { loosen_ms: Math.round(hours * HOUR), recovery_ms: Math.round(days * DAY) } }, "change the waiting times", ["delayHours", "delayDays"]);
    };
    return changeSection(
      "guardian",
      "Guardian and waiting times",
      sub(`The guardian can freeze the vault and cancel a change, and never take money. Changing either of these waits ${wait}.`),
      el("div", { class: "form-row" }, formField("guardian", "Guardian account, or empty for none", { start: status.guardian ?? "" })),
      el("div", { class: "actions" }, walletButton("Change the guardian", saveGuardian)),
      el(
        "div",
        { class: "form-row" },
        formField("delayHours", "Riskier changes wait, in hours", { start: startHours, mode: "decimal" }),
        formField("delayDays", "A recovery waits, in days", { start: startDays, mode: "decimal" }),
      ),
      el("div", { class: "actions" }, walletButton("Change the waiting times", saveDelays)),
    );
  }

  function buyingSection(status, wait) {
    const buying = status.buying;
    if (!buying) return null;
    const hasPools = Array.isArray(buying.pools);
    const saveRules = () => {
      const min_grade = formValue("minGrade", buying.min_grade).toUpperCase();
      const max_age_days = Number(formValue("maxAge", String(buying.max_age_days)));
      if (!["A", "B", "C", "D", "F"].includes(min_grade)) return sayInChanges("The lowest grade must be A, B, C, D or F.");
      if (!Number.isInteger(max_age_days) || max_age_days < 0 || max_age_days > 7) return sayInChanges("An edition can be at most 7 days old.");
      return proposeChange({ kind: "set_buying", buying: { ...buying, min_grade, max_age_days } }, "change the buying rules", ["minGrade", "maxAge"]);
    };
    const addPool = async () => {
      const token = formValue("poolToken");
      const pool_id = Number(formValue("poolId"));
      if (!isAccount(token) || !Number.isInteger(pool_id) || pool_id < 0) return sayInChanges("Give the token's account and the pool's number.");
      const decimals = await tokenDecimals(token);
      if (decimals === null) return sayInChanges(`${token} could not be read on this network.`);
      const worst = atomic(formValue("poolPrice"), decimals);
      if (worst === null || worst === 0n) return sayInChanges("Give the fewest tokens you accept for 1 USDC.");
      const min_out_per_million = (worst * 1_000_000n) / 10n ** BigInt(vaultDecimals());
      const pools = [...buying.pools.filter((pool) => pool.token !== token || pool.pool_id !== pool_id), { token, pool_id, min_out_per_million: min_out_per_million.toString() }];
      return proposeChange({ kind: "set_buying", buying: { ...buying, pools } }, `approve pool ${pool_id} for ${token}`, ["poolToken", "poolId", "poolPrice"]);
    };
    const removePool = (gone) => proposeChange({ kind: "set_buying", buying: { ...buying, pools: buying.pools.filter((pool) => pool !== gone) } }, `stop buying ${gone.token} in pool ${gone.pool_id}`);
    return changeSection(
      "buying",
      "Buying tokens",
      sub(`Every change to buying waits ${wait}.`),
      el(
        "div",
        { class: "form-row" },
        formField("minGrade", "Lowest liquidity grade it buys", { start: buying.min_grade }),
        formField("maxAge", "Oldest edition it trusts, in days", { start: String(buying.max_age_days), mode: "numeric" }),
      ),
      el(
        "div",
        { class: "actions" },
        walletButton("Change the buying rules", saveRules),
        walletButton("Turn buying off", () => proposeChange({ kind: "set_buying", buying: null }, "turn buying off"), "danger"),
      ),
      hasPools
        ? [
            ...buying.pools.map((pool) =>
              el(
                "div",
                { class: "pool" },
                el("span", {}, mono(pool.token), ` in pool ${pool.pool_id}`),
                walletButton("Stop", () => removePool(pool)),
              ),
            ),
            el(
              "div",
              { class: "form-row" },
              formField("poolToken", "Token account"),
              formField("poolId", "Pool number", { mode: "numeric" }),
              formField("poolPrice", "Fewest tokens you accept for 1 USDC", { mode: "decimal" }),
            ),
            el("div", { class: "actions" }, walletButton("Approve the pool", addPool)),
          ]
        : sub("This vault was made before approved pools, so it has no list of them."),
    );
  }

  function withdrawSection(status, wait) {
    const canSendTokens = "version" in status;
    const start = async () => {
      const to = formValue("withdrawNearTo");
      const token = canSendTokens ? formValue("withdrawToken") : "";
      if (!isAccount(to) || (token && !isAccount(token))) return sayInChanges("Give a NEAR account to send it to.");
      const decimals = token ? await tokenDecimals(token) : vaultDecimals();
      if (decimals === null) return sayInChanges(`${token} could not be read on this network.`);
      const amount = atomic(formValue("withdrawNearAmount"), decimals);
      if (amount === null || amount === 0n) return sayInChanges("Give an amount above zero.");
      const clear = ["withdrawNearTo", "withdrawNearAmount", "withdrawToken"];
      if (token) return proposeChange({ kind: "withdraw_token", token, to, amount: amount.toString() }, `send ${token} out of the vault`, clear);
      return proposeChange({ kind: "withdraw", to, amount: amount.toString() }, "send USDC out of the vault", clear);
    };
    return changeSection(
      "withdraw",
      "Take money out on NEAR",
      sub(`It waits ${wait}, and the guardian can cancel it during the wait.`),
      el(
        "div",
        { class: "form-row" },
        formField("withdrawNearTo", "Send it to"),
        formField("withdrawNearAmount", canSendTokens ? "Amount" : "USDC", { mode: "decimal" }),
        canSendTokens ? formField("withdrawToken", "Token account, or empty for USDC") : null,
      ),
      el("div", { class: "actions" }, walletButton("Start the withdrawal", start, "primary")),
    );
  }

  function solanaWithdrawSection(status, wait) {
    if (!status.solana || !SOLANA_NETWORKS[status.solana.network]) return null;
    const collectable = status.solana_withdrawal && Date.now() - Number(status.solana_withdrawal.at_ms) <= CLEARED_MAX_AGE_MS;
    const underWay = collectable || state.pending.some(([, pending]) => pending.change?.kind === "withdraw_solana");
    const start = () => {
      const to = formValue("withdrawSolanaTo");
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) return sayInChanges("Give a Solana address to send it to.");
      const amount = atomic(formValue("withdrawSolanaAmount"), status.solana.decimals ?? 6);
      if (amount === null || amount === 0n) return sayInChanges("Give an amount above zero.");
      return proposeChange({ kind: "withdraw_solana", to, amount: amount.toString() }, "send USDC out of the vault's Solana address", ["withdrawSolanaTo", "withdrawSolanaAmount"]);
    };
    return changeSection(
      "withdrawSolana",
      "Take money out on Solana",
      sub(`It waits ${wait}, and the guardian can cancel it during the wait. After the wait it is collected under the owner's controls, or by your agent.`),
      underWay
        ? sub("One Solana withdrawal at a time: the one under way has to finish first.")
        : [
            el("div", { class: "form-row" }, formField("withdrawSolanaTo", "Send it to, a Solana address"), formField("withdrawSolanaAmount", "USDC", { mode: "decimal" })),
            el("div", { class: "actions" }, walletButton("Start the withdrawal", start, "primary")),
          ],
    );
  }

  /** Changes with their own finishing button elsewhere on the page. */
  const FINISHED_ELSEWHERE = new Set(["unfreeze", "set_passkey", "withdraw_solana"]);

  /** What a waiting change will do, spelled out: it is what the owner reads if someone else proposed it. */
  function changeSummary(change) {
    const name = change?.kind === "set_buying" && !change.buying ? "turn buying off" : changeName(change);
    const title = name[0].toUpperCase() + name.slice(1);
    switch (change?.kind) {
      case "raise_limits":
        return `${title}: ${money(change.limits.per_payment)} a payment, ${money(change.limits.daily)} a day, ${money(change.limits.new_payee)} to someone new`;
      case "add_payee":
        return `${title}: ${change.payee}`;
      case "set_agent":
        return `${title}: ${change.key}`;
      case "set_guardian":
        return `${title}: ${change.guardian ?? "no guardian"}`;
      case "set_delays":
        return `${title}: riskier changes wait ${duration(change.delays.loosen_ms)}, a recovery ${duration(change.delays.recovery_ms)}`;
      case "set_buying":
        return change.buying ? `${title}: grade ${change.buying.min_grade} or better, editions at most ${change.buying.max_age_days} days old${Array.isArray(change.buying.pools) ? `, ${change.buying.pools.length} approved pool${change.buying.pools.length === 1 ? "" : "s"}` : ""}` : title;
      case "withdraw":
        return `${title}: ${money(change.amount)} to ${change.to}`;
      case "withdraw_token":
        return `${title}: ${change.amount} smallest units of ${change.token} to ${change.to}`;
      case "withdraw_solana":
        return `${title}: ${money(change.amount)} to ${change.to}`;
      case "recover":
        return `${title}: ${change.new_owner}`;
      default:
        return title;
    }
  }

  function waitingChanges(who) {
    if (state.pending.length === 0) return [];
    // A recovery is the guardian's to finish; the owner's answer to one is Cancel.
    const canFinish = (kind) => (kind === "recover" ? who === "guardian" : who === "owner" && !FINISHED_ELSEWHERE.has(kind) && !state.status.frozen);
    return [
      el(
        "div",
        { class: "waiting" },
        el("h3", {}, "Changes waiting"),
        state.pending.map(([id, pending]) => {
          const ready = Date.now() >= Number(pending.ready_at_ms);
          const kind = pending.change?.kind;
          return el(
            "div",
            { class: "waiting__row" },
            el("div", {}, changeSummary(pending.change), sub(ready ? "It has waited long enough." : `It can run from ${when(Number(pending.ready_at_ms))}.`)),
            el(
              "div",
              { class: "actions" },
              ready && canFinish(kind)
                ? walletButton("Finish", () => sign("execute", { id }, `finish change #${id}`, { deposit: "0", place: "changes" }), "primary")
                : null,
              walletButton("Cancel", () => sign("cancel", { id }, `cancel change #${id}`, { place: "changes" })),
            ),
          );
        }),
      ),
    ];
  }

  function renderChanges() {
    const box = $("changes");
    if (!box) return;
    const status = state.status;
    const who = role();
    $("change-block").hidden = !status || !who;
    if (!status || !who) return;
    const wait = duration(status.delays?.loosen_ms);
    $("change-note").textContent =
      who === "owner"
        ? "Only your wallet can change these. Your agent cannot. Anything that makes the vault safer happens at once, and anything riskier waits so you can stop it."
        : "As the guardian you can cancel a change while it waits.";
    // Two parts. What waits is always current; the forms are left alone while the owner types in one.
    if (box.children.length !== 2) box.replaceChildren(el("div", { class: "changes__part" }), el("div", { class: "changes__part" }));
    const [waiting, forms] = box.children;
    waiting.replaceChildren(...waitingChanges(who));
    if (forms.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    forms.replaceChildren(
      ...(who === "owner" ? [limitsSection(status, wait), payeeSection(wait), agentSection(status, wait), guardianSection(status, wait), buyingSection(status, wait), withdrawSection(status, wait), solanaWithdrawSection(status, wait)].filter(Boolean) : []),
      ...(wallet.message && wallet.messagePlace === "changes" ? [sub(wallet.message)] : []),
    );
  }

  /* ------------------------------ creating a vault ------------------------------ */

  // The owner's wallet signs once, and only a plain transfer: it sends the NEAR to a one-time setup
  // account, which is the address of a key this browser made. Wallets refuse to add a full-access key
  // for a website, so the wallet is never asked to. The setup account has the registrar make the
  // vault's account with the same key, and the browser then uses it to sign up for USDC and to deploy
  // and set up the vault in one transaction. Setting up deletes that key from the vault, and the
  // setup account closes itself into the vault, so nobody holds a key that can replace the code or
  // empty the vault.

  /** Pays for storing the code (about 5.3 NEAR on the current build), with room for gas and checks. */
  const CREATE_DEPOSIT_NEAR = 6;
  const CREATE_DEPOSIT = BigInt(CREATE_DEPOSIT_NEAR) * 10n ** 24n;
  const USDC_REGISTRATION = 12_500_000_000_000_000_000_000n;
  /** The test network's registrar: it makes accounts ending in its own name. */
  const REGISTRAR = "testnet";
  /** Left in the setup account for its own fees: NEAR holds back about 0.06 for the registrar call. What remains goes to the vault when it closes. */
  const SETUP_RESERVE = 15n * 10n ** 22n;
  /** Where the unfinished setup is kept, so a closed tab cannot strand a paid-for account. */
  const SETUP_RECORD = "setup-of-a-new-vault";
  const NO_CODE = "11111111111111111111111111111111";
  /**
   * What a vault on the test network checks and pays with: the token, the check program, the buying
   * rules and Solana. One file, which the contract's own tests read too. Creating a vault is only
   * open on the test network for now.
   */
  const SETTINGS_FILE = "testnet.json";
  const CREATE_STEPS = [
    ["wallet", `Your wallet sends ${CREATE_DEPOSIT_NEAR} test NEAR`],
    ["account", "The vault's account is made"],
    ["usdc", "The vault signs up to hold USDC"],
    ["code", "The code goes on NEAR and the setup key is deleted"],
    ["check", "Checking that no key is left that could empty it"],
  ];

  const create = { active: false, running: false, step: "", error: "", notice: "", record: null, onChain: false, done: null, settings: null };
  /**
   * A setup this young may still be waiting for the wallet's transaction to reach NEAR, so its key is
   * kept: without it the new account could never be set up. An older one with no account is dead.
   */
  const SETUP_MAX_AGE_MS = 15 * 60_000;

  /** The network's settings, loaded when the form opens so the click that creates a vault need not wait. */
  function loadSettings() {
    create.settings ??= fetch(SETTINGS_FILE, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("The test network's settings could not be loaded.");
        return response.json();
      })
      .catch((error) => {
        create.settings = null;
        throw error;
      });
    return create.settings;
  }

  async function forgetSetup() {
    await deviceDelete(SETUP_RECORD).catch(() => {});
    create.record = null;
    create.onChain = false;
  }

  async function accountExists(name) {
    try {
      await rpc("query", { request_type: "view_account", finality: "final", account_id: name });
      return true;
    } catch (error) {
      if (/UNKNOWN_ACCOUNT/.test(String(error.message))) return false;
      throw error;
    }
  }

  async function until(check, failure) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await check().catch(() => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    throw new Error(failure);
  }

  /** A name to start from: the owner's own, with -vault. */
  function suggestedName() {
    const first = wallet.account.split(".")[0];
    return /^[a-z\d]+(?:[-_][a-z\d]+)*$/.test(first) && first.length <= 40 ? `${first}-vault` : "my-vault";
  }

  /** What the form asks NEAR to make with the network's `settings`, or `error` in plain words. */
  function createPlan(settings) {
    const owner = wallet.account;
    const name = formValue("createName", suggestedName()).toLowerCase();
    const vault = `${name}.${REGISTRAR}`;
    if (!/^[a-z\d]+(?:[-_][a-z\d]+)*$/.test(name) || !ACCOUNT.test(vault)) return { error: "A vault name can use lowercase letters, numbers, - and _." };
    const perPayment = atomic(formValue("createPayment", "1"), 6);
    const daily = atomic(formValue("createDaily", "3"), 6);
    const newPayee = atomic(formValue("createNew", "0.25"), 6);
    if (perPayment === null || daily === null || newPayee === null) return { error: "Each limit must be an amount in USDC." };
    if (newPayee > perPayment || perPayment > daily) return { error: "Someone new cannot get more than one payment, and one payment cannot be more than a day's limit." };
    const hours = Number(formValue("createHours", "24"));
    if (!(hours >= 1)) return { error: "Riskier changes must wait at least 1 hour." };
    const guardian = formValue("createGuardian").toLowerCase();
    if (guardian && !ACCOUNT.test(guardian)) return { error: "The guardian must be a NEAR account, or empty." };
    if (guardian === owner) return { error: "The guardian must be someone other than you." };
    const agent = formValue("createAgent");
    if (agent && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(agent)) return { error: "The agent's key must be ed25519: and its letters and numbers, or empty." };
    return {
      vault,
      args: {
        ...settings,
        owner,
        limits: { per_payment: perPayment.toString(), daily: daily.toString(), new_payee: newPayee.toString() },
        guardian: guardian || null,
        agent: agent || null,
        delays: { loosen_ms: Math.round(hours * 3_600_000), recovery_ms: Math.max(604_800_000, Math.round(hours * 3_600_000)) },
        lock: true,
      },
    };
  }

  function createStep(step) {
    create.step = step;
    renderCreate();
  }

  const refusedBy = (result) => {
    const failure = result?.status?.Failure;
    if (!failure) return;
    if (failure.ActionError?.kind?.LackBalanceForState) throw new Error("The vault's account does not have enough NEAR to store its code.");
    if (failure.ActionError?.kind?.AccountAlreadyExists) throw new Error("That account name is already taken. Try another name.");
    throw new Error(`NEAR refused it: ${JSON.stringify(failure).slice(0, 240)}`);
  };

  /** Whether the wallet's NEAR arrived: it is at the setup account, or it already went on into the vault. */
  async function paidFor(record) {
    if (record.ours) return true;
    return accountExists(record.setup);
  }

  /** Whether the account with the vault's name carries the setup key: only this setup can have made it. */
  async function carriesSetupKey(record) {
    const keys = await accessKeys(record.vault).catch(() => []);
    return keys.some((key) => key.public_key === record.publicKey);
  }

  const setupSigner = (record, account) => ({ account, publicKey: record.publicKey, privateKey: record.keys.privateKey, finality: "optimistic" });

  /**
   * Sends the wallet's NEAR back when no vault was made: the vault's account, if it is still empty,
   * and the setup account both close in the owner's favour.
   */
  async function refundSetup(record) {
    const owner = record.args.owner;
    if (await accountExists(record.vault)) {
      const account = await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: record.vault });
      if (await carriesSetupKey(record)) {
        if (account.code_hash !== NO_CODE) throw new Error("The vault's code is already on NEAR. Finish setting it up.");
        refusedBy(await sendSigned(setupSigner(record, record.vault), record.vault, [deleteAccount(owner)], 60_000));
      } else if (record.ours) throw new Error("The vault is already set up, and that cannot be undone.");
    }
    if (await accountExists(record.setup)) refusedBy(await sendSigned(setupSigner(record, record.setup), record.setup, [deleteAccount(owner)], 60_000));
    await forgetSetup();
  }

  /** Everything after the wallet's signature. Each part looks at the chain first, so it can run again. */
  async function finishSetup(record) {
    const { vault, args, setup } = record;
    const signer = setupSigner(record, vault);
    createStep("wallet");
    await until(() => paidFor(record), "Your wallet's NEAR has not arrived yet.");
    createStep("account");
    if (!record.ours) {
      // Someone else can take the name in the seconds after it was checked. Only an account that
      // carries this setup's key is the one this setup paid for.
      let made = false;
      if (await accountExists(vault)) made = await carriesSetupKey(record);
      else {
        const held = await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: setup });
        const deposit = big(held.amount) - SETUP_RESERVE;
        if (deposit <= 0n) throw new Error("The setup account holds too little NEAR to make the vault.");
        refusedBy(
          await sendSigned(setupSigner(record, setup), REGISTRAR, [functionCall("create_account", { new_account_id: vault, new_public_key: record.publicKey }, 60_000_000_000_000n, deposit)], 60_000),
        );
        made = await until(() => carriesSetupKey(record), "").then(
          () => true,
          () => false,
        );
      }
      if (!made) {
        await refundSetup(record);
        throw new Error(`${vault} was taken before your vault could be made. Your NEAR went back to your wallet. Try another name.`);
      }
      record.ours = true;
      await devicePut(SETUP_RECORD, record);
    }
    createStep("usdc");
    const registered = await view(args.token, "storage_balance_of", { account_id: vault }).catch(() => null);
    if (!registered) {
      const bounds = await view(args.token, "storage_balance_bounds").catch(() => null);
      const deposit = big(bounds?.min) || USDC_REGISTRATION;
      refusedBy(await sendSigned(signer, args.token, [functionCall("storage_deposit", { account_id: vault, registration_only: true }, 30_000_000_000_000n, deposit)], 60_000));
    }
    createStep("code");
    const response = await fetch("guard.wasm", { cache: "no-store" });
    if (!response.ok) throw new Error("The vault's code could not be loaded.");
    const code = new Uint8Array(await response.arrayBuffer());
    const codeHash = toBase58(new Uint8Array(await crypto.subtle.digest("SHA-256", code)));
    const account = await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: vault });
    if (account.code_hash === NO_CODE) refusedBy(await sendSigned(signer, vault, [deployContract(code), functionCall("new", args, 100_000_000_000_000n)], 90_000));
    createStep("check");
    await until(async () => {
      const [keys, now] = await Promise.all([accessKeys(vault), rpc("query", { request_type: "view_account", finality: "final", account_id: vault })]);
      return now.code_hash === codeHash && !keys.some((key) => key.access_key?.permission === "FullAccess");
    }, "The vault is on NEAR, but a key that could empty it is still there. Do not put money in it.");
    // The setup account has done its work: it closes, and what is left in it goes to the vault.
    if (await accountExists(setup).catch(() => false)) await sendSigned(setupSigner(record, setup), setup, [deleteAccount(vault)], 60_000).catch(() => {});
    await deviceDelete(SETUP_RECORD);
    create.record = null;
    create.done = { vault, codeHash };
  }

  async function runSetup(work) {
    if (create.running) return;
    create.running = true;
    create.error = "";
    create.notice = "";
    try {
      await work();
    } catch (error) {
      create.error = String(error?.message ?? error);
      if (create.record) {
        // Whether the wallet's transaction reached NEAR decides what can be done next. A wallet can
        // report a failure and still have sent it, so a young record is kept either way.
        create.onChain = await paidFor(create.record).catch(() => true);
        if (!create.onChain && Date.now() - (create.record.startedAt ?? 0) > SETUP_MAX_AGE_MS) await forgetSetup();
      }
    } finally {
      create.running = false;
      renderCreate();
    }
  }

  function startCreate() {
    // Checked before anything loads, so a mistyped form answers at once.
    const asked = createPlan({});
    if (asked.error) {
      create.error = asked.error;
      renderCreate();
      return;
    }
    runSetup(async () => {
      createStep("wallet");
      // One round of reads, so the wallet opens soon after the click.
      const [settings, taken, owner] = await Promise.all([
        loadSettings(),
        accountExists(asked.vault),
        rpc("query", { request_type: "view_account", finality: "final", account_id: wallet.account }),
      ]);
      const plan = createPlan(settings);
      if (taken) throw new Error(`${plan.vault} is already taken. Try another name.`);
      // The deposit, and a little for the fee of creating the account.
      if (big(owner.amount) < CREATE_DEPOSIT + 10n ** 23n) throw new Error(`Your wallet has ${near(owner.amount)}. Creating a vault takes ${CREATE_DEPOSIT_NEAR} test NEAR and a small fee.`);
      const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
      const publicKey = `ed25519:${toBase58(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)))}`;
      // The key's own address: an account NEAR makes, with this key on it, when NEAR is first sent there.
      const setup = toHex(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
      const record = { ...plan, keys, publicKey, setup, startedAt: Date.now() };
      await devicePut(SETUP_RECORD, record);
      create.record = record;
      create.onChain = false;
      const connector = await walletConnector();
      const connected = await connector.wallet();
      refusedBy(
        await connected.signAndSendTransaction({
          receiverId: setup,
          actions: [{ type: "Transfer", params: { deposit: CREATE_DEPOSIT.toString() } }],
        }),
      );
      await finishSetup(record);
    });
  }

  function createProgress() {
    const at = CREATE_STEPS.findIndex(([step]) => step === create.step);
    return el(
      "ul",
      { class: "steps" },
      CREATE_STEPS.map(([, label], index) => el("li", { class: index < at ? "steps__done" : index === at ? "steps__now" : "steps__next" }, label)),
    );
  }

  function renderCreate() {
    const form = $("create-form");
    if (!create.active || !form) return;
    if (form.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    const box = { replaceChildren: (...parts) => form.replaceChildren(...parts.filter(Boolean)) };
    const error = create.error ? el("p", { class: "note tone-refused" }, create.error) : null;
    if (create.done) {
      const link = el("a", { class: "button-primary", href: `?vault=${create.done.vault}` }, "Open your vault");
      $("create-title").replaceChildren(el("span", { class: "dim" }, "Your vault is locked. "), "You own it.");
      $("create-lede").textContent = "No key can replace its code or empty it. The key that set it up has been deleted, and only your wallet can change the rules.";
      $("create-terms").hidden = true;
      box.replaceChildren(
        el("dl", { class: "rules" }, el("dt", {}, "Your vault"), el("dd", {}, mono(create.done.vault)), el("dt", {}, "Code on NEAR"), el("dd", {}, mono(create.done.codeHash))),
        el("p", { class: "note" }, "To use it, send test USDC to your vault's account from your wallet."),
        link,
      );
      return;
    }
    if (create.running) {
      box.replaceChildren(createProgress(), el("p", { class: "note" }, create.step === "wallet" ? "Look for your wallet asking you to approve." : "This takes under a minute. Keep this page open."));
      return;
    }
    if (create.record) {
      const again = () => runSetup(() => finishSetup(create.record));
      if (create.onChain) {
        const back = () =>
          runSetup(async () => {
            await refundSetup(create.record);
            create.notice = "Your NEAR went back to your wallet. No vault was made.";
          });
        box.replaceChildren(
          el("p", { class: "note" }, `Your wallet already paid for ${create.record.vault}, but its setup did not finish.`),
          error,
          walletButton("Finish setting it up", again, "primary"),
          el("p", { class: "note" }, "Or stop here: ", walletButton("Send my NEAR back", back)),
        );
        return;
      }
      box.replaceChildren(
        el("p", { class: "note" }, "Your wallet's NEAR has not arrived. If your wallet did approve it, it can take a moment."),
        error,
        walletButton("Check again", again, "primary"),
        el(
          "p",
          { class: "note" },
          "If your wallet did not approve it, nothing was paid. ",
          walletButton("Start over", async () => {
            await forgetSetup();
            create.error = "";
            renderCreate();
          }),
        ),
      );
      return;
    }
    if (!wallet.account) {
      box.replaceChildren(error, walletButton("Connect your wallet", () => connectWallet(), "primary"), el("p", { class: "note" }, "Your wallet becomes the vault's owner. Your key stays in your wallet."));
      return;
    }
    const fullName = el("span", { class: "sub" }, `It will be ${formValue("createName", suggestedName())}.${REGISTRAR}`);
    const nameField = formField("createName", "Vault name", { start: suggestedName() });
    nameField.querySelector("input").addEventListener("input", () => (fullName.textContent = `It will be ${formValue("createName", suggestedName())}.${REGISTRAR}`));
    box.replaceChildren(
      create.notice ? el("p", { class: "note" }, create.notice) : null,
      el("p", { class: "note" }, "Owner: ", mono(wallet.account), " ", walletButton("Disconnect", disconnectWallet)),
      el("div", { class: "form-row" }, el("div", {}, nameField, fullName)),
      el(
        "div",
        { class: "form-row" },
        formField("createPayment", "Most for one payment, in USDC", { start: "1", mode: "decimal" }),
        formField("createDaily", "Most in one day, in USDC", { start: "3", mode: "decimal" }),
        formField("createNew", "Most for someone new, in USDC", { start: "0.25", mode: "decimal" }),
      ),
      el(
        "div",
        { class: "form-row" },
        formField("createHours", "Riskier changes wait, in hours", { start: "24", mode: "decimal" }),
        formField("createGuardian", "Guardian account, if you have one"),
        formField("createAgent", "Your agent's public key, or add it later", { placeholder: "ed25519:…", help: agentKeyHint() }),
      ),
      error,
      walletButton("Create the vault", startCreate, "primary"),
      el(
        "p",
        { class: "note create-fine" },
        `Your wallet asks you to approve one thing: ${CREATE_DEPOSIT_NEAR} test NEAR to a long address of letters and numbers.`,
        el("br"),
        "That is this page's one-time setup account. It makes your vault and closes itself, and the NEAR stays in the vault to pay for storing its code.",
      ),
    );
  }

  /* ------------------------------- your vaults ------------------------------- */

  const mine = { active: false, account: "", loading: false, list: null, error: "" };

  /** An account's own transactions, newest first, as FastNEAR returns them. */
  async function transactionsOf(account, pages = 2) {
    const hashes = [];
    let resume;
    for (let page = 0; page < pages; page += 1) {
      const result = await postJson(`${state.net.history}/v0/account`, { account_id: account, limit: PAGE, ...(resume ? { resume_token: resume } : {}) });
      const entries = result.account_txs ?? [];
      for (const entry of entries) if (typeof entry.transaction_hash === "string" && TX_HASH.test(entry.transaction_hash)) hashes.push(entry.transaction_hash);
      resume = result.resume_token;
      if (!resume || entries.length < PAGE) break;
    }
    const out = [];
    for (let start = 0; start < hashes.length; start += BATCH) {
      const { transactions = [] } = await postJson(`${state.net.history}/v0/transactions`, { tx_hashes: hashes.slice(start, start + BATCH) });
      for (const record of transactions) if (record?.transaction) out.push(record.transaction);
    }
    return out;
  }

  const actionName = (action) => (typeof action === "string" ? action : (Object.keys(action ?? {})[0] ?? ""));

  /**
   * The vaults an account owns, from public chain data only: the ones this page made for it (its
   * wallet paid a one-time setup account, which created the vault) and the ones its wallet has
   * used. Each must name this owner in its status and run a trusted build no key can replace.
   */
  async function findVaults(owner) {
    const candidates = new Set();
    const setups = new Set();
    for (const tx of await transactionsOf(owner)) {
      const to = tx.receiver_id;
      if (tx.signer_id !== owner || typeof to !== "string" || to === owner || !ACCOUNT.test(to)) continue;
      for (const action of tx.actions ?? []) {
        if (actionName(action) === "Transfer" && /^[0-9a-f]{64}$/.test(to)) setups.add(to);
        else candidates.add(to);
      }
    }
    for (const setup of [...setups].slice(0, 20)) {
      for (const tx of await transactionsOf(setup, 1).catch(() => [])) {
        // Only the vault the setup account itself asked the registrar to create.
        if (tx.signer_id !== setup || tx.receiver_id !== REGISTRAR) continue;
        for (const action of tx.actions ?? []) {
          const call = action?.FunctionCall;
          if (call?.method_name !== "create_account" || typeof call.args !== "string") continue;
          try {
            const name = JSON.parse(atob(call.args)).new_account_id;
            if (typeof name === "string" && ACCOUNT.test(name)) candidates.add(name);
          } catch {
            // Not the creation of a vault.
          }
        }
      }
    }
    const names = [...candidates].slice(0, 60);
    const found = [];
    for (let start = 0; start < names.length; start += 8) {
      const answers = await Promise.all(
        names.slice(start, start + 8).map((name) =>
          view(name, "status")
            .then((status) => ({ name, status }))
            .catch(() => null),
        ),
      );
      const claimed = answers.filter((answer) => answer?.status?.owner === owner);
      // Any contract can claim you as its owner: keep only trusted builds that no key can replace.
      const trusted = await Promise.all(claimed.map((answer) => isGenuine(answer.name).catch(() => false)));
      claimed.forEach((answer, index) => trusted[index] && found.push({ vault: answer.name, frozen: Boolean(answer.status.frozen) }));
    }
    return found.sort((a, b) => a.vault.localeCompare(b.vault));
  }

  async function loadMine(account) {
    mine.account = account;
    mine.loading = true;
    mine.error = "";
    mine.list = null;
    renderMine();
    try {
      const list = await findVaults(account);
      if (mine.account === account) mine.list = list;
    } catch (error) {
      if (mine.account === account) mine.error = error?.message ?? String(error);
    }
    if (mine.account !== account) return;
    mine.loading = false;
    renderMine();
  }

  /** The start page's list of the connected wallet's vaults. */
  function renderMine() {
    const box = $("mine");
    const action = $("start-action");
    if (!box || !action || !mine.active) return;
    if (!wallet.account) {
      mine.account = "";
      box.hidden = true;
      box.replaceChildren();
      const connect = el("button", { class: "button-primary", type: "button" }, "Connect your wallet");
      connect.addEventListener("click", () => connectWallet());
      action.replaceChildren(connect);
      return;
    }
    if (mine.account !== wallet.account) return void loadMine(wallet.account);
    let body;
    if (mine.loading) body = el("p", { class: "note" }, "Looking for your vaults on NEAR…");
    else if (mine.error) body = el("p", { class: "note tone-refused" }, `They could not be listed: ${mine.error}. `, walletButton("Try again", () => loadMine(wallet.account)));
    else if (!mine.list?.length) body = el("p", { class: "note" }, "No vault yet.");
    else
      body = el(
        "ul",
        { class: "mine-list" },
        ...mine.list.map(({ vault, frozen }) =>
          el("li", {}, el("a", { class: "link mono", href: `?vault=${vault}` }, vault), el("span", { class: frozen ? "tone-refused" : "tone-paid" }, frozen ? "Frozen" : "Open")),
        ),
      );
    box.hidden = false;
    box.replaceChildren(el("p", { class: "note" }, mono(wallet.account), walletButton("Disconnect", disconnectWallet)), body);
    action.replaceChildren(el("a", { class: "button-primary", href: "?create=1" }, "Create a vault"));
  }

  function renderWallet() {
    renderMine();
    renderChanges();
    renderCreate();
    const box = $("wallet");
    if (!box) return;
    if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    const parts = [];
    if (!wallet.account) {
      parts.push(
        walletButton("Connect the owner's wallet", () => connectWallet(), "primary"),
        el("span", { class: "tone-quiet" }, " to approve, reject, freeze or change the rules here. Your key stays in your wallet."),
      );
    } else {
      const who = role();
      parts.push(
        el("span", {}, "Connected: ", account(wallet.account), who ? ` (the vault's ${who})` : ""),
        " ",
        walletButton("Disconnect", disconnectWallet),
        who ? null : sub("This account is not this vault's owner or guardian, so the vault would refuse its approval."),
        ...freezeControls(who),
        ...solanaControls(who),
      );
    }
    parts.push(...fingerprintControls(role()));
    if (wallet.message && wallet.messagePlace === "wallet") parts.push(sub(wallet.message));
    box.replaceChildren(...parts.filter((part) => part !== null));
    if (state.status) $("owner-block").hidden = state.genuine === false;
  }

  /* ----------------------------- the fingerprint ----------------------------- */

  // A passkey on the owner's device signs each action, and the vault checks that signature itself.
  // The NEAR key that pays the fee is made here too, cannot be read back out of this browser, and
  // can only call `use_passkey`: without this device and the owner's fingerprint it does nothing.

  const DEVICE_DB = "svalin-guard-device";
  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const canUseFingerprint = () => location.protocol === "https:" && Boolean(window.PublicKeyCredential && crypto.subtle && window.indexedDB);

  function toBase58(bytes) {
    let value = bytes.reduce((sum, byte) => sum * 256n + BigInt(byte), 0n);
    let text = "";
    while (value > 0n) {
      text = BASE58[Number(value % 58n)] + text;
      value /= 58n;
    }
    for (const byte of bytes) {
      if (byte !== 0) break;
      text = `1${text}`;
    }
    return text;
  }

  function fromBase58(text) {
    let value = 0n;
    for (const char of text) value = value * 58n + BigInt(BASE58.indexOf(char));
    const out = [];
    while (value > 0n) {
      out.unshift(Number(value & 255n));
      value >>= 8n;
    }
    return new Uint8Array([...new Array(text.length - text.replace(/^1+/, "").length).fill(0), ...out]);
  }

  const toBase64 = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const fromHex = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));

  /** WebAuthn answers in ASN.1 DER; the vault takes r then s, 32 bytes each. */
  function derToRaw(der) {
    let at = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
    const part = () => {
      const length = der[at + 1];
      const value = der.slice(at + 2, at + 2 + length);
      at += 2 + length;
      const fitted = new Uint8Array(32);
      fitted.set(value.slice(-32), 32 - Math.min(value.length, 32));
      return fitted;
    };
    const r = part();
    return new Uint8Array([...r, ...part()]);
  }

  function deviceDb() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DEVICE_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("devices");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async function deviceGet(vault) {
    if (!window.indexedDB) return null;
    const db = await deviceDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction("devices").objectStore("devices").get(vault);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function devicePut(vault, record) {
    const db = await deviceDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("devices", "readwrite");
      tx.objectStore("devices").put(record, vault);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deviceDelete(vault) {
    const db = await deviceDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("devices", "readwrite");
      tx.objectStore("devices").delete(vault);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Whether this device holds the key the vault has registered for the fingerprint. */
  function deviceIsRegistered(status) {
    return Boolean(state.device && status?.passkey && state.device.deviceKey === status.passkey.device_key);
  }

  // Two kinds of transaction are signed on this page and not by a wallet: a fingerprint's call, and
  // the setup of a new vault. Both use a key this browser made and cannot read back out.

  const littleEndian = (value, size) => Uint8Array.from({ length: size }, (_, index) => Number((BigInt(value) >> BigInt(8 * index)) & 255n));

  function joined(...parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  const sized = (data) => joined(littleEndian(data.length, 4), data);
  const borshText = (value) => sized(new TextEncoder().encode(value));
  const functionCall = (method, args, gas, deposit = 0n) => joined([2], borshText(method), borshText(JSON.stringify(args)), littleEndian(gas, 8), littleEndian(deposit, 16));
  const deployContract = (code) => joined([1], sized(code));
  /** Closes the signing account; what it holds goes to `beneficiary`. */
  const deleteAccount = (beneficiary) => joined([7], borshText(beneficiary));

  /** Signs and sends one transaction; `signer` is the account, its public key and its private key. */
  async function sendSigned(signer, receiver, actions, timeoutMs) {
    const access = await rpc("query", { request_type: "view_access_key", finality: signer.finality ?? "final", account_id: signer.account, public_key: signer.publicKey });
    const block = await rpc("block", { finality: "final" });
    const transaction = joined(
      borshText(signer.account),
      [0],
      fromBase58(signer.publicKey.replace(/^ed25519:/, "")),
      littleEndian(BigInt(access.nonce) + 1n, 8),
      borshText(receiver),
      fromBase58(block.header.hash),
      littleEndian(actions.length, 4),
      ...actions,
    );
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", transaction));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signer.privateKey, hash));
    return rpc("send_tx", { signed_tx_base64: toBase64(joined(transaction, [0], signature)), wait_until: "EXECUTED_OPTIMISTIC" }, timeoutMs);
  }

  /** Signs one call to `use_passkey` with the device's own key, which pays the fee. */
  async function sendFromDevice(record, args) {
    const signer = { account: state.vault, publicKey: record.deviceKey, privateKey: record.keys.privateKey };
    return sendSigned(signer, state.vault, [functionCall("use_passkey", args, 100_000_000_000_000n)]);
  }

  /** Makes the passkey and the device key, then asks the owner's wallet to propose adding them. */
  async function setUpFingerprint() {
    if (wallet.busy) return;
    wallet.message = "Making a passkey on this device…";
    renderWallet();
    try {
      const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
      const deviceKey = `ed25519:${toBase58(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)))}`;
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { id: location.hostname, name: "Svalin Guard" },
          user: { id: new TextEncoder().encode(state.vault), name: state.vault, displayName: `Svalin Guard: ${state.vault}` },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
          attestation: "none",
          timeout: 120_000,
        },
      });
      const point = new Uint8Array(credential.response.getPublicKey()).slice(-65);
      const compressed = new Uint8Array([point[64] & 1 ? 3 : 2, ...point.slice(1, 33)]);
      const record = { keys, credentialId: new Uint8Array(credential.rawId), deviceKey };
      await devicePut(state.vault, record);
      state.device = record;
      const passkey = { public_key: toHex(compressed), rp_id: location.hostname, origin: location.origin, device_key: deviceKey };
      await sign("propose", { change: { kind: "set_passkey", passkey } }, "add this device's fingerprint");
    } catch (error) {
      wallet.message = `The fingerprint was not added: ${error?.message ?? error}`;
      renderWallet();
    }
  }

  /** Asks for the fingerprint and sends the action. The vault checks the signature itself. */
  async function useFingerprint(action, what) {
    if (wallet.busy) return;
    wallet.busy = true;
    wallet.message = `Waiting for your fingerprint to ${what}…`;
    renderWallet();
    try {
      const challenge = await view(state.vault, "passkey_challenge", { action });
      const { response } = await navigator.credentials.get({
        publicKey: {
          challenge: fromHex(challenge),
          rpId: state.status.passkey.rp_id,
          allowCredentials: [{ type: "public-key", id: state.device.credentialId }],
          userVerification: "required",
          timeout: 60_000,
        },
      });
      const result = await sendFromDevice(state.device, {
        action,
        authenticator_data: toBase64(new Uint8Array(response.authenticatorData)),
        client_data_json: toBase64(new Uint8Array(response.clientDataJSON)),
        signature: toBase64(derToRaw(new Uint8Array(response.signature))),
      });
      const failure = result?.status?.Failure;
      wallet.message = failure ? `The vault refused it: ${JSON.stringify(failure).slice(0, 200)}` : `Done: ${what}. The page shows it within 20 seconds.`;
      refresh(state.run);
    } catch (error) {
      wallet.message = `Not sent: ${error?.message ?? error}`;
    } finally {
      wallet.busy = false;
      renderWallet();
    }
  }

  /** Approve and reject with the fingerprint, on a device that has it. No wallet is needed. */
  function fingerprintActions(id, payment, status, approvable) {
    if (!deviceIsRegistered(status)) return null;
    const amount = big(payment.amount);
    const safe = state.knownPayees.has(payment.payee) && !(payment.reasons ?? []).includes("PAYEE_CHANGED");
    const within = amount <= big(status.limits?.per_payment) && big(status.spent_today) + amount <= big(status.limits?.daily);
    const canApprove = approvable && !status.frozen && safe && within;
    return el(
      "div",
      {},
      el(
        "div",
        { class: "actions" },
        canApprove ? walletButton("Approve with fingerprint", () => useFingerprint({ kind: "approve", id }, `approve held payment #${id}`), "primary") : null,
        walletButton("Reject with fingerprint", () => useFingerprint({ kind: "reject", id }, `reject held payment #${id}`)),
      ),
      approvable && !canApprove ? sub("Approving this one needs your wallet, which shows exactly who gets paid.") : null,
    );
  }

  /** Adding, finishing and removing the fingerprint, and freezing with it. */
  function fingerprintControls(who) {
    const status = state.status;
    if (!status || !("passkey" in status)) return [];
    if (deviceIsRegistered(status)) {
      return [
        status.frozen ? null : el("div", { class: "actions" }, walletButton("Freeze with fingerprint", () => useFingerprint({ kind: "freeze" }, "freeze the vault"), "danger")),
        sub("This device has your fingerprint. It can stop money at any time, and approve a payment to someone already paid, within the limits."),
      ].filter(Boolean);
    }
    const pending = state.pending.find(([, change]) => change.change?.kind === "set_passkey");
    if (pending) {
      const ready = Date.now() >= Number(pending[1].ready_at_ms);
      if (!ready) return [sub(`The fingerprint can be finished from ${when(Number(pending[1].ready_at_ms))}. The owner or the guardian can still cancel it.`)];
      if (who !== "owner") return [sub("The fingerprint has waited long enough; the owner can finish adding it.")];
      return [el("div", { class: "actions" }, walletButton("Finish adding the fingerprint", () => sign("execute", { id: pending[0] }, "finish adding the fingerprint", { deposit: "0" }), "primary"))];
    }
    if (status.passkey) {
      return [
        sub("A fingerprint is set up on another device."),
        who ? el("div", { class: "actions" }, walletButton("Remove the fingerprint", () => sign("remove_passkey", {}, "remove the fingerprint"))) : null,
      ].filter(Boolean);
    }
    if (who !== "owner") return [];
    if (!canUseFingerprint()) return [sub("Optional: a fingerprint can be added from this page over https, on a browser with passkeys. The vault works without one.")];
    return [
      el("div", { class: "actions" }, walletButton("Add my fingerprint on this device", setUpFingerprint)),
      sub(
        `Optional. The vault works without it. With a fingerprint, this device can freeze the vault and approve a payment to someone already paid, without opening your wallet. Adding it waits ${duration(status.delays?.loosen_ms)}.`,
      ),
    ];
  }

  /* ----------------------- moving Solana money out ----------------------- */

  async function solanaRpc(network, method, params) {
    const body = await postJson(network.rpc, { jsonrpc: "2.0", id: "svalin-dashboard", method, params });
    if (body.error) throw new Error(body.error.message ?? "Solana RPC error");
    return body.result;
  }

  async function collectWithdrawal(waiting) {
    const { solana, solana_address: address } = state.status;
    const network = SOLANA_NETWORKS[solana.network];
    wallet.message = "Reading Solana…";
    renderWallet();
    try {
      const tokenAccount = async (owner) => {
        const result = await solanaRpc(network, "getTokenAccountsByOwner", [owner, { mint: solana.mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
        if (!result.value.length) throw new Error(`${owner} has no USDC account yet`);
        return result.value[0].pubkey;
      };
      const [source, destination, latest] = await Promise.all([tokenAccount(address), tokenAccount(waiting.to), solanaRpc(network, "getLatestBlockhash", [{ commitment: "confirmed" }])]);
      const transaction = { fee_payer: network.feePayer, recent_blockhash: latest.value.blockhash, source, destination };
      await sign("collect_solana_withdrawal", { memo: toHex(crypto.getRandomValues(new Uint8Array(16))), transaction }, "collect the Solana withdrawal", {
        done: (hash) => `Signed. To send it within a minute, run: node examples/demo-agent/withdraw-solana.mjs ${state.vault} ${hash}`,
      });
    } catch (error) {
      wallet.message = `Not collected: ${error?.message ?? error}`;
      renderWallet();
    }
  }

  /** The owner's way to move money out of the vault's Solana address. It waits, like every withdrawal. */
  function solanaControls(who) {
    const status = state.status;
    if (who !== "owner" || !status?.solana || !SOLANA_NETWORKS[status.solana.network]) return [];
    const waiting = status.solana_withdrawal;
    if (waiting && Date.now() - Number(waiting.at_ms) <= CLEARED_MAX_AGE_MS) {
      return [
        sub(`${money(waiting.amount)} to ${waiting.to} has finished its wait. Your agent can collect and send it within the hour, or you can here; a signed payment lasts about a minute.`),
        el("div", { class: "actions" }, walletButton("Collect the Solana withdrawal", () => collectWithdrawal(waiting), "primary")),
      ];
    }
    const pending = state.pending.find(([, change]) => change.change?.kind === "withdraw_solana");
    if (pending) {
      const ready = Date.now() >= Number(pending[1].ready_at_ms);
      if (!ready) return [sub(`A Solana withdrawal is waiting until ${when(Number(pending[1].ready_at_ms))}. The owner or the guardian can still cancel it.`)];
      return [el("div", { class: "actions" }, walletButton("Finish the Solana withdrawal's wait", () => sign("execute", { id: pending[0] }, "finish the Solana withdrawal's wait", { deposit: "0" }), "primary"))];
    }
    // Starting one is a change to the rules: its form is under "Take money out on Solana".
    return [];
  }

  function renderTerms(services) {
    $("terms").replaceChildren(
      ...services.map(([service, terms]) =>
        el(
          "tr",
          {},
          el("td", {}, mono(service)),
          el("td", {}, account(terms.payee)),
          el("td", {}, money(terms.price)),
          el("td", {}, when(Number(terms.since_ms)), sub(terms.by_owner ? "by the owner" : "by the first payment")),
        ),
      ),
    );
    $("terms-block").hidden = services.length === 0;
  }

  function renderRules(status, keys, pending, registry) {
    const rows = [];
    const add = (term, ...value) => rows.push(el("dt", {}, term), el("dd", {}, ...value));
    add(
      "State",
      status.frozen
        ? el("span", { class: "tone-refused" }, "Frozen: it pays nothing until the owner unfreezes it, which waits.")
        : el("span", { class: "tone-paid" }, "Open"),
    );
    const agentKey = keys.find((key) => key.public_key === status.agent);
    const fullAccess = keys.filter((key) => key.access_key?.permission === "FullAccess");
    const permission = agentKey?.access_key?.permission?.FunctionCall;
    add(
      "The agent's public key",
      status.agent ? keyWithCopy(status.agent) : "None: the agent was revoked.",
      permission
        ? sub(
            `It can call only ${(permission.method_names ?? []).join(", ") || "any method"} on ${permission.receiver_id}`,
            permission.allowance ? `, with ${near(permission.allowance)} of gas left.` : ".",
          )
        : null,
    );
    add(
      "Keys on the vault",
      fullAccess.length
        ? el("span", { class: "tone-refused" }, `${fullAccess.length} full-access key${fullAccess.length === 1 ? "" : "s"}: whoever holds one can redeploy or empty the vault.`)
        : state.genuine === false
          ? el("span", { class: "tone-refused" }, `${keys.length} key${keys.length === 1 ? "" : "s"}, none with full access. But its code is not a released Svalin Guard build, so that code could pay anyone.`)
          : `${keys.length} key${keys.length === 1 ? "" : "s"}, none with full access, so no key can redeploy or empty the vault.`,
    );
    add("Owner", mono(status.owner), sub("Approves held payments, and makes changes: safer ones at once, riskier ones after a wait."));
    add("Guardian", status.guardian ? mono(status.guardian) : "None", status.guardian ? sub("Can freeze, cancel a change, reject a payment, and approve a large one together with the owner.") : null);
    if (status.limits) {
      add(
        "Limits",
        `${money(status.limits.per_payment)} a payment to a payee it has paid before, ${money(status.limits.new_payee)} to a new one, ${money(status.limits.daily)} a day.`,
        sub(`Paid today: ${money(status.spent_today)}. Known payees: ${status.known_payees ?? 0}.`),
      );
    }
    if (status.delays) {
      add("Waiting times", `A change that loosens the rules waits ${duration(status.delays.loosen_ms)}; a recovery by the guardian waits ${duration(status.delays.recovery_ms)}.`);
    }
    add(
      "New payees",
      status.checker
        ? [
            "Checked in a TEE through ",
            mono(String(status.checker.outlayer)),
            `; an account younger than ${duration(status.checker.min_age_ms)} is held.`,
            sub("The program is pinned by its SHA-256: ", mono(String(status.checker.wasm_hash))),
          ]
        : "Not checked: no check program is set.",
    );
    if ("solana" in status) {
      const settings = status.solana;
      const network = SOLANA_NETWORKS[settings?.network];
      add(
        "Paying on Solana",
        settings
          ? [
              `On ${network?.label ?? settings.network}, from `,
              status.solana_address ? mono(String(status.solana_address)) : "an address not loaded yet",
              ", which NEAR's signing network ",
              mono(String(settings.signer)),
              " derives for this vault. Nobody holds its key: the network signs only the payments this vault writes, under the same rules and limits.",
              status.solana_address ? sub(solanaLink(status, "The address on Solana's explorer")) : null,
              Number(status.cleared) > 0 ? sub(`${status.cleared} approved payment${Number(status.cleared) === 1 ? "" : "s"} waiting for the agent to collect.`) : null,
              status.solana_withdrawal ? sub(`A withdrawal of ${money(status.solana_withdrawal.amount)} to ${status.solana_withdrawal.to} has finished its wait.`) : null,
            ]
          : "Off.",
      );
    }
    if ("buying" in status) {
      const buying = status.buying;
      add(
        "Buying tokens",
        buying
          ? [
              `Liquidity grade ${buying.min_grade} or better, from editions at most ${buying.max_age_days} days old, confirmed by `,
              mono(String(buying.registry)),
              `. Fee ${(Number(buying.fee_bps) / 100).toString()}% to `,
              mono(String(buying.fee_account)),
              ".",
              Array.isArray(buying.pools) ? sub(`Only in the ${buying.pools.length} market ${buying.pools.length === 1 ? "pool" : "pools"} the owner approved, at the owner's worst price or better.`) : null,
              registry ? sub(`The registry's latest usable edition: ${registry.day}, ${Number(registry.tokens).toLocaleString("en-US")} tokens.`) : null,
            ]
          : "Off.",
      );
    }
    if ("passkey" in status) {
      add(
        "The owner's fingerprint",
        status.passkey
          ? [`Set up for ${status.passkey.rp_id}. It can stop money at any time, and approve a payment to someone already paid, within the limits. Everything else needs the owner's wallet.`]
          : "None, and the vault works without one. The owner can add one on their phone; adding it waits like any change that loosens the rules.",
      );
    }
    add(
      "Changes waiting",
      pending.length
        ? pending.map(([id, change]) => el("span", { class: "sub" }, `#${id}: ${changeName(change.change)}, proposed by ${change.proposed_by}, can run from ${when(Number(change.ready_at_ms))}`))
        : "None",
    );
    $("rules").replaceChildren(...rows);
    $("rules-block").hidden = false;
  }

  /* ----------------------------------- CSV ----------------------------------- */

  function csvCell(value) {
    let text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function downloadCsv(event) {
    event.preventDefault();
    const header = ["time_utc", "transaction", "signer", "method", "event", "payee", "token", "amount_atomic", "reasons", "held_id", "service", "item", "agent_key", "data"];
    const lines = [header.join(",")];
    for (const tx of vaultTxs()) {
      for (const { event: name, data } of tx.events) {
        lines.push(
          [
            new Date(tx.at).toISOString(),
            tx.hash,
            tx.signer,
            tx.method,
            name,
            data.payee,
            data.token,
            data.amount,
            (data.reasons ?? []).join(" "),
            data.held_id ?? (HELD_EVENTS.has(name) ? data.id : null),
            data.purchase?.service ?? data.service,
            data.purchase?.item,
            data.agent,
            data,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    const url = URL.createObjectURL(new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/csv" }));
    const link = el("a", { href: url, download: `${state.vault}-events.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* --------------------------------- loading --------------------------------- */

  async function refresh(run) {
    const vault = state.vault;
    try {
      const status = await view(vault, "status");
      if (run !== state.run) return;
      state.status = status;
      if (!state.token) state.token = await tokenInfo(status.token);
      const [held, pending, services, keys, balance, registry, cleared, onSolana] = await Promise.all([
        view(vault, "held_payments").catch(() => []),
        view(vault, "pending_changes").catch(() => []),
        "services" in status ? view(vault, "services", {}).catch(() => []) : [],
        accessKeys(vault).catch(() => []),
        view(status.token, "ft_balance_of", { account_id: vault }).catch(() => null),
        status.buying?.registry ? view(status.buying.registry, "latest_usable").catch(() => null) : null,
        "cleared" in status ? view(vault, "cleared_payments").catch(() => []) : [],
        status.solana ? solanaBalance(status).catch(() => null) : null,
      ]);
      // Checked until it passes: a trusted build with no full-access key cannot change.
      if (state.genuine !== true) state.genuine = await isGenuine(vault).catch(() => null);
      await readHistory(vault, status.token);
      if (run !== state.run) return;
      state.balance = balance;
      state.solanaBalance = onSolana;
      state.pending = pending;
      state.cleared = cleared;
      if (deviceIsRegistered(status)) {
        const payees = [...new Set(held.map(([, payment]) => payment.payee))];
        const answers = await Promise.all(payees.map((payee) => view(vault, "payee", { payee }).catch(() => null)));
        state.knownPayees = new Set(payees.filter((_, index) => answers[index]));
      }
      const { rows, totals } = decisions();
      renderSummary(totals, held);
      state.held = held;
      renderHeld(held, status);
      renderWallet();
      renderDecisions(rows);
      renderTerms(services);
      renderRules(status, keys, pending, registry);
      $("updated").textContent = `Read from NEAR at ${clock(Date.now())}. It reads again every ${REFRESH_MS / 1000} seconds.`;
    } catch (error) {
      if (run !== state.run) return;
      if (!state.status) {
        const text = String(error.message);
        const why = /CodeDoesNotExist/.test(text)
          ? "it has no contract"
          : /MethodNotFound|MethodResolveError/.test(text)
            ? "its contract is not a Svalin Guard vault"
            : /UNKNOWN_ACCOUNT|does not exist/i.test(text)
              ? "there is no such account"
              : `NEAR said: ${text.slice(0, 160)}`;
        $("summary").textContent = `${vault} could not be read as a Svalin Guard vault: ${why}. Check the name and the network.`;
      } else {
        $("updated").textContent = `The last read failed (${error.message}); it tries again in ${REFRESH_MS / 1000} seconds.`;
      }
    }
  }

  function show(vault) {
    state.run += 1;
    const run = state.run;
    state.vault = vault;
    state.net = vault.endsWith(".testnet") ? NETWORKS.testnet : NETWORKS.mainnet;
    state.token = null;
    state.status = null;
    state.genuine = null;
    state.balance = null;
    state.solanaBalance = null;
    state.pending = [];
    state.cleared = [];
    state.device = null;
    state.knownPayees = new Set();
    state.txs = new Map();
    wallet.forms = {};
    deviceGet(vault)
      .then((record) => {
        if (run === state.run) state.device = record ?? null;
      })
      .catch(() => {});
    document.title = `${vault}: Svalin Guard`;
    $("network").textContent = `A Svalin Guard vault on ${state.net.label}`;
    $("title").textContent = vault;
    $("summary").textContent = "Reading the vault from NEAR…";
    $("updated").textContent = "";
    for (const id of ["numbers", "owner-block", "change-block", "held-block", "decisions-block", "terms-block", "rules-block"]) $(id).hidden = true;
    clearInterval(state.timer);
    refresh(run);
    state.timer = setInterval(() => refresh(run), REFRESH_MS);
  }

  /** The page without a vault: the start, or the form that creates one. */
  function showWithoutVault(block) {
    $("pick").hidden = true;
    $("vault-intro").hidden = true;
    $(block).hidden = false;
  }

  async function showCreate() {
    document.title = "Create a vault: Svalin Guard";
    showWithoutVault("create-block");
    create.active = true;
    renderCreate();
    loadSettings().catch(() => {});
    const record = await deviceGet(SETUP_RECORD).catch(() => null);
    if (!record) return;
    // A record from before setup accounts was never paid for: the wallet refused that request.
    if (!record.setup) return forgetSetup();
    create.record = record;
    create.onChain = await paidFor(record).catch(() => true);
    if (!create.onChain && Date.now() - (record.startedAt ?? 0) > SETUP_MAX_AGE_MS) {
      await forgetSetup();
      renderCreate();
      return;
    }
    // The wallet was asked to pay for this account, for instance on a phone that left the page to
    // approve. Go on from where it stopped: this waits for the account if it is still on its way,
    // and if it fails, the buttons to try again show.
    runSetup(() => finishSetup(record));
  }

  function showStart() {
    document.title = "Your vaults: Svalin Guard";
    showWithoutVault("start-block");
    mine.active = true;
    renderMine();
    $("open").addEventListener("submit", (event) => {
      event.preventDefault();
      const vault = $("open-name").value.trim().toLowerCase();
      if (!ACCOUNT.test(vault)) {
        $("open-error").textContent = "That is not a NEAR account name.";
        return;
      }
      location.search = `?vault=${vault}`;
    });
    deviceGet(SETUP_RECORD)
      .then((record) => {
        if (record?.setup) $("open-unfinished").hidden = false;
      })
      .catch(() => {});
  }

  function start() {
    const params = new URLSearchParams(location.search);
    const asked = params.get("vault")?.trim().toLowerCase();
    if (asked && ACCOUNT.test(asked)) show(asked);
    else if (params.has("create")) showCreate();
    else showStart();
    $("csv").addEventListener("click", downloadCsv);
    renderWallet();
    let connectedBefore = false;
    try {
      connectedBefore = localStorage.getItem(WALLET_FLAG) === "1";
    } catch {
      connectedBefore = false;
    }
    if (connectedBefore) connectWallet({ quiet: true });
  }

  start();
})();
