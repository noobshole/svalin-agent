import "./globals.css";

import type { Metadata } from "next";
import { Source_Code_Pro, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";

import { NavProgress } from "@/components/nav-progress";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { THEME_BOOT } from "@/lib/theme";

// Adobe's Source family (SIL Open Font License): serif headlines for the authority of a rating
// report, a plain sans for reading, and a mono for figures. next/font serves them from this site.
const display = Source_Serif_4({ subsets: ["latin"], variable: "--font-display" });
const sans = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans" });
const mono = Source_Code_Pro({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Svalin — portfolio risk intelligence for AI agents",
  description:
    "Read-only Solana and NEAR portfolio risk reports for AI agents and humans. Free scan, or pay per call in USDC over x402 on Solana or NEAR. Svalin can never move funds.",
  openGraph: {
    title: "Svalin — the agent that can't drain your wallet",
    description: "Read-only portfolio risk reports for AI agents. Pay per call in USDC over x402.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${display.variable} ${sans.variable} ${mono.variable}`} lang="en" suppressHydrationWarning>
      <head>
        {/* A fixed string, not user content: applies the saved theme before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-background font-sans text-foreground antialiased">
        <NavProgress />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
