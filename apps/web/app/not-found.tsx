import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found — Svalin", robots: { index: false } };

const linkClass = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

export default function NotFound() {
  return (
    <main className="mx-auto grid w-full max-w-xl gap-4 px-4 py-24 md:py-32">
      <h1 className="text-3xl font-medium tracking-tight">This page does not exist.</h1>
      <p className="text-sm leading-6 text-mutedForeground">
        Go back to the{" "}
        <Link className={linkClass} href="/">
          home page
        </Link>
        , or{" "}
        <Link className={linkClass} href="/scan">
          scan a wallet
        </Link>
        .
      </p>
    </main>
  );
}
