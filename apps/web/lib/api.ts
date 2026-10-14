import "server-only";

import {
  apiErrorSchema,
  riskReportSchema,
  serviceInfoSchema,
  type RiskReport,
  type ServiceInfo,
} from "@svalin-agent/shared";

/** Server-side only: the browser never talks to the API directly, so no CORS or CSP holes. */
export function apiBaseUrl() {
  return (process.env.SVALIN_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
}

export function publicApiUrl() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? apiBaseUrl()).replace(/\/+$/, "");
}

export async function getServiceInfo(): Promise<ServiceInfo | null> {
  try {
    const response = await fetch(`${apiBaseUrl()}/`, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    return serviceInfoSchema.parse(await response.json());
  } catch {
    return null;
  }
}

export type DemoResult =
  | { ok: true; report: RiskReport }
  | { ok: false; status: number; message: string; hint?: string };

let warnedMissingSecret = false;

/**
 * Vouches for the visitor's IP with the secret shared with the API, so the API's free-demo
 * limit applies per visitor rather than to this web server as a whole.
 */
function visitorHeaders(clientIp: string | null): Record<string, string> | undefined {
  const secret = process.env.WEB_FORWARDING_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production" && !warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn("WEB_FORWARDING_SECRET is not set: every visitor shares one free-scan allowance.");
    }
    return undefined;
  }
  if (!clientIp) return undefined;
  return { "x-svalin-client-ip": clientIp, "x-svalin-forwarding-secret": secret };
}

export async function getDemoRisk(address: string, clientIp: string | null): Promise<DemoResult> {
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/demo/risk/${encodeURIComponent(address)}`, {
      cache: "no-store",
      headers: visitorHeaders(clientIp),
    });
    const body = await response.json();
    if (response.ok) return { ok: true, report: riskReportSchema.parse(body) };
    const error = apiErrorSchema.safeParse(body);
    return {
      ok: false,
      status: response.status,
      message: error.success ? error.data.error : `API returned ${response.status}.`,
      hint: error.success ? error.data.hint : undefined,
    };
  } catch {
    return { ok: false, status: 503, message: "The Svalin API is unreachable right now. Try again in a minute." };
  }
}
