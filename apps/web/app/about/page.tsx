import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, Status } from "@/components/doc-page";
import { PaymentNetworks } from "@/components/payment-networks";

export const metadata: Metadata = {
  title: "About — Svalin",
  description: "Svalin rates wallets, tokens and payments on NEAR and Solana, for people and AI agents. It only reads public data and can never move funds.",
};

const contents: [string, string][] = [
  ["why", "Why it exists"],
  ["what", "What it does"],
  ["how", "How we work"],
  ["name", "The name"],
  ["status", "Status"],
];

export default function AboutPage() {
  return (
    <DocPage
      contents={contents}
      path="/about"
      lede="Svalin rates wallets, tokens and payments on NEAR and Solana. AI agents and the people who run them use it to check an address or a token before they send money. It only reads public data."
      title="About Svalin"
    >
      <h2 id="why">Why it exists</h2>
      <p>
        AI agents now hold and spend money, and they can be talked into bad decisions. The data they read can be wrong too. Anyone can create a token, put a price on it and send it to a
        wallet, and a look-alike address can be planted in a wallet’s history so the next payment goes to a thief. Svalin checks for these things before the money moves.
      </p>

      <h2 id="what">What it does</h2>
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
                <Link href="/scan">Scan</Link>
                <Status kind="live" />
              </td>
              <td>Is this address safe to pay, and how risky is the money it holds?</td>
            </tr>
            <tr>
              <td>
                <Link href="/ratings">Svalin Index</Link>
                <Status kind="live" />
              </td>
              <td>Is there real money behind this token’s price?</td>
            </tr>
            <tr>
              <td>
                <Link href="/guard">Svalin Guard</Link>
                <Status kind="testnet" />
              </td>
              <td>What can an AI agent spend, under rules the chain enforces?</td>
            </tr>
            <tr>
              <td>
                Svalin Registry
                <Status kind="testnet" />
              </td>
              <td>Can a contract confirm this token’s grade on-chain?</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="how">How we work</h2>
      <ul>
        <li>Svalin never asks for wallet keys, approvals or signatures, and has no way to move anyone’s funds.</li>
        <li>The same data always gives the same answer. No language model computes a number.</li>
        <li>Every Index edition keeps its inputs, so anyone can recompute every grade.</li>
        <li>The code and the method are public.</li>
      </ul>

      <h2 id="name">The name</h2>
      <p>In Norse myth, Svalinn is the shield that stands before the sun and keeps it from burning the earth. Svalin stands between an agent and a bad payment.</p>

      <h2 id="status">Status</h2>
      <p>
        Svalin is early. The scan and the Index are live, and each chain moves from its test network to real USDC on its own. The Registry and the Guard run on NEAR’s test network. The
        <Link href="/whitepaper"> whitepaper</Link> describes them, and the <Link href="/roadmap">roadmap</Link> shows what comes next.
      </p>
      <PaymentNetworks className="mb-4" />
      <p>
        Questions, bugs and ideas are welcome on <a href="https://github.com/noobshole/svalin-agent/issues">GitHub</a>.
      </p>
    </DocPage>
  );
}
