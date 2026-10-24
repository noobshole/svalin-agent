import {
  FEW_TRANSACTIONS,
  FIRST_PAYMENT_CAUTION_USD,
  NEW_RECIPIENT_DAYS,
  RECIPIENT_CHECK_VERSION,
  recipientCheckSchema,
  type CheckReason,
  type RecipientCheck,
  type RecipientKind,
  type SupportedChainKey,
} from "@svalin-agent/shared";

/**
 * Svalin's recipient check: "is it safe to send money here?". Like the risk engine it is
 * deterministic and does no I/O: data sources gather the signals, this judges them. See the
 * recipient check section of docs/RISK_METHODOLOGY.md.
 */

/** What a data source observed about a recipient, and about the payer's recent history. */
export type RecipientSignals = {
  chain: SupportedChainKey;
  recipient: string;
  payer: string | null;
  kind: RecipientKind;
  /** First activity in ms, or null when unknown. */
  createdAt: number | null;
  transactions: number | null;
  /** True when `transactions` is a cap that was reached, so the real count is at least that. */
  transactionsAtLeast: boolean;
  /** Addresses the payer recently sent to, and that recently sent to the payer; null if not read. */
  payerSentTo: string[] | null;
  payerReceivedFrom: string[] | null;
  dataSource: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two long addresses that share their first and last four characters but differ: what address
 * poisoning relies on, since wallets and people check only the ends. Named NEAR accounts are
 * read as words, so the rule applies only to addresses of 32 characters or more.
 */
export function looksAlike(left: string, right: string): boolean {
  if (left === right || left.length < 32 || right.length < 32) return false;
  return left.slice(0, 4) === right.slice(0, 4) && left.slice(-4) === right.slice(-4);
}

const KIND_REASONS: Partial<Record<RecipientKind, CheckReason>> = {
  token: { code: "token-address", severity: "block", message: "This is a token contract, not a wallet. Money sent here is usually lost." },
  program: { code: "program-address", severity: "block", message: "This is a program, not a wallet. Money sent here is usually lost." },
  "token-account": {
    code: "token-account",
    severity: "block",
    message: "This is a token account that holds one token for a wallet. Pay the wallet that owns it instead.",
  },
  missing: { code: "missing-account", severity: "block", message: "This NEAR account does not exist, so a payment to it would fail." },
  unused: {
    code: "unused-address",
    severity: "caution",
    message: "This address has never been used. Check that it came from the person you mean to pay.",
  },
  contract: {
    code: "contract-account",
    severity: "caution",
    message: "This account runs a contract, such as a DAO or an app. Make sure it is meant to receive this payment.",
  },
};

export type AssessOptions = {
  /** The payer's history was deliberately not read (the free demo), rather than unreadable. */
  payerHistorySkipped?: boolean;
};

export function assessRecipient(
  signals: RecipientSignals,
  amountUsd: number | null,
  now: Date = new Date(),
  options: AssessOptions = {},
): RecipientCheck {
  const reasons: CheckReason[] = [];
  const kindReason = KIND_REASONS[signals.kind];
  if (kindReason) reasons.push(kindReason);

  const lookalikeOf = signals.payerSentTo?.find((known) => looksAlike(signals.recipient, known)) ?? null;
  const sentToPayer = signals.payerReceivedFrom === null ? null : signals.payerReceivedFrom.includes(signals.recipient);
  const paidBefore = signals.payerSentTo === null ? null : signals.payerSentTo.includes(signals.recipient);
  if (lookalikeOf) {
    reasons.push({
      code: "lookalike",
      severity: "block",
      message:
        `This address imitates ${lookalikeOf}, which this wallet paid recently: same first and last characters, different address. ` +
        `That is how address poisoning steals payments.${sentToPayer ? " It also sent this wallet a transfer first, the usual bait." : ""}`,
    });
  }

  const ageDays = signals.createdAt === null ? null : Math.max(0, (now.getTime() - signals.createdAt) / DAY_MS);
  const canHoldFunds = signals.kind === "wallet" || signals.kind === "contract";
  if (canHoldFunds) {
    if (signals.createdAt === null && signals.transactions === null) {
      reasons.push({
        code: "history-unavailable",
        severity: "caution",
        message: "Svalin could not read this address's history, so its age and activity are unknown.",
      });
    }
    if (ageDays !== null && ageDays < NEW_RECIPIENT_DAYS) {
      const age = ageDays < 1 ? "less than a day" : `${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"}`;
      reasons.push({
        code: "new-recipient",
        severity: "caution",
        message: `This address is ${age} old. Payments demanded by brand-new wallets are a common scam.`,
      });
    }
    if (signals.transactions !== null && !signals.transactionsAtLeast && signals.transactions < FEW_TRANSACTIONS) {
      reasons.push({
        code: "few-transactions",
        severity: "caution",
        message: `This address has only ${signals.transactions} transaction${signals.transactions === 1 ? "" : "s"}.`,
      });
    }
  }

  if (signals.payer !== null && signals.payerSentTo === null) {
    reasons.push(
      options.payerHistorySkipped
        ? {
            code: "payer-history-skipped",
            severity: "info",
            message:
              "The free demo does not read the paying wallet's history, so it does not look for addresses imitating ones this wallet paid. The paid check (/v1/check) does.",
          }
        : {
            code: "payer-history-unavailable",
            severity: "caution",
            message: "Svalin could not read the paying wallet's recent payments, so it cannot rule out an address imitating one of them.",
          },
    );
  }

  if (paidBefore) {
    reasons.push({ code: "paid-before", severity: "info", message: "This wallet has paid this exact address recently." });
  } else if (paidBefore === false && canHoldFunds && amountUsd !== null && amountUsd >= FIRST_PAYMENT_CAUTION_USD) {
    reasons.push({
      code: "first-payment",
      severity: "caution",
      message: `This would be the first recent payment to this address, for $${Math.round(amountUsd).toLocaleString("en-US")}. Confirm the address through a second channel.`,
    });
  }

  const blocked = reasons.some((reason) => reason.severity === "block");
  const cautioned = reasons.some((reason) => reason.severity === "caution");
  if (!blocked && !cautioned) {
    const age = ageDays === null ? "" : `${Math.floor(ageDays).toLocaleString("en-US")} days old`;
    const activity =
      signals.transactions === null
        ? ""
        : `${signals.transactionsAtLeast ? "at least " : ""}${signals.transactions.toLocaleString("en-US")} transactions`;
    const facts = [age, activity].filter(Boolean).join(", ");
    reasons.push({ code: "established", severity: "info", message: `An established address${facts ? `: ${facts}` : ""}.` });
  }

  return recipientCheckSchema.parse({
    recipient: signals.recipient,
    chain: signals.chain,
    payer: signals.payer,
    amountUsd,
    verdict: blocked ? "block" : cautioned ? "caution" : "allow",
    kind: signals.kind,
    signals: {
      createdAt: signals.createdAt === null ? null : new Date(signals.createdAt).toISOString(),
      ageDays: ageDays === null ? null : Math.round(ageDays * 10) / 10,
      transactions: signals.transactions,
      transactionsAtLeast: signals.transactionsAtLeast,
      paidBefore,
      lookalikeOf,
      sentToPayer,
    },
    reasons,
    dataSource: signals.dataSource,
    methodologyVersion: RECIPIENT_CHECK_VERSION,
    checkedAt: now.toISOString(),
  });
}
