import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, Status } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "What is Svalin? — Svalin docs",
  description: "What Svalin checks, how it works, and how to use it on the website, over HTTP or inside an AI agent.",
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
      lede="Svalin rates wallets, tokens and payments on NEAR and Solana. These pages explain what it checks and how to use it on the website, over HTTP or inside an AI agent."
      path="/docs"
      title="What is Svalin?"
    >
      <h2 id="why">Why it exists</h2>
      <p>
        AI agents now hold and spend money, and they can be talked into bad decisions. The data they read can be wrong too. Anyone can create a token, put a
        price on it and send it to a wallet, and a look-alike address can be planted in a wallet’s history so the next payment goes to a thief. Svalin checks
        for these things before the money moves.
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
                <Link href="/docs/wallet-scan">Risk report</Link>
                <Status kind="live" />
              </td>
              <td>How risky is this wallet’s mix of holdings?</td>
            </tr>
            <tr>
              <td>
                <Link href="/docs/check">Payee check</Link>
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
        You send a Solana address or a NEAR account. Svalin reads its balances and prices from the chain, and on NEAR it also checks how much real money
        stands behind each token. It never asks for a key, a signature or a wallet connection. You get allow, caution or block for paying the address, a
        grade from A to F for the money it holds, and each problem in plain words.
      </p>
      <p>An AI agent does the same over plain HTTP or through the MCP server, and gets JSON back.</p>

      <h2 id="promises">What you can count on</h2>
      <ul>
        <li>Svalin has no code that signs for, approves or moves the funds of a wallet it checks.</li>
        <li>The same inputs always give the same output. No language model computes a number.</li>
        <li>Index editions keep their inputs and fingerprints, so anyone can recompute every grade.</li>
        <li>You are never charged for an error. Bad input is refused before payment, and a call that fails is never settled.</li>
      </ul>

      <h2 id="ways">Ways to use it</h2>
      <ul>
        <li>
          On the website, you can <Link href="/scan">scan</Link> 10 addresses a day for free and browse the <Link href="/ratings">Index</Link>, with no account
          and nothing to connect. A scan tells you whether an address is safe to pay and how risky the money it holds is.
        </li>
        <li>
          Over HTTP, the <Link href="/docs/routes">routes</Link> return plain JSON and are <Link href="/docs/paying">paid per call</Link> in USDC over x402, with
          no account.
        </li>
        <li>
          In an AI agent, the <Link href="/docs/mcp">MCP server</Link> gives Claude, Cursor or any MCP client the same checks as tools, with spend limits.
        </li>
        <li>
          For steady use there are two passes, <Link href="/docs/plans">Svalin Pro and Business</Link>.
        </li>
      </ul>

      <h2 id="chains">Chains and data</h2>
      <p>
        Svalin covers Solana and NEAR, for wallets and payments. The Svalin Index grades NEAR tokens today; Solana tokens are planned for early 2027. The data
        comes from Helius for Solana, and from FastNEAR and Rhea Finance (formerly Ref Finance) for NEAR.
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
