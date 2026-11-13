import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";
import { API_BASE_URL, getServiceInfo } from "@/lib/api";

export const metadata: Metadata = {
  title: "Routes — Svalin docs",
  description: "Every free and paid route of the Svalin API, with its price and what it returns.",
};

const paidRoutes = [
  { path: "/v1/check/{address}", fallback: "$0.002", returns: "Allow, caution or block before paying, including look-alike addresses" },
  { path: "/v1/portfolio/{address}", fallback: "$0.002", returns: "Priced holdings with a risk category per token" },
  { path: "/v1/risk/{address}", fallback: "$0.002", returns: "Risk score, grade, exposure metrics and findings" },
  { path: "/v1/brief/{address}", fallback: "$0.02", returns: "A short written brief with up to three actions, plus the report" },
  { path: "/v1/exit/{address}", fallback: "$0.002", returns: "A NEAR token’s exit prices: what selling it would fetch, at your own sale size too (?amountUsd=)" },
  { path: "/v1/proof/{address}", fallback: "$0.002", returns: "A NEAR token’s liquidity grade with a Merkle proof any NEAR contract can check" },
];

export default async function RoutesPage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) => info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;

  return (
    <DocPage
      contents={[
        ["free-routes", "Free routes"],
        ["paid-routes", "Paid routes"],
        ["reference", "Reference"],
      ]}
      lede="Routes that take an address accept a Solana address or a NEAR account ID."
      path="/docs/routes"
      title="Routes"
    >
      <h2 id="free-routes">Free routes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Returns</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>GET /v1/demo/risk/{"{address}"}</code>
              </td>
              <td>A full risk report; 10 free calls a day per visitor, shared by the free routes</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/demo/check/{"{address}"}</code>
              </td>
              <td>The recipient check, without the payer’s history; shares the same limit</td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/index/near-tokens</code>
              </td>
              <td>
                The <Link href="/ratings">Svalin Index</Link>: every NEAR token graded A to F
              </td>
            </tr>
            <tr>
              <td>
                <code>GET /v1/demo/exit/{"{address}"}</code>
              </td>
              <td>A NEAR token’s exit prices at $1K, $10K and $100K; shares the same limit</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="paid-routes">Paid routes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Price</th>
              <th>Returns</th>
            </tr>
          </thead>
          <tbody>
            {paidRoutes.map((route) => (
              <tr key={route.path}>
                <td>
                  <code>GET {route.path}</code>
                </td>
                <td className="whitespace-nowrap">{price(route.path, route.fallback)}</td>
                <td>{route.returns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The check takes two optional query parameters: <code>payer</code>, the wallet about to pay, which turns on the look-alike and first-payment
        checks, and <code>amountUsd</code>.
      </p>

      <h2 id="reference">Reference</h2>
      <ul>
        <li>
          <a href={`${API_BASE_URL}/openapi.json`}>OpenAPI</a> and <a href={`${API_BASE_URL}/llms.txt`}>llms.txt</a>: machine-readable descriptions of the API.
        </li>
        <li>
          <a href="https://github.com/noobshole/svalin-agent">Source code</a> on GitHub. Its README is for developers who want to read the code or run their own
          copy; these pages are for using the hosted API.
        </li>
      </ul>
    </DocPage>
  );
}
