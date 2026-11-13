import type { Metadata } from "next";
import Link from "next/link";

import { Seal } from "@/components/seal";

export const metadata: Metadata = { title: "Page not found — Svalin", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="page main">
      <div className="grid4 items-center">
        <div className="grid content-start gap-6 lg:col-span-2">
          <h1 className="display">This page does not exist.</h1>
          <p className="lede">
            Go back to the{" "}
            <Link className="link" href="/">
              home page
            </Link>
            , or{" "}
            <Link className="link" href="/scan">
              scan a wallet
            </Link>
            .
          </p>
        </div>
        <div className="w-full max-w-[min(100%,58vh)] lg:col-span-2 lg:justify-self-end">
          <Seal address="404" tone="soft" />
        </div>
      </div>
    </main>
  );
}
