import type { Metadata } from "next";
import { Suspense } from "react";

import { ScanResult } from "@/components/scan-result";

export const metadata: Metadata = { title: "Risk scan — Svalin", robots: { index: false } };

export default function ScanPage() {
  return (
    <Suspense>
      <ScanResult />
    </Suspense>
  );
}
