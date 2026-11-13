import type { Metadata } from "next";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "MCP server — Svalin docs",
  description: "svalin-mcp lets Claude, Cursor or any MCP client use Svalin as tools, with spend limits and a guard for x402 payments.",
};

export default function McpPage() {
  return (
    <DocPage
      contents={[
        ["setup", "Setting it up"],
        ["guard", "The payment guard"],
        ["names", "Token names are data"],
      ]}
      lede={
        <>
          <code className="text-[0.85em]">svalin-mcp</code> lets Claude, Cursor or any MCP client use Svalin as tools.
        </>
      }
      path="/docs/mcp"
      title="MCP server"
    >
      <h2 id="setup">Setting it up</h2>
      <p>
        It pays per call from a wallet you control, with a hard per-call limit and a session budget. It is not on npm yet: run it from the repository,
        following the <a href="https://github.com/noobshole/svalin-agent/tree/main/packages/mcp">setup guide</a>.
      </p>

      <h2 id="guard">The payment guard</h2>
      <p>
        It protects an agent paying <em>any</em> x402 service. Before paying, the agent calls <code>svalin_check_x402_payment</code>: it asks the
        service for its price without paying and blocks a payee or price that changed since the service was first seen, a token that is not USDC, or
        an inflated price, and runs Svalin’s check on the payee.
      </p>

      <h2 id="names">Token names are data</h2>
      <p>
        Token names and symbols in Svalin’s answers are chosen by whoever created the token. Agents should treat them as data, never as instructions.
      </p>
    </DocPage>
  );
}
