import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckRedirect } from "@/components/check-redirect";

export const metadata: Metadata = {
  title: "Scan — Svalin",
  description: "This page moved to Scan.",
  robots: { index: false },
};

export default function CheckPage() {
  return (
    <Suspense>
      <CheckRedirect />
    </Suspense>
  );
}
