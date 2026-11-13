import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckTool } from "@/components/check-tool";

export const metadata: Metadata = {
  title: "Check Before Paying — Svalin",
  description: "Check a Solana address or NEAR account before you send money to it. Allow, caution or block, with reasons. Free and read-only.",
};

export default function CheckPage() {
  return (
    <Suspense>
      <CheckTool />
    </Suspense>
  );
}
