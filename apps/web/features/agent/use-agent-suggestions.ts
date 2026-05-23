"use client";

import type { Address } from "@svalin-agent/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchAgentSuggestions } from "@/lib/api/agent";

export function useAgentSuggestions(wallet?: Address) {
  return useQuery({
    queryKey: ["agent-suggestions", wallet],
    queryFn: () => {
      if (!wallet) {
        throw new Error("Wallet is required.");
      }

      return fetchAgentSuggestions(wallet);
    },
    enabled: Boolean(wallet),
  });
}
