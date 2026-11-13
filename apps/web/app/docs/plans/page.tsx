import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";
import { getServiceInfo } from "@/lib/api";

export const metadata: Metadata = {
  title: "Plans and limits — Svalin docs",
  description: "Svalin’s free tier, pay-per-call price, Pro and Business passes, and when each limit resets.",
};

export default async function PlansPage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) => info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;

  return (
    <DocPage
      contents={[
        ["plans", "The plans"],
        ["free", "What stays free"],
        ["limits", "When limits reset"],
        ["counts", "What counts as a call"],
      ]}
      lede="Free to try. One pass for people, one price per call for agents."
      path="/docs/plans"
      title="Plans and limits"
    >
      <h2 id="plans">The plans</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Price</th>
              <th>What you get</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Free</td>
              <td data-label="Price">$0</td>
              <td data-label="What you get">10 scans or checks a day, and the Svalin Index</td>
            </tr>
            <tr>
              <td>Pay per call</td>
              <td data-label="Price">
                {price("/v1/check/{address}", "$0.002")} a call; the written brief {price("/v1/brief/{address}", "$0.02")}
              </td>
              <td data-label="What you get">Every paid route, in USDC over x402, with no account</td>
            </tr>
            <tr>
              <td>Svalin Pro</td>
              <td data-label="Price">{price("/v1/keys/pro", "$9")} a month, or $90 a year</td>
              <td data-label="What you get">100 calls a day, on the website and in your agent</td>
            </tr>
            <tr>
              <td>Svalin Business</td>
              <td data-label="Price">{price("/v1/keys/business", "$79")} a month</td>
              <td data-label="What you get">200,000 calls for heavy agent use</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Buy Pro on the <Link href="/pricing">Pricing page</Link>. Agents can buy either pass themselves: see <Link href="/docs/passes">Passes for agents</Link>.
      </p>

      <h2 id="free">What stays free</h2>
      <p>Every check shows every warning, with or without a pass: Svalin never hides “don’t pay this address” behind a paywall.</p>

      <h2 id="limits">When limits reset</h2>
      <p>
        Free calls and a Pro pass’s daily calls come back at 00:00 UTC. Each answer from a free route carries an <code>X-Free-Remaining</code> header that says
        how many are left today.
      </p>

      <h2 id="counts">What counts as a call</h2>
      <p>
        A call that fails is never charged and does not count against a pass. Bad input is rejected before any payment. See{" "}
        <Link href="/docs/errors">Errors</Link>.
      </p>
    </DocPage>
  );
}
