import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PaymentNetworks } from "@/components/payment-networks";
import { ProCheckout } from "@/components/pro-checkout";
import { getServiceInfo } from "@/lib/api";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Pricing — Svalin",
  description: "Free to try. Svalin Pro is $9 a month. Agents pay $0.002 a call in USDC, or $79 a month for 200,000 calls.",
};

export default async function PricingPage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) => info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;
  const callPrice = price("/v1/check/{address}", "$0.002");
  const briefPrice = price("/v1/brief/{address}", "$0.02");
  const proPrice = price("/v1/keys/pro", "$9");
  const businessPrice = price("/v1/keys/business", "$79");

  return (
    <main className="page main grid gap-16 lg:gap-24">
      <section className="grid4">
        <header className="grid content-start gap-4">
          <h1 className="display">Pricing</h1>
          <p className="lede">Free to try. One pass for people, one price per call for agents.</p>
        </header>
        <div className="grid gap-y-10 lg:col-span-3 lg:grid-cols-3 lg:gap-x-[var(--gap)] lg:gap-y-3">
          <Plan link={{ href: "/scan", label: "Scan a wallet" }} name="Free" price="$0">
            <li>10 scans or checks a day</li>
            <li>Every warning, always</li>
            <li>The Svalin Index</li>
          </Plan>
          <Plan highlight link={{ href: "#checkout", label: "Get Pro" }} name="Svalin Pro" note="or $90 a year" price={`${proPrice} a month`}>
            <li>100 calls a day, on the website and in your agent</li>
            <li>Every next step, and exit prices at any sale size</li>
            <li>The look-alike check against your own wallet</li>
          </Plan>
          <Plan link={{ href: "/docs", label: "Read the docs" }} name="For agents" note={`or ${businessPrice} a month for 200,000 calls`} price={`${callPrice} a call`}>
            <li>
              Every call {callPrice}; the written brief {briefPrice}
            </li>
            <li>Paid in USDC over x402, no account</li>
            <li>A call that fails is never charged</li>
          </Plan>
          <PaymentNetworks className="lg:col-span-3" />
        </div>
      </section>

      <section className="grid4 items-start">
        <div className="order-2 border-b border-border lg:order-none lg:col-span-2">
          <Answer title="How you pay for Pro">
            In USDC from your own wallet. On Solana you scan a QR code with your wallet app; on NEAR you send an exact amount. Svalin never connects to your wallet and never asks you to sign
            anything: it finds your payment on the blockchain. Card payments are planned for early 2027.
          </Answer>
          <Answer title="Your Pro code">
            The code is your pass. It stays in your browser, and you can copy it to another device or into your agent’s settings. Svalin keeps only a fingerprint of it, so a lost code
            cannot be recovered.
          </Answer>
          <Answer title="Renewing">
            Crypto payments do not renew by themselves. The site reminds you three days before your pass ends, and paying again with the same code adds the new days after the current end.
            Agents renew by buying again with their key; see the{" "}
            <Link className="link text-foreground" href="/docs/passes">
              docs
            </Link>
            .
          </Answer>
          <Answer title="What stays free">
            Every check shows every warning, with or without a pass: Svalin never hides “don’t pay this address” behind a paywall.
          </Answer>
        </div>
        <div className="order-1 lg:order-none lg:col-span-2">
          <ProCheckout />
        </div>
      </section>
    </main>
  );
}

function Plan({
  name,
  price,
  note,
  link,
  highlight = false,
  children,
}: {
  name: string;
  price: string;
  note?: string;
  link: { href: string; label: string };
  highlight?: boolean;
  children: ReactNode;
}) {
  // Every plan uses the same five rows of the parent grid, so names, prices, lists and links line up across plans.
  return (
    <article className={cn("grid content-start gap-y-3 border-t-2 pt-3 lg:row-span-5 lg:grid-rows-subgrid", highlight ? "border-accent" : "border-foreground")}>
      <h2 className="text-lg font-normal">{name}</h2>
      <p className="title">{price}</p>
      <p className="text-sm text-mutedForeground">{note}</p>
      <ul className="grid content-start gap-2 text-mutedForeground">{children}</ul>
      <Link className="link w-fit" href={link.href}>
        {link.label}
      </Link>
    </article>
  );
}

function Answer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border py-5">
      <h2 className="subtitle">{title}</h2>
      <p className="max-w-[34em] text-mutedForeground">{children}</p>
    </div>
  );
}
