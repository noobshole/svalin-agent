import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckTool } from "@/components/check-tool";

export const metadata: Metadata = {
  title: "Check before paying — Svalin",
  description: "Is it safe to send money to this Solana address or NEAR account? Allow, caution or block, with reasons. Free and read-only.",
};

export default function CheckPage() {
  return (
    <Suspense>
      <CheckTool />
    </Suspense>
  );
}
