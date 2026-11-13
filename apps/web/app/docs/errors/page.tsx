import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Errors — Svalin docs",
  description: "The shape of a Svalin API error, every status and code it can return, and why a failed call is never charged.",
};

const ERROR_EXAMPLE = `{
  "error": "Route not found.",
  "code": "not_found",
  "hint": "GET / lists every endpoint."
}`;

const STATUSES: { status: string; codes: string[]; meaning: ReactNode }[] = [
  { status: "400", codes: ["invalid_address", "invalid_payer", "chain_mismatch", "invalid_amount", "invalid_contract", "amount_needs_paid_route"], meaning: "The request is wrong. Fix it and send it again." },
  { status: "401", codes: ["missing_key", "invalid_key", "unknown_key", "key_ended"], meaning: "The key is missing, not known or has ended. Send a valid key, or leave the header out and pay per call." },
  {
    status: "402",
    codes: [],
    meaning: (
      <>
        Payment is required. See <Link href="/docs/paying">Paying per call</Link>.
      </>
    ),
  },
  { status: "404", codes: ["not_found", "unknown_plan", "trusted_token", "near_not_accepted"], meaning: "There is no such route or pass, or the token is one Svalin values others against, so it has no grade." },
  { status: "409", codes: ["other_plan"], meaning: "This key is on another plan. Renew it on its own plan." },
  { status: "422", codes: ["token_address"], meaning: "This is a token, not a wallet. For a NEAR token, the answer carries its grade." },
  { status: "429", codes: ["demo_limit_reached", "pro_daily_limit", "key_used_up", "too_many_requests", "too_many_refused_keys"], meaning: "A limit was reached. Daily calls come back at 00:00 UTC; Retry-After says when to try a free route again." },
  { status: "500", codes: ["internal_error"], meaning: "Something failed on Svalin’s side." },
  { status: "501", codes: ["chain_not_supported"], meaning: "This instance does not cover that chain." },
  { status: "502", codes: ["upstream_unavailable", "upstream_error"], meaning: "A data provider did not answer. Try again in a minute." },
  { status: "503", codes: ["upstream_rate_limited", "payments_not_configured", "facilitator_unavailable", "keys_unavailable", "checkout_busy"], meaning: "A service is busy or not available. Try again shortly." },
];

export default function ErrorsPage() {
  return (
    <DocPage
      contents={[
        ["shape", "The shape of an error"],
        ["codes", "Statuses and codes"],
        ["charges", "Failed calls are not charged"],
      ]}
      lede="Every error is JSON, with a plain message and a stable code."
      path="/docs/errors"
      title="Errors"
    >
      <h2 id="shape">The shape of an error</h2>
      <pre>
        <code>{ERROR_EXAMPLE}</code>
      </pre>
      <p>
        <code>error</code> is for people, <code>code</code> is for programs, and <code>hint</code>, when there is one, says what to do next.
      </p>

      <h2 id="codes">Statuses and codes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Code</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {STATUSES.map((row) => (
              <tr key={row.status}>
                <td>{row.status}</td>
                <td data-label="Code">
                  {row.codes.map((code) => (
                    <code className="block" key={code}>
                      {code}
                    </code>
                  ))}
                </td>
                <td data-label="Meaning">{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="charges">Failed calls are not charged</h2>
      <p>Bad input is rejected before any payment, and a call that fails is never settled. A call made with a pass that fails is not counted.</p>
    </DocPage>
  );
}
