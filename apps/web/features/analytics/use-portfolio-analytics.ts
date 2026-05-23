"use client";

import type { Address } from "@svalin-agent/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchPortfolioAnalytics } from "@/lib/api/analytics";

export function usePortfolioAnalytics(wallet?: Address) {
  return useQuery({
    queryKey: ["portfolio-analytics", wallet],
    queryFn: () => {
      if (!wallet) {
        throw new Error("Wallet is required.");
      }

      return fetchPortfolioAnalytics(wallet);
    },
    enabled: Boolean(wallet),
  });
}
