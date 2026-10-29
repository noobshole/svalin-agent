import { z } from "zod";

import { supportedChainKeySchema, walletAddressSchema } from "./address.js";

/**
 * The recipient check answers a different question from the risk report: not "how is this wallet
 * spread?" but "is it safe to send money here?". Version it separately from the risk methodology.
 */
export const RECIPIENT_CHECK_VERSION = "2026-10.3";

/** Below this age (days) or activity (transactions), a recipient is new enough to be a throwaway. */
export const NEW_RECIPIENT_DAYS = 7;
export const FEW_TRANSACTIONS = 5;
/** A first payment to a recipient this large (USD) is worth a second look. */
export const FIRST_PAYMENT_CAUTION_USD = 100;

export const recipientKindSchema = z.enum([
  "wallet",
  /** A NEAR account with a contract deployed: often a DAO or app, sometimes not meant to hold funds. */
  "contract",
  "token",
  "program",
  "token-account",
  /** Valid but never used: a Solana address with no account, or a NEAR implicit account not yet funded. */
  "unused",
  /** A NEAR named account that does not exist: a transfer to it fails. */
  "missing",
]);

export const checkVerdictSchema = z.enum(["allow", "caution", "block"]);

export const checkReasonSchema = z.object({
  code: z.enum([
    "lookalike",
    /** A NEAR name one letter away from one the payer paid recently. */
    "similar-name",
    /** A NEAR name made to look like a well-known account (NEAR_WELL_KNOWN_ACCOUNTS); no history needed. */
    "imitates-known",
    /** A NEAR name one letter away from a well-known account. */
    "similar-to-known",
    "token-address",
    "program-address",
    "token-account",
    "missing-account",
    "unused-address",
    "contract-account",
    "new-recipient",
    "few-transactions",
    "first-payment",
    "history-unavailable",
    "payer-history-unavailable",
    /** The free demo does not read the payer's history; the paid check does. */
    "payer-history-skipped",
    "paid-before",
    "established",
  ]),
  severity: z.enum(["block", "caution", "info"]),
  message: z.string().min(1),
});

export const recipientCheckSchema = z.object({
  recipient: walletAddressSchema,
  chain: supportedChainKeySchema,
  /** The wallet about to pay, when given: it enables the look-alike and first-payment checks. */
  payer: walletAddressSchema.nullable(),
  amountUsd: z.number().nonnegative().nullable(),
  verdict: checkVerdictSchema,
  kind: recipientKindSchema,
  signals: z.object({
    createdAt: z.string().datetime().nullable(),
    ageDays: z.number().nonnegative().nullable(),
    /** Transactions seen; a lower bound when `transactionsAtLeast` is true. */
    transactions: z.number().int().nonnegative().nullable(),
    transactionsAtLeast: z.boolean(),
    /** Whether the payer sent to this recipient in its recent history (null without a payer). */
    paidBefore: z.boolean().nullable(),
    /**
     * A past recipient of the payer, or a well-known NEAR account, that this address imitates: same
     * first and last 4 characters, or, for a NEAR name, the same name once look-alike characters and
     * separators are folded.
     */
    lookalikeOf: z.string().nullable(),
    /** A past recipient, or a well-known NEAR account, whose NEAR name is one letter away from this one. */
    similarTo: z.string().nullable().optional(),
    /** Whether this recipient sent the payer something first, the usual address-poisoning move. */
    sentToPayer: z.boolean().nullable(),
  }),
  reasons: z.array(checkReasonSchema),
  dataSource: z.string(),
  methodologyVersion: z.string(),
  checkedAt: z.string().datetime(),
});

export type RecipientKind = z.infer<typeof recipientKindSchema>;
export type CheckVerdict = z.infer<typeof checkVerdictSchema>;
export type CheckReason = z.infer<typeof checkReasonSchema>;
export type RecipientCheck = z.infer<typeof recipientCheckSchema>;
