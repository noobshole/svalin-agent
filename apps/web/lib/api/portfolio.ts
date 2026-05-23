import {
  portfolioOverviewSchema,
  type Address,
  type PortfolioOverview,
} from "@svalin-agent/shared";
import { getApiBaseUrl } from "@/lib/api/base-url";

export async function fetchPortfolioOverview(
  wallet: Address,
): Promise<PortfolioOverview> {
  const response = await fetch(`${getApiBaseUrl()}/portfolio/${wallet}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch portfolio overview.");
  }

  return portfolioOverviewSchema.parse(await response.json()) as PortfolioOverview;
}
