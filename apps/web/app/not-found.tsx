import type { Metadata } from "next";
import Link from "next/link";

import { ScanForm } from "@/components/scan-form";

export const metadata: Metadata = { title: "Page not found — Svalin", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="mx-auto grid w-full max-w-xl gap-6 px-4 py-24 md:py-32">
      <p className="font-mono text-xs text-mutedForeground">404</p>
      <h1 className="text-3xl font-medium tracking-tight">This page does not exist.</h1>
      <p className="text-sm leading-6 text-mutedForeground">
        Paste a Solana wallet or a NEAR account to scan it, or go back to the{" "}
        <Link className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/">
          home page
        </Link>
        .
      </p>
      <ScanForm />
    </main>
  );
}
