import type { Metadata } from "next";
import { Suspense } from "react";

import { ScanResult } from "@/components/scan-result";

export const metadata: Metadata = {
  title: "Scan — Svalin",
  description:
    "Check a Solana address or NEAR account before you send it money. Svalin flags signs of a scam and grades the money it holds from A to F. Free.",
};

export default function ScanPage() {
  return (
    <Suspense>
      <ScanResult />
    </Suspense>
  );
}
