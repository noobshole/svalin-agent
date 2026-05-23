import {
  chainContractRegistrySchema,
  type ChainContractRegistry,
} from "@svalin-agent/shared";
import { getApiBaseUrl } from "@/lib/api/base-url";

export async function fetchContractRegistry(): Promise<ChainContractRegistry> {
  const response = await fetch(`${getApiBaseUrl()}/contracts`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch contract registry.");
  }

  return chainContractRegistrySchema.parse(await response.json());
}
