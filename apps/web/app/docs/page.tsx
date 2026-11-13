import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, Status } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "What is Svalin? — Svalin docs",
  description: "Svalin is an independent, read-only rating service for agent money on NEAR and Solana: what it does, how it works, and how to use it.",
};

export default function DocsPage() {
  return (
    <DocPage
      contents={[
        ["why", "Why it exists"],
        ["products", "What Svalin does"],
        ["how", "How it works"],
        ["promises", "What you can count on"],
        ["ways", "Ways to use it"],
        ["chains", "Chains and data"],
        ["next", "Where to go next"],
      ]}
      lede="Svalin is an independent, read-only rating service for agent money on NEAR and Solana. It tells AI agents, and the people behind them, what is real before they spend."
      path="/docs"
      title="What is Svalin?"
    >
      <h2 id="why">Why it exists</h2>
      <p>
        AI agents now hold and spend money, and they can be talked into bad decisions. The data they read can be wrong too: anyone can create a token, put a
        price on it and send it to a wallet, and a look-alike address can be planted in a wallet’s history so the next payment goes to a thief. Svalin checks
        these things before the money moves.
      </p>

      <h2 id="products">What Svalin does</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>The question it answers</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Link href="/docs/wallet-scan">Wallet Scan</Link>
                <Status kind="live" />
              </td>
              <td>How risky is this wallet’s mix of holdings?</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/check">Check Before Paying</Link>
                <Status kind="live" />
              </td>
              <td>What is known about this address before you pay it?</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/svalin-index">Svalin Index</Link>
                <Status kind="live" />
              </td>
              <td>Is there real money behind this token’s price?</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/guard">Svalin Guard</Link>
                <Status kind="testnet" />
              </td>
              <td>What can an AI agent spend, under rules the chain enforces?</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="how">How it works</h2>
      <p>
        You send an address: a Solana wallet or a NEAR account. Svalin reads the chain, meaning the balances, the prices and, on NEAR, how much real money
        stands behind each token, without ever asking for a key, a signature or a wallet connection. You get a grade from A to F, what is wrong in plain
        words, and a next step.
      </p>
      <p>An AI agent does the same over plain HTTP or through the MCP server, and gets JSON back.</p>

      <h2 id="promises">What you can count on</h2>
      <ul>
        <li>
          <strong>Read-only.</strong> The rating service has no code path that signs for, approves or moves the funds of a wallet it analyses.
        </li>
        <li>
          <strong>Deterministic.</strong> The same inputs always give the same output. No language model computes a number.
        </li>
        <li>
          <strong>Verifiable.</strong> Index editions archive their inputs and fingerprints, so anyone can recompute every grade.
        </li>
        <li>
          <strong>Never charged for errors.</strong> Bad input is rejected before payment, and failed calls are never settled.
        </li>
      </ul>

      <h2 id="ways">Ways to use it</h2>
      <ul>
        <li>
          <strong>On the website.</strong> <Link href="/scan">Scan</Link>, <Link href="/check">Check</Link> and the <Link href="/ratings">Index</Link>: 10 free
          checks a day, with no account and no wallet to connect.
        </li>
        <li>
          <strong>Over HTTP.</strong> Plain JSON <Link href="/docs/routes">routes</Link>, <Link href="/docs/paying">paid per call</Link> in USDC over x402, with
          no account.
        </li>
        <li>
          <strong>In an AI agent.</strong> The <Link href="/docs/mcp">MCP server</Link> gives Claude, Cursor or any MCP client the same checks as tools, with
          spend limits.
        </li>
        <li>
          <strong>With a pass.</strong> <Link href="/docs/plans">Svalin Pro or Business</Link>, for steady use.
        </li>
      </ul>

      <h2 id="chains">Chains and data</h2>
      <p>
        Svalin covers Solana and NEAR, for wallets and payments. The Svalin Index grades NEAR tokens today; Solana tokens are planned for early 2027. The data
        comes from Helius for Solana, and from FastNEAR and Ref Finance for NEAR.
      </p>

      <h2 id="next">Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/quick-start">Quick start</Link>: your first answer from the API, free.
        </li>
        <li>
          <Link href="/docs/mcp">MCP server</Link>: connect Svalin to an AI agent.
        </li>
        <li>
          <Link href="/whitepaper">Whitepaper</Link>: the full design and how each part fits together.
        </li>
      </ul>
    </DocPage>
  );
}
