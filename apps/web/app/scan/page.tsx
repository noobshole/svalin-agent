import type { Metadata } from "next";
import { Suspense } from "react";

import { ScanResult } from "@/components/scan-result";

export const metadata: Metadata = {
  title: "Wallet Scan — Svalin",
  description: "Grade any Solana wallet or NEAR account from A to F by how its money is spread, with what is wrong and what it would really fetch if sold.",
};

export default function ScanPage() {
  return (
    <Suspense>
      <ScanResult />
    </Suspense>
  );
}
