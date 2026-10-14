import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Svalin — portfolio risk intelligence for AI agents",
  description:
    "Read-only Solana and NEAR wallet risk reports for AI agents and humans. Free scan, or pay per call in USDC over x402 on Solana or NEAR. Svalin can never move funds.",
  openGraph: {
    title: "Svalin — the agent that can't drain your wallet",
    description: "Read-only portfolio risk reports for AI agents. Pay per call in USDC over x402.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
