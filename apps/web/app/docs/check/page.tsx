import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Check Before Paying — Svalin docs",
  description: "How Svalin answers allow, caution or block before money moves, how look-alike addresses are caught, and what the free check leaves out.",
};

export default function CheckDocsPage() {
  return (
    <DocPage
      contents={[
        ["answers", "The three answers"],
        ["lookalikes", "How look-alikes are caught"],
        ["free-paid", "Free and paid checks"],
        ["gaps", "When history cannot be read"],
        ["limits", "What it cannot see"],
        ["try", "Try it"],
      ]}
      lede="Before money moves, the check answers allow, caution or block, with reasons."
      path="/docs/check"
      title="Check Before Paying"
    >
      <h2 id="answers">The three answers</h2>
      <ul>
        <li>
          <strong>Block:</strong> the address is not a wallet (a token or a program), the account does not exist, or it imitates an address or name the payer
          has paid before, or a well-known NEAR account.
        </li>
        <li>
          <strong>Caution:</strong> the address is brand new or barely used, runs a contract, is about to receive a large first payment, or its history could
          not be read.
        </li>
        <li>
          <strong>Allow:</strong> none of the above.
        </li>
      </ul>

      <h2 id="lookalikes">How look-alikes are caught</h2>
      <p>
        A look-alike copies something you trust, such as <code>intent5.near</code> for <code>intents.near</code>. The check compares what it is given with two
        things: the payer’s recent payments, and a short list of well-known NEAR accounts.
      </p>
      <ul>
        <li>The same first and last four characters as an address the payer paid, but a different address: block.</li>
        <li>A NEAR name that reads the same once 0 and o, 1 and l, 5 and s, rn and m, and dashes and dots are set aside: block.</li>
        <li>A NEAR name one letter away: caution.</li>
      </ul>

      <h2 id="free-paid">Free and paid checks</h2>
      <p>
        The free check does not read the payer’s history, so it cannot compare an address with earlier payments. It still catches look-alikes of well-known NEAR
        accounts. The paid check takes <code>payer</code>, the wallet about to pay, and <code>amountUsd</code>, which turn on the look-alike and first-payment
        checks.
      </p>

      <h2 id="gaps">When history cannot be read</h2>
      <p>If the payer’s history cannot be read, the check says so and cautions instead of guessing, because a gap could hide the very payment a look-alike imitates.</p>

      <h2 id="limits">What it cannot see</h2>
      <ul>
        <li>It reads recent history only, so an address the payer paid long ago is not compared.</li>
        <li>There is no NEAR scam list yet.</li>
      </ul>

      <h2 id="try">Try it</h2>
      <p>
        Free on the <Link href="/check">Check page</Link>, or over the API at <code>GET /v1/check/{"{address}"}</code>. See <Link href="/docs/routes">Routes</Link>.
      </p>
    </DocPage>
  );
}
