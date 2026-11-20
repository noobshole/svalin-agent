import {
  addressScanSchema,
  apiErrorSchema,
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

/** What a scan used: one of today's free calls, or the Pro code's calls. */
export type Usage = { freeLeft: number | null; proLeft: number | null };

const usageOf = (response: Response): Usage => ({
  freeLeft: headerCount(response, "X-Free-Remaining"),
  proLeft: headerCount(response, "X-Calls-Left"),
});

/** What a visitor reads when the API refuses. A data provider's own status code would mean nothing to them. */
function visitorMessage(code: string, message: string) {
  return code.startsWith("upstream_") ? "This address could not be read right now. Try again in a minute." : message;
}

/** Why an address has no risk report (a token, a program, an empty wallet), in words for a visitor. */
export type ReportProblem = { status: number; message: string; hint?: string; token?: TokenNotice };

export type ScanResult =
  | ({ ok: true; check: RecipientCheck; report: RiskReport | null; reportProblem: ReportProblem | null } & Usage)
  | ({ ok: false; status: number; message: string; hint?: string } & Partial<Usage>);

function problemOf(status: number, body: unknown): ReportProblem {
  const error = apiErrorSchema.safeParse(body);
  if (!error.success) return { status, message: `API returned ${status}.` };
  return { status, message: visitorMessage(error.data.code, error.data.error), hint: error.data.hint, token: error.data.token };
}

function refusal(response: Response, body: unknown): ScanResult {
  const { message, hint } = problemOf(response.status, body);
  return { ok: false, status: response.status, message, hint, ...usageOf(response) };
}

/** A scan's answer: the check, and the report or the reason there is none. */
function scanAnswer(response: Response, body: unknown): ScanResult {
  if (!response.ok) return refusal(response, body);
  const scan = addressScanSchema.parse(body);
  return {
    ok: true,
    check: scan.check,
    report: scan.report,
    reportProblem: scan.reportError ? problemOf(scan.reportError.status, scan.reportError) : null,
    ...usageOf(response),
  };
}

/**
 * One scan, from the browser so the free limit applies to the visitor: is it safe to pay this
 * address, and how risky is the money it holds. Free, it uses one of today's free calls. With a
 * running Pro code it uses one of the code's calls instead: every next step, and with the
 * visitor's own wallet the check also compares the address with that wallet's recent payments.
 */
export async function getScan(address: string, signal?: AbortSignal, payer?: string): Promise<ScanResult> {
  const path = encodeURIComponent(address);
  try {
    const code = activeProCode();
    if (code) {
      const query = payer ? `?payer=${encodeURIComponent(payer)}` : "";
      const response = await fetch(`${API_BASE_URL}/v1/scan/${path}${query}`, { signal, headers: { Authorization: `Bearer ${code}` } });
      // A code that has ended (401) is marked so, and one that has made today's calls (429) leaves
      // the free scan to answer.
      if (response.status === 401) {
        const status = storedProStatus();
        storeProStatus(status ? { ...status, active: false } : null);
      } else if (response.status !== 429) {
        return scanAnswer(response, await response.json());
      }
    }
    const response = await fetch(`${API_BASE_URL}/v1/demo/scan/${path}`, { signal });
    return scanAnswer(response, await response.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, status: 503, message: "The Svalin API is unreachable right now. Try again in a minute." };
  }
}
