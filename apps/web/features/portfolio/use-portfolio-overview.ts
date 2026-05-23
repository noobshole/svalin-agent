"use client";

import type { Address } from "@svalin-agent/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchPortfolioOverview } from "@/lib/api/portfolio";

export function usePortfolioOverview(wallet?: Address) {
  return useQuery({
    queryKey: ["portfolio-overview", wallet],
    queryFn: () => {
      if (!wallet) {
        throw new Error("Wallet is required.");
      }

      return fetchPortfolioOverview(wallet);
    },
    enabled: Boolean(wallet),
  });
}
