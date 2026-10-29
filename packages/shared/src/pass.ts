import { z } from "zod";

/**
 * Svalin passes. One secret, sent as `Authorization: Bearer <key>`, skips the x402 payment on the
 * paid routes while it has calls left.
 * - A Svalin Pro code (`svp_`) gives 100 calls a day. People make it in the browser and pay by QR
 *   code or an exact NEAR amount; agents buy one over x402.
 * - A Svalin Business key (`svk_`) gives a block of calls for 30 days, bought over x402.
 */
export const PRO_CODE_PREFIX = "svp_";
export const AGENT_KEY_PREFIX = "svk_";
export const SVALIN_KEY_PATTERN = /^sv[pk]_[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index]! << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

/** A new Svalin Pro code or agent key: 32 random bytes from the platform's secure generator. */
export function newSvalinKey(prefix: typeof PRO_CODE_PREFIX | typeof AGENT_KEY_PREFIX): string {
  return prefix + base58Encode(crypto.getRandomValues(new Uint8Array(32)));
}

export function isProCode(value: string): boolean {
  return value.startsWith(PRO_CODE_PREFIX) && SVALIN_KEY_PATTERN.test(value);
}

/**
 * The Solana Pay reference for a Pro code. It goes on-chain with the payment, so the API can find
 * the payment from the code alone, and it is a hash: nobody can turn it back into the code and
 * claim the payment.
 */
export async function proReference(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`svalin-pro-reference:${code}`));
  return base58Encode(new Uint8Array(digest));
}

export const paymentEnvironmentSchema = z.enum(["mainnet", "testnet"]);
export const proPlanSchema = z.enum(["month", "year"]);
/** The passes sold over x402: Svalin Pro, and Svalin Business for heavy agent use. */
export const keyPlanSchema = z.enum(["pro", "business"]);

/** What Svalin Pro costs and where to pay for it: GET /v1/pro. */
export const proOfferSchema = z.object({
  plans: z.array(z.object({ id: proPlanSchema, usd: z.number().positive(), days: z.number().int().positive() })),
  /** Fair use: paid-route calls a Pro code may make each UTC day. */
  callsPerDay: z.number().int().positive(),
  /** Pay by scanning a Solana Pay QR code. Null when this instance takes no Solana payments. */
  solana: z
    .object({ network: z.string(), environment: paymentEnvironmentSchema, payTo: z.string(), mint: z.string() })
    .nullable(),
  /** Pay an exact amount from any NEAR wallet (POST /v1/pro/near). Null without NEAR payments. */
  near: z
    .object({ network: z.string(), environment: paymentEnvironmentSchema, payTo: z.string(), token: z.string() })
    .nullable(),
});

/** An exact USDC amount reserved for one Pro code: paying exactly this much is how the payment is matched. */
export const nearCheckoutSchema = z.object({
  plan: proPlanSchema,
  network: z.string(),
  payTo: z.string(),
  token: z.string(),
  /** Decimal USDC, e.g. "5.004217". */
  amount: z.string(),
  expiresAt: z.string(),
});

/** A Svalin key's or Pro code's standing. */
export const keyStatusSchema = z.object({
  kind: z.enum(["pro", "key"]),
  plan: keyPlanSchema,
  active: z.boolean(),
  /** When it stops working (ISO 8601), on the networks Svalin takes payments on now. */
  until: z.string().nullable(),
  /** Calls left: today for a Pro code, for its paid period for a Business key. */
  callsLeft: z.number().int().nonnegative(),
  callsPer: z.enum(["day", "period"]),
});

/** POST /v1/pro/activate: the code's standing once its payments are found, and NEAR amounts still awaited. */
export const proActivationSchema = z.object({
  status: keyStatusSchema.nullable(),
  /** Payments found and added by this call. */
  found: z.number().int().nonnegative(),
  pending: z.array(nearCheckoutSchema),
});

/** POST /v1/keys/{plan}, paid over x402: the new key (shown once), or the renewed one. */
export const keyPurchaseSchema = z.object({
  key: z.string(),
  status: keyStatusSchema,
  note: z.string(),
});

export type ProPlan = z.infer<typeof proPlanSchema>;
export type KeyPlan = z.infer<typeof keyPlanSchema>;
export type ProOffer = z.infer<typeof proOfferSchema>;
export type NearCheckout = z.infer<typeof nearCheckoutSchema>;
export type KeyStatus = z.infer<typeof keyStatusSchema>;
export type ProActivation = z.infer<typeof proActivationSchema>;
export type KeyPurchase = z.infer<typeof keyPurchaseSchema>;
