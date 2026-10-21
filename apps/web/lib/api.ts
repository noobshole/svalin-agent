import {
  apiErrorSchema,
  riskReportSchema,
  serviceInfoSchema,
  type RiskReport,
  type ServiceInfo,
  type TokenNotice,
} from "@svalin-agent/shared";

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

export type DemoResult =
  | { ok: true; report: RiskReport }
  | { ok: false; status: number; message: string; hint?: string; token?: TokenNotice };

/** Runs in the browser, so the API applies the free-scan limit to the visitor's own address. */
export async function getDemoRisk(address: string, signal?: AbortSignal): Promise<DemoResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/demo/risk/${encodeURIComponent(address)}`, { signal });
    const body = await response.json();
    if (response.ok) return { ok: true, report: riskReportSchema.parse(body) };
    const error = apiErrorSchema.safeParse(body);
    return {
      ok: false,
      status: response.status,
      message: error.success ? error.data.error : `API returned ${response.status}.`,
      hint: error.success ? error.data.hint : undefined,
      token: error.success ? error.data.token : undefined,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, status: 503, message: "The Svalin API is unreachable right now. Try again in a minute." };
  }
}
