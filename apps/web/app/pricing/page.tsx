import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PaymentNetworks } from "@/components/payment-networks";
import { ProCheckout } from "@/components/pro-checkout";
import { getServiceInfo } from "@/lib/api";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Pricing — Svalin",
  description: "Free to try. Agents pay per call in USDC; Svalin Pro is $5 a month and Svalin Business $79 a month, for people and agents alike.",
};

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

export default async function PricingPage() {
  const info = await getServiceInfo();
  const price = (path: string, fallback: string) => info?.endpoints.find((endpoint) => endpoint.path === path)?.price ?? fallback;
  const checkPrice = price("/v1/check/{address}", "$0.002");
  const riskPrice = price("/v1/risk/{address}", "$0.004");
  const proPrice = price("/v1/keys/pro", "$5");
  const businessPrice = price("/v1/keys/business", "$79");

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-14 px-4 pb-24 pt-14 md:px-8 md:pt-20">
      <header className="grid max-w-2xl gap-4">
        <h1 className="text-4xl font-medium leading-tight tracking-tight md:text-5xl">Pricing</h1>
        <p className="text-lg leading-8 text-mutedForeground">
          Start free. When you need more, agents can pay per call, and one pass covers people and agents alike.
        </p>
      </header>

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        <Plan link={{ href: "/scan", label: "Scan a wallet" }} name="Free" price="$0">
          <li>5 scans or checks a day</li>
          <li>Every safety warning, always</li>
          <li>The Svalin Index</li>
        </Plan>
        <Plan link={{ href: "/docs", label: "Read the docs" }} name="Pay per call" price={`From ${checkPrice}`} note="for agents">
          <li>
            {checkPrice} a check, {riskPrice} a risk report
          </li>
          <li>Paid in USDC over x402, no account</li>
          <li>A call that fails is never charged</li>
        </Plan>
        <Plan highlight link={{ href: "#checkout", label: "Get Pro" }} name="Svalin Pro" note="or $48 a year" price={`${proPrice} a month`}>
          <li>100 calls a day, on the website and in your agent</li>
          <li>Every next step in your reports</li>
          <li>The look-alike check against your own wallet</li>
          <li>Exit prices at any sale size</li>
        </Plan>
        <Plan link={{ href: "/docs#keys", label: "How agents buy it" }} name="Svalin Business" price={`${businessPrice} a month`}>
          <li>200,000 calls a month</li>
          <li>Every paid route, for agents and companies</li>
          <li>Bought and renewed over x402</li>
        </Plan>
      </div>
      <PaymentNetworks className="-mt-8" />

      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <ProCheckout />
        <div className="grid gap-8 text-sm leading-6 text-mutedForeground">
          <Answer title="How you pay for Pro">
            In USDC from your own wallet. On Solana you scan a QR code with your wallet app; on NEAR you send an exact amount. Svalin never connects
            to your wallet and never asks you to sign anything: it finds your payment on the blockchain. Card payments come in early 2027.
          </Answer>
          <Answer title="Your Pro code">
            The code is your pass. It stays in your browser, and you can copy it to another device or into your agent&apos;s settings. Svalin keeps
            only a fingerprint of it, so a lost code cannot be recovered.
          </Answer>
          <Answer title="Renewing">
            Crypto payments do not renew by themselves. The site reminds you three days before your pass ends, and paying again with the same code
            adds the new days after the current end. Agents renew by buying again with their key; see the <Link className={linkClass} href="/docs#keys">docs</Link>.
          </Answer>
          <Answer title="What stays free">
            Every check shows every safety warning, with or without a pass: Svalin never hides &quot;don&apos;t pay this address&quot; behind a
            paywall.
          </Answer>
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
  return (
    <div className={cn("grid content-start gap-4 bg-surface p-6", highlight && "bg-surface2")}>
      <div className="grid gap-1">
        <h2 className="font-medium">{name}</h2>
        <p className="text-2xl tracking-tight">{price}</p>
        <p className="text-sm text-subtleForeground md:h-5">{note}</p>
      </div>
      <ul className="grid gap-2 text-sm leading-6 text-mutedForeground">{children}</ul>
      <Link className={cn(linkClass, "w-fit text-sm")} href={link.href}>
        {link.label}
      </Link>
    </div>
  );
}

function Answer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p>{children}</p>
    </div>
  );
}
