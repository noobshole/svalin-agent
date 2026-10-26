import type { SvalinClient } from "./client.js";
import {
  CHECKABLE_NETWORKS,
  PayeeMemory,
  amountUsd,
  judgePayment,
  readPaymentRequest,
  serviceOf,
  verdictOf,
  type GuardReason,
  type GuardVerdict,
  type PaymentOption,
} from "./payment-guard.js";
import { atomicToUsd } from "./budget.js";

export type CheckPaymentInput = {
  url: string;
  method?: "GET" | "POST";
  expectedUsd?: number;
  maxUsd?: number;
  payer?: string;
};

type OptionResult = { network: string; payTo: string; asset: string; price: string; verdict: GuardVerdict; reasons: GuardReason[] };

export type CheckPaymentResult = {
  url: string;
  service: string;
  verdict: GuardVerdict;
  options: OptionResult[];
  reasons: GuardReason[];
  note: string;
};

const NOTE = "Svalin only read this request. Nothing was paid or signed. Svalin's verdict is advice: the wallet that pays decides.";
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Asks the URL for its price without paying, then judges every way it offers to be paid: the
 * guard's local rules, and Svalin's recipient check of the payee where it can read the chain.
 */
export async function checkX402Payment(client: SvalinClient, memory: PayeeMemory, input: CheckPaymentInput): Promise<CheckPaymentResult> {
  const service = serviceOf(input.url);
  const result = (verdict: GuardVerdict, reasons: GuardReason[], options: OptionResult[] = []): CheckPaymentResult => ({
    url: input.url,
    service,
    verdict,
    options,
    reasons,
    note: NOTE,
  });

  let response: Response;
  try {
    // Never the paying fetch, and no redirects: the guard asks, it does not follow or pay.
    response = await client.probe(input.url, {
      method: input.method ?? "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result("caution", [{ code: "unreachable", severity: "caution", message: `The service did not answer: ${message}` }]);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "an unknown address";
    return result("caution", [
      { code: "redirect", severity: "caution", message: `The URL redirects to ${location}. Check that URL instead; a payment request behind a redirect can name anyone.` },
    ]);
  }
  const request = await readPaymentRequest(response).catch(() => null);
  if (!request) {
    return response.status === 402
      ? result("caution", [{ code: "unreadable", severity: "caution", message: "The service answered 402 but its payment request could not be read." }])
      : result("allow", [{ code: "no-payment-asked", severity: "info", message: `The URL answered HTTP ${response.status} and asked for no payment.` }]);
  }
  if (request.options.length === 0) {
    return result("caution", [{ code: "unreadable", severity: "caution", message: "The payment request offers no way to pay that Svalin can read." }]);
  }

  const options: OptionResult[] = [];
  for (const option of request.options) {
    const reasons = judgePayment({
      requestedUrl: input.url,
      request,
      option,
      pin: memory.get(service, option.network),
      expectedUsd: input.expectedUsd,
      maxUsd: input.maxUsd,
      memoryFile: memory.file,
    });
    reasons.push(...(await payeeReasons(client, option, input.payer)));
    const verdict = verdictOf(reasons);
    // First sight: remember the payee and price, unless the request already looks wrong.
    if (verdict !== "block") memory.remember(service, option);
    const usd = amountUsd(option);
    options.push({
      network: option.network,
      payTo: option.payTo,
      asset: option.asset,
      price: usd === null ? `${option.amount} units` : atomicToUsd(option.amount),
      verdict,
      reasons,
    });
  }

  const worst = options.some((entry) => entry.verdict === "block") ? "block" : options.some((entry) => entry.verdict === "caution") ? "caution" : "allow";
  return result(worst, [], options);
}

/** Svalin's recipient check of the payee, paid per call when this server has a wallet. */
async function payeeReasons(client: SvalinClient, option: PaymentOption, payerInput?: string): Promise<GuardReason[]> {
  const family = CHECKABLE_NETWORKS[option.network];
  if (!family) {
    return [
      {
        code: "payee-not-checked",
        severity: "info",
        message: `Svalin reads payees on Solana and NEAR mainnet; this one is on ${option.network}, so only the rules above apply.`,
      },
    ];
  }
  const payerFamily = payerInput ? (SOLANA_ADDRESS.test(payerInput) && /[A-Z]/.test(payerInput) ? "solana" : "near") : null;
  const payer = payerInput && payerFamily === family ? payerInput : client.payers[family];
  const query = new URLSearchParams();
  if (payer) query.set("payer", payer);
  const usd = amountUsd(option);
  if (usd !== null) query.set("amountUsd", String(usd));
  const route = client.canPay ? "/v1/check/" : "/v1/demo/check/";
  const url = `${client.apiUrl.replace(/\/+$/, "")}${route}${encodeURIComponent(option.payTo)}${query.size ? `?${query}` : ""}`;

  try {
    const response = await client.fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return [{ code: "payee-check-failed", severity: "caution", message: `Svalin could not check the payee (HTTP ${response.status}), so it is unverified.` }];
    }
    const check = (await response.json()) as { verdict?: string; reasons?: GuardReason[] };
    return (check.reasons ?? []).map((reason) => ({
      code: `payee-${reason.code}`,
      severity: reason.severity,
      message: `Payee: ${reason.message}`,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ code: "payee-check-failed", severity: "caution", message: `Svalin could not check the payee (${message}), so it is unverified.` }];
  }
}
