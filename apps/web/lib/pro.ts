import {
  apiErrorSchema,
  isProCode,
  keyStatusSchema,
  nearCheckoutSchema,
  proActivationSchema,
  proOfferSchema,
  type KeyStatus,
  type NearCheckout,
  type ProActivation,
  type ProOffer,
  type ProPlan,
} from "@svalin-agent/shared";

import { API_BASE_URL } from "@/lib/api";

/**
 * Svalin Pro in the browser. The Pro code is made here and kept here: it is the pass, sent to the
 * Svalin API only, as `Authorization: Bearer`. Storage can be missing (private windows), so every
 * read and write is guarded.
 */
const CODE_KEY = "svalin-pro-code";
const STATUS_KEY = "svalin-pro-status";

export function storedProCode(): string | null {
  try {
    const code = localStorage.getItem(CODE_KEY);
    return code && isProCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function storeProCode(code: string) {
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    // The page still works for this visit; the visitor is told to copy the code.
  }
}

export function forgetPro() {
  try {
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem(STATUS_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The code's last known standing, so pages can show Pro without asking the API first. */
export function storedProStatus(): KeyStatus | null {
  try {
    const parsed = keyStatusSchema.safeParse(JSON.parse(localStorage.getItem(STATUS_KEY) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeProStatus(status: KeyStatus | null) {
  try {
    if (status) localStorage.setItem(STATUS_KEY, JSON.stringify(status));
    else localStorage.removeItem(STATUS_KEY);
  } catch {
    // Not kept; the next activation asks the API again.
  }
}

/** Whether a pass is still running, by its last known standing. */
export function isRunning(status: KeyStatus | null, now = Date.now()): boolean {
  return Boolean(status?.active && status.until && Date.parse(status.until) > now);
}

/** The Pro code to send with a scan, if this browser has one that is still running. */
export function activeProCode(now = Date.now()): string | null {
  const code = storedProCode();
  return code && isRunning(storedProStatus(), now) ? code : null;
}

/** Days until the pass ends (negative once it has), or null without a pass. */
export function proDaysLeft(status: KeyStatus | null, now = Date.now()): number | null {
  if (!status?.until) return null;
  return Math.ceil((Date.parse(status.until) - now) / 86_400_000);
}

type Failure = { ok: false; status: number; code?: string; message: string };

async function failure(response: Response): Promise<Failure> {
  const error = apiErrorSchema.safeParse(await response.json().catch(() => null));
  return {
    ok: false,
    status: response.status,
    code: error.success ? error.data.code : undefined,
    message: error.success ? error.data.error : `The Svalin API returned ${response.status}.`,
  };
}

const unreachable: Failure = { ok: false, status: 503, message: "The Svalin API is unreachable right now. Try again in a minute." };

export async function getProOffer(signal?: AbortSignal): Promise<ProOffer | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/pro`, { signal });
    return response.ok ? proOfferSchema.parse(await response.json()) : null;
  } catch {
    return null;
  }
}

/** Looks for the code's payments on-chain. */
export async function activatePro(code: string): Promise<{ ok: true; activation: ProActivation } | Failure> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/pro/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return failure(response);
    return { ok: true, activation: proActivationSchema.parse(await response.json()) };
  } catch {
    return unreachable;
  }
}

/** The exact USDC amount to send on NEAR for this code and plan. */
export async function reserveNearAmount(code: string, plan: ProPlan): Promise<{ ok: true; checkout: NearCheckout } | Failure> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/pro/near`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, plan }),
    });
    if (!response.ok) return failure(response);
    return { ok: true, checkout: nearCheckoutSchema.parse(await response.json()) };
  } catch {
    return unreachable;
  }
}

/**
 * A Solana Pay transfer request. The wallet app reads it from the QR code and shows the payment
 * for the buyer to approve; the reference rides along so the API can find the payment.
 */
export function solanaPayUrl(offer: NonNullable<ProOffer["solana"]>, usd: number, reference: string, message: string): string {
  const query = [
    ["amount", String(usd)],
    ["spl-token", offer.mint],
    ["reference", reference],
    ["label", "Svalin"],
    ["message", message],
  ]
    .map(([name, value]) => `${name}=${encodeURIComponent(value!)}`)
    .join("&");
  return `solana:${offer.payTo}?${query}`;
}
