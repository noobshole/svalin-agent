/**
 * Svalin keys and Pro codes. Each is stored under the SHA-256 of its secret (keyId), so the
 * secret itself is never stored or logged. A pass runs on its payments: each one adds its days,
 * starting where the previous one ends, and only payments on the networks Svalin takes now count,
 * so a pass paid with test USDC stops working once that chain takes real USDC.
 */
import type { KeyPlan, KeyStatus, ProPlan } from "@svalin-agent/shared";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** How long an exact NEAR amount stays reserved for its code, and is matched to a payment. */
export const NEAR_RESERVATION_MS = 2 * DAY;
/**
 * An amount is not handed to another code until two days after its reservation ends, so a late
 * payment is never credited to someone else. With at most NEAR_RESERVATIONS_PER_DAY new amounts a
 * day, no more than 4,000 of a price's 9,999 amounts are ever held, so they cannot run out.
 */
const NEAR_SLOT_HOLD_MS = 4 * DAY;
export const NEAR_RESERVATIONS_PER_DAY = 1000;
/** Unique NEAR amounts add 0.000001 to 0.009999 USDC to the price. */
const NEAR_SUFFIXES = 9999;

export type PassPayment = {
  /** The transaction that paid: a Solana signature or NEAR hash, or "x402" for a key bought over x402. */
  tx: string;
  /** CAIP-2 network it was paid on. */
  network: string;
  /** USDC in atomic units (6 decimals), as a decimal string. */
  atomic: string;
  /** When it was paid (ms since the epoch). */
  at: number;
  days: number;
};

export type PassRecord = {
  /** "pro": calls a day. "key" (Business): a block of calls for the paid period. */
  kind: "pro" | "key";
  plan: KeyPlan;
  payments: PassPayment[];
  /** Business keys: calls bought, every renewal adding its block. */
  calls?: number;
  /** Calls used: on the UTC day starting at usedSince (Pro), or over the key's life (Business). */
  used: number;
  usedSince: number;
};

export type NearReservation = { plan: ProPlan; network: string; atomic: string; createdAt: number; expiresAt: number };

/** What the store cannot know by itself: where Svalin takes payments now, and Pro's fair use. */
export type PassRules = { networks: string[]; proCallsPerDay: number };

export type UseResult =
  | { ok: true; callsLeft: number; callsPer: "day" | "period" }
  | { ok: false; reason: "unknown" | "expired" | "used_up" | "daily_limit"; until: number | null };

/** The parts of Durable Object storage the store uses; tests and the Node server use a Map. */
export type KvStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
};

export interface KeyStore {
  /** Counts one paid-route call against the pass, if it has one left. */
  use(id: string, now: number, rules: PassRules): Promise<UseResult>;
  /** Gives back a call whose request failed: failed calls are never counted. */
  refund(id: string, now: number): Promise<void>;
  status(id: string, now: number, rules: PassRules): Promise<KeyStatus | null>;
  /** Stores a new pass; false if the id is taken. */
  issue(id: string, record: PassRecord): Promise<boolean>;
  /** Renews a pass of this plan with one more payment, and for Business its calls; false if there is none. */
  extend(id: string, plan: KeyPlan, payment: PassPayment, calls?: number): Promise<boolean>;
  /** Adds payments to a Pro code; returns how many were new. A transaction counts for one code only. */
  claim(id: string, payments: PassPayment[]): Promise<number>;
  /** Reserves an exact NEAR amount for a Pro code (the same one again while it lasts). */
  reserveNear(id: string, plan: ProPlan, network: string, priceAtomic: string, now: number): Promise<NearReservation | null>;
  /** The code's NEAR amounts still waiting for a payment. */
  pending(id: string, now: number): Promise<NearReservation[]>;
  /**
   * Credits NEAR payments to the codes their exact amounts were reserved for, whoever is asking;
   * returns the id credited for each payment that was new.
   */
  claimNear(payments: Omit<PassPayment, "days">[], planDays: Record<ProPlan, number>): Promise<string[]>;
  /**
   * In-memory throttle, per bucket (chain lookups, NEAR amounts): false when this caller is over its
   * hourly allowance or everyone together is over the bucket's daily one.
   */
  throttle(bucket: string, caller: string, now: number, perHour: number, perDayGlobal: number): Promise<boolean>;
}

/** When the pass stops working: its payments on the given networks, each starting where the last ends. */
export function passUntil(payments: PassPayment[], networks: string[]): number | null {
  let end: number | null = null;
  const counted = payments.filter((payment) => networks.includes(payment.network)).sort((a, b) => a.at - b.at);
  for (const payment of counted) end = Math.max(end ?? 0, payment.at) + payment.days * DAY;
  return end;
}

export function passStatus(record: PassRecord, now: number, rules: PassRules): KeyStatus {
  const until = passUntil(record.payments, rules.networks);
  const active = until !== null && now < until;
  const base = { active, until: until === null ? null : new Date(until).toISOString() };
  if (record.kind === "pro") {
    const used = record.usedSince === dayStart(now) ? record.used : 0;
    return { kind: "pro", plan: "pro", ...base, callsLeft: Math.max(0, rules.proCallsPerDay - used), callsPer: "day" };
  }
  return { kind: "key", plan: record.plan, ...base, callsLeft: Math.max(0, (record.calls ?? 0) - record.used), callsPer: "period" };
}

function dayStart(now: number) {
  return Math.floor(now / DAY) * DAY;
}

const passKey = (id: string) => `pass:${id}`;
const claimKey = (network: string, tx: string) => `tx:${network}:${tx}`;
const pendingKey = (id: string) => `near-pending:${id}`;
const slotKey = (network: string, atomic: string) => `near-amount:${network}:${atomic}`;

type Slot = { id: string; heldUntil: number };

/** The store's rules over any key-value storage: a Durable Object's, or a Map in tests. */
export class KeyStoreCore implements KeyStore {
  private readonly callers = new Map<string, number>();
  private callersHour = 0;
  private readonly everyone = new Map<string, { day: number; count: number }>();

  constructor(
    private readonly storage: KvStorage,
    private readonly random: (below: number) => number = (below) => crypto.getRandomValues(new Uint32Array(1))[0]! % below,
  ) {}

  async use(id: string, now: number, rules: PassRules): Promise<UseResult> {
    const record = await this.storage.get<PassRecord>(passKey(id));
    if (!record) return { ok: false, reason: "unknown", until: null };
    const until = passUntil(record.payments, rules.networks);
    if (until === null || now >= until) return { ok: false, reason: "expired", until };
    if (record.kind === "pro") {
      const today = dayStart(now);
      const used = record.usedSince === today ? record.used : 0;
      if (used >= rules.proCallsPerDay) return { ok: false, reason: "daily_limit", until };
      await this.storage.put(passKey(id), { ...record, used: used + 1, usedSince: today });
      return { ok: true, callsLeft: rules.proCallsPerDay - used - 1, callsPer: "day" };
    }
    const calls = record.calls ?? 0;
    if (record.used >= calls) return { ok: false, reason: "used_up", until };
    await this.storage.put(passKey(id), { ...record, used: record.used + 1 });
    return { ok: true, callsLeft: calls - record.used - 1, callsPer: "period" };
  }

  async refund(id: string, now: number): Promise<void> {
    const record = await this.storage.get<PassRecord>(passKey(id));
    if (!record || record.used === 0) return;
    if (record.kind === "pro" && record.usedSince !== dayStart(now)) return;
    await this.storage.put(passKey(id), { ...record, used: record.used - 1 });
  }

  async status(id: string, now: number, rules: PassRules): Promise<KeyStatus | null> {
    const record = await this.storage.get<PassRecord>(passKey(id));
    return record ? passStatus(record, now, rules) : null;
  }

  async issue(id: string, record: PassRecord): Promise<boolean> {
    if (await this.storage.get(passKey(id))) return false;
    await this.storage.put(passKey(id), record);
    return true;
  }

  async extend(id: string, plan: KeyPlan, payment: PassPayment, calls?: number): Promise<boolean> {
    const record = await this.storage.get<PassRecord>(passKey(id));
    if (!record || record.plan !== plan) return false;
    await this.storage.put(passKey(id), {
      ...record,
      payments: [...record.payments, payment],
      ...(calls ? { calls: (record.calls ?? 0) + calls } : {}),
    });
    return true;
  }

  async claim(id: string, payments: PassPayment[]): Promise<number> {
    const record = (await this.storage.get<PassRecord>(passKey(id))) ?? { kind: "pro", plan: "pro", payments: [], used: 0, usedSince: 0 };
    if (record.kind !== "pro") return 0;
    let added = 0;
    for (const payment of payments) {
      if (record.payments.some((known) => known.network === payment.network && known.tx === payment.tx)) continue;
      // One transaction could carry two codes' references; only the first code to claim it gets it.
      const owner = await this.storage.get<string>(claimKey(payment.network, payment.tx));
      if (owner && owner !== id) continue;
      await this.storage.put(claimKey(payment.network, payment.tx), id);
      record.payments.push(payment);
      added += 1;
    }
    if (added > 0) await this.storage.put(passKey(id), record);
    return added;
  }

  async reserveNear(id: string, plan: ProPlan, network: string, priceAtomic: string, now: number): Promise<NearReservation | null> {
    const waiting = await this.pending(id, now);
    const existing = waiting.find((reservation) => reservation.plan === plan && reservation.network === network);
    if (existing) return existing;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const atomic = (BigInt(priceAtomic) + BigInt(1 + this.random(NEAR_SUFFIXES))).toString();
      const holder = await this.storage.get<Slot>(slotKey(network, atomic));
      if (holder && holder.heldUntil > now) continue;
      const reservation: NearReservation = { plan, network, atomic, createdAt: now, expiresAt: now + NEAR_RESERVATION_MS };
      await this.storage.put(slotKey(network, atomic), { id, heldUntil: now + NEAR_SLOT_HOLD_MS } satisfies Slot);
      await this.storage.put(pendingKey(id), [...waiting, reservation]);
      return reservation;
    }
    return null;
  }

  async pending(id: string, now: number): Promise<NearReservation[]> {
    const waiting = (await this.storage.get<NearReservation[]>(pendingKey(id))) ?? [];
    return waiting.filter((reservation) => reservation.expiresAt > now);
  }

  async claimNear(payments: Omit<PassPayment, "days">[], planDays: Record<ProPlan, number>): Promise<string[]> {
    const credited: string[] = [];
    for (const payment of payments) {
      const slot = await this.storage.get<Slot>(slotKey(payment.network, payment.atomic));
      if (!slot) continue;
      const waiting = (await this.storage.get<NearReservation[]>(pendingKey(slot.id))) ?? [];
      const reservation = waiting.find((entry) => entry.network === payment.network && entry.atomic === payment.atomic);
      // Paid while the amount was reserved for this code, and not before it was handed out.
      if (!reservation || payment.at < reservation.createdAt || payment.at > reservation.expiresAt) continue;
      if ((await this.claim(slot.id, [{ ...payment, days: planDays[reservation.plan] }])) === 0) continue;
      await this.storage.put(
        pendingKey(slot.id),
        waiting.filter((entry) => entry !== reservation),
      );
      credited.push(slot.id);
    }
    return credited;
  }

  async throttle(bucket: string, caller: string, now: number, perHour: number, perDayGlobal: number): Promise<boolean> {
    const hour = Math.floor(now / HOUR);
    if (hour !== this.callersHour) {
      this.callers.clear();
      this.callersHour = hour;
    }
    const day = dayStart(now);
    const total = this.everyone.get(bucket)?.day === day ? this.everyone.get(bucket)! : { day, count: 0 };
    const key = `${bucket}:${caller}`;
    const count = this.callers.get(key) ?? 0;
    if (count >= perHour || total.count >= perDayGlobal) return false;
    this.callers.set(key, count + 1);
    this.everyone.set(bucket, { day, count: total.count + 1 });
    return true;
  }
}

/** Map-backed storage for the Node server and tests. */
export class MemoryStorage implements KvStorage {
  private readonly entries = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.entries.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key);
  }
}

/** The id a secret is stored under: its SHA-256, so storage never holds the secret. */
export async function keyId(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`svalin-key:${secret}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
