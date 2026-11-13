import type { Metadata } from "next";

import { DocPage } from "@/components/doc-page";
import { PaymentNetworks } from "@/components/payment-networks";

export const metadata: Metadata = {
  title: "Paying per call — Svalin docs",
  description: "How a paid Svalin route is paid in USDC over x402, with no account, and why a call that fails is never charged.",
};

export default function PayingPage() {
  return (
    <DocPage
      contents={[
        ["how", "How a call is paid"],
        ["networks", "Test and real USDC"],
        ["failures", "When a call fails"],
      ]}
      lede="A paid route asks for a USDC payment over x402 and answers once it is paid. There is no account."
      path="/docs/paying"
      title="Paying per call"
    >
      <h2 id="how">How a call is paid</h2>
      <ol>
        <li>Call a paid route. It answers HTTP 402 with the price in the <code>PAYMENT-REQUIRED</code> header.</li>
        <li>Sign a USDC payment for that amount with any x402 client.</li>
        <li>
          Call again with the <code>PAYMENT-SIGNATURE</code> header. The answer comes back with a receipt.
        </li>
      </ol>

      <h2 id="networks">Test and real USDC</h2>
      <PaymentNetworks className="mb-4" />
      <p>Each chain moves from its test network to real USDC on its own; the line above is read live from the API.</p>

      <h2 id="failures">When a call fails</h2>
      <p>
        Bad input is rejected before any payment, and a call that fails is never charged. A token address sent where a wallet was expected gets
        HTTP 422 with code <code>token_address</code>, and for a NEAR token, its grade.
      </p>
    </DocPage>
  );
}
