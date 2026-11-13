import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";
import { getServiceInfo } from "@/lib/api";

export const metadata: Metadata = {
  title: "Passes for agents — Svalin docs",
  description: "Buy a Svalin pass over x402 once a month and send its key instead of paying each call.",
};

const KEY_PLANS = [
  { path: "/v1/keys/pro", name: "Svalin Pro", fallback: "$9", calls: "100 calls a day" },
  { path: "/v1/keys/business", name: "Svalin Business", fallback: "$79", calls: "200,000 calls" },
];

export default async function PassesPage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) => info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;

  return (
    <DocPage
      contents={[
        ["plans", "The two passes"],
        ["using", "Using the key"],
        ["safe", "Keeping the key"],
        ["renewing", "Renewing"],
      ]}
      lede="For steady use, an agent can buy a pass over x402 once a month and send its key instead of paying each call."
      path="/docs/passes"
      title="Passes for agents"
    >
      <h2 id="plans">The two passes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pass</th>
              <th>Buy at</th>
              <th>Price</th>
              <th>Calls, for 30 days</th>
            </tr>
          </thead>
          <tbody>
            {KEY_PLANS.map((plan) => (
              <tr key={plan.path}>
                <td className="whitespace-nowrap">{plan.name}</td>
                <td>
                  <code>POST {plan.path}</code>
                </td>
                <td className="whitespace-nowrap">{price(plan.path, plan.fallback)}</td>
                <td>{plan.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        A Pro code bought on the <Link href="/pricing">Pricing page</Link> is the same pass and works here too.
      </p>

      <h2 id="using">Using the key</h2>
      <p>
        <code>Authorization: Bearer &lt;key&gt;</code> works on every paid route. A call that fails is not counted, and <code>GET /v1/keys/me</code>{" "}
        says what is left. In the MCP server, set <code>SVALIN_API_KEY</code>.
      </p>

      <h2 id="safe">Keeping the key</h2>
      <p>The key is in the answer to that one paid call, and only there: Svalin keeps a fingerprint of it, not the key, and cannot show it again.</p>

      <h2 id="renewing">Renewing</h2>
      <p>
        Buy the same pass again with the key in the <code>Authorization</code> header. The new days start where the current ones end, and a Business
        key keeps its unused calls.
      </p>
    </DocPage>
  );
}
