import {
  apiErrorSchema,
  recipientCheckSchema,
  riskReportSchema,
  serviceInfoSchema,
  type RecipientCheck,
  type RiskReport,
  type ServiceInfo,
  type TokenNotice,
} from "@svalin-agent/shared";

import { activeProCode, storeProStatus, storedProStatus } from "@/lib/pro";

/** The Svalin API this site talks to, fixed at build time. The browser calls it directly. */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/** Read at build time for the prices shown on the homepage. */
export async function getServiceInfo(): Promise<ServiceInfo | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/`);
    if (!response.ok) return null;
    return serviceInfoSchema.parse(await response.json());
  } catch {
    return null;
  }
}

/** A count from one of the API's headers: free calls left today, or a Pro code's calls left today. */
function headerCount(response: Response, name: "X-Free-Remaining" | "X-Calls-Left"): number | null {
  const value = response.headers.get(name);
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

/** What a scan or check used: one of today's free calls, or one of the Pro code's. */
export type Usage = { freeLeft: number | null; proLeft: number | null };

const usageOf = (response: Response): Usage => ({
  freeLeft: headerCount(response, "X-Free-Remaining"),
  proLeft: headerCount(response, "X-Calls-Left"),
});

export type DemoResult =
  | ({ ok: true; report: RiskReport } & Usage)
  | ({ ok: false; status: number; message: string; hint?: string; token?: TokenNotice } & Partial<Usage>);

/**
 * Runs in the browser, so the API applies the free limit to the visitor's own address. With a
 * running Pro code it asks the full route instead: every next step, and no daily limit of 5.
 */
export async function getDemoRisk(address: string, signal?: AbortSignal): Promise<DemoResult> {
  const path = encodeURIComponent(address);
  try {
    const response = await viaPro(`/v1/risk/${path}`, `/v1/demo/risk/${path}`, signal);
    const body = await response.json();
    if (response.ok) return { ok: true, report: riskReportSchema.parse(body), ...usageOf(response) };
    const error = apiErrorSchema.safeParse(body);
    return {
      ok: false,
      status: response.status,
      message: error.success ? error.data.error : `API returned ${response.status}.`,
      hint: error.success ? error.data.hint : undefined,
      token: error.success ? error.data.token : undefined,
      ...usageOf(response),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, status: 503, message: "The Svalin API is unreachable right now. Try again in a minute." };
  }
}

export type CheckResult =
  | ({ ok: true; check: RecipientCheck } & Usage)
  | ({ ok: false; status: number; message: string; hint?: string } & Partial<Usage>);

/**
 * The recipient check, from the browser so the free limit applies to the visitor. With Pro and
 * the visitor's own wallet, it also compares the address with that wallet's recent payments.
 */
export async function getDemoCheck(address: string, signal?: AbortSignal, payer?: string): Promise<CheckResult> {
  const path = encodeURIComponent(address);
  const query = payer ? `?payer=${encodeURIComponent(payer)}` : "";
  try {
    const response = await viaPro(`/v1/check/${path}${query}`, `/v1/demo/check/${path}`, signal);
    const body = await response.json();
    if (response.ok) return { ok: true, check: recipientCheckSchema.parse(body), ...usageOf(response) };
    const error = apiErrorSchema.safeParse(body);
    return {
      ok: false,
      status: response.status,
      message: error.success ? error.data.error : `API returned ${response.status}.`,
      hint: error.success ? error.data.hint : undefined,
      ...usageOf(response),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, status: 503, message: "The Svalin API is unreachable right now. Try again in a minute." };
  }
}

/**
 * The paid route with this browser's Pro code, or else the free route. A code that has ended
 * (401) is marked so, and one that has made today's calls (429) falls back to the free route.
 */
async function viaPro(paidPath: string, freePath: string, signal?: AbortSignal): Promise<Response> {
  const code = activeProCode();
  if (code) {
    const response = await fetch(`${API_BASE_URL}${paidPath}`, { signal, headers: { Authorization: `Bearer ${code}` } });
    if (response.status === 401) {
      const status = storedProStatus();
      storeProStatus(status ? { ...status, active: false } : null);
    } else if (response.status !== 429) {
      return response;
    }
  }
  return fetch(`${API_BASE_URL}${freePath}`, { signal });
}
