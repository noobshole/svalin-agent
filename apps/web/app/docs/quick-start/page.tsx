import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";
import { API_BASE_URL } from "@/lib/api";

export const metadata: Metadata = {
  title: "Quick start — Svalin docs",
  description: "Your first answer from the Svalin API: scan a wallet and check an address, free, with no account or key.",
};

const RISK_ANSWER = `{
  "wallet": "root.near",
  "chain": "near",
  "score": 58,
  "grade": "C",
  "level": "elevated",
  "findings": [
    {
      "severity": "high",
      "title": "74.7% sits in unvetted long-tail tokens",
      "action": "Review each long-tail position's liquidity and holder concentration before adding more; size them as if they can go to zero."
    }
  ],
  "methodologyVersion": "2026-11.1"
}`;

const CHECK_ANSWER = `{
  "recipient": "intent5.near",
  "verdict": "block",
  "reasons": [
    {
      "code": "imitates-known",
      "severity": "block",
      "message": "This account name imitates intents.near, a well-known NEAR account: it differs only by characters that look alike, such as 0 and o, 1 and l, or a dash. If you mean intents.near, use that name exactly."
    }
  ]
}`;

export default function QuickStartPage() {
  return (
    <DocPage
      contents={[
        ["scan", "Scan a wallet"],
        ["read", "Read the answer"],
        ["check", "Check an address"],
        ["next", "Next steps"],
      ]}
      lede="The free routes need no account, no key and no payment, so you can try Svalin from a terminal right now."
      path="/docs/quick-start"
      title="Quick start"
    >
      <h2 id="scan">Scan a wallet</h2>
      <p>
        Routes that take an address accept a Solana address or a NEAR account ID such as <code>alice.near</code>.
      </p>
      <pre>
        <code>{`curl ${API_BASE_URL}/v1/demo/risk/root.near`}</code>
      </pre>

      <h2 id="read">Read the answer</h2>
      <p>The answer is JSON. This one is trimmed:</p>
      <pre>
        <code>{RISK_ANSWER}</code>
      </pre>
      <ul>
        <li>
          <code>score</code> runs from 0, the safest, to 100.
        </li>
        <li>
          <code>grade</code> turns the score into a letter from A to F.
        </li>
        <li>
          <code>findings</code> says what is wrong and what to do next, most severe first.
        </li>
        <li>
          <code>methodologyVersion</code> names the exact rules that produced the answer.
        </li>
      </ul>
      <p>
        <Link href="/docs/wallet-scan">Wallet Scan</Link> explains how the score is built.
      </p>

      <h2 id="check">Check an address</h2>
      <p>Before paying someone, ask whether the address is safe to pay:</p>
      <pre>
        <code>{`curl ${API_BASE_URL}/v1/demo/check/intent5.near`}</code>
      </pre>
      <p>This name is made to look like the real intents.near, so the check says block:</p>
      <pre>
        <code>{CHECK_ANSWER}</code>
      </pre>

      <h2 id="next">Next steps</h2>
      <ul>
        <li>
          You get 10 free calls a day. For more, see <Link href="/docs/plans">Plans and limits</Link>.
        </li>
        <li>
          To pay per call with no account, see <Link href="/docs/paying">Paying per call</Link>.
        </li>
        <li>
          To give these checks to an AI agent, see <Link href="/docs/mcp">MCP server</Link>.
        </li>
      </ul>
    </DocPage>
  );
}
