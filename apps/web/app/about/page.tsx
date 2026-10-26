import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, Status } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "About — Svalin",
  description: "Svalin is an independent, read-only rating service for agent money on NEAR and Solana.",
};

export default function AboutPage() {
  return (
    <DocPage
      eyebrow="About"
      lede="Svalin is an independent, read-only rating service for agent money on NEAR and Solana. It tells AI agents, and the people behind them, what is real before they spend."
      title="Know what is real before you spend."
    >
      <h2>Why it exists</h2>
      <p>
        AI agents now hold and spend money, and they can be talked into bad decisions. The data they read can be wrong too: anyone can create a token,
        put a price on it and send it to a wallet, and a look-alike address can be planted in a wallet&apos;s history so the next payment goes to a
        thief. Svalin checks these things before the money moves.
      </p>

      <h2>What it does</h2>
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
                <Link href="/#scan">Wallet Scan</Link>
                <Status kind="live" />
              </td>
              <td>How risky is this wallet&apos;s mix of holdings?</td>
            </tr>
            <tr>
              <td>
                <Link href="/check">Check Before Paying</Link>
                <Status kind="live" />
              </td>
              <td>Is it safe to send money to this address?</td>
            </tr>
            <tr>
              <td>
                <Link href="/ratings">Svalin Index</Link>
                <Status kind="live" />
              </td>
              <td>Is there real money behind this token&apos;s price?</td>
            </tr>
            <tr>
              <td>
                Registry and Guard
                <Status kind="planned" />
              </td>
              <td>Grades that contracts can read on-chain, and spending rules the chain enforces.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>How we work</h2>
      <ul>
        <li>
          <strong>Read-only.</strong> Svalin never asks for keys, approvals or signatures, and has no way to move anyone&apos;s funds.
        </li>
        <li>
          <strong>Deterministic.</strong> The same data always gives the same answer. No language model computes a number.
        </li>
        <li>
          <strong>Verifiable.</strong> Every Index edition archives its inputs, so anyone can recompute every grade.
        </li>
        <li>
          <strong>Open.</strong> The code and the methodology are public.
        </li>
      </ul>

      <h2>The name</h2>
      <p>
        In Norse myth, Svalinn is the shield that stands before the sun and keeps it from burning the earth. Svalin stands between an agent and a bad
        payment.
      </p>

      <h2>Status</h2>
      <p>
        Svalin is early. The scan, the check and the Index are live; payments currently run on test networks. The Registry and the Guard are designed
        and described in the <Link href="/whitepaper">whitepaper</Link>, and the <Link href="/roadmap">roadmap</Link> shows what comes next.
      </p>
      <p>
        Questions, bugs and ideas are welcome on <a href="https://github.com/noobshole/svalin-agent/issues">GitHub</a>.
      </p>
    </DocPage>
  );
}
