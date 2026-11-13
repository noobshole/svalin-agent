import "./globals.css";

import type { Metadata } from "next";
import { Jost } from "next/font/google";
import type { ReactNode } from "react";

import { NavProgress } from "@/components/nav-progress";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { THEME_BOOT } from "@/lib/theme";

// One typeface for the whole site (SIL Open Font License). next/font serves it from this site.
const type = Jost({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL("https://svalin.noobshole.workers.dev"),
  title: "Svalin — read-only risk grades for wallets, tokens and payments",
  description: "Risk grades for wallets, tokens and payments on NEAR and Solana, for people and AI agents. Free to try, or pay per call in USDC over x402. Svalin can never move funds.",
  openGraph: {
    title: "Svalin — two addresses look alike, their seals can’t",
    description: "Read-only risk grades for wallets, tokens and payments on NEAR and Solana. It can never move your money.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={type.variable} lang="en" suppressHydrationWarning>
      <head>
        {/* A fixed string, not user content: applies the saved theme before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="font-sans antialiased">
        <NavProgress />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
