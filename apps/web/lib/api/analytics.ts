import {
  portfolioAnalyticsSchema,
  type Address,
  type PortfolioAnalytics,
} from "@svalin-agent/shared";
import { getApiBaseUrl } from "@/lib/api/base-url";

export async function fetchPortfolioAnalytics(
  wallet: Address,
): Promise<PortfolioAnalytics> {
  const response = await fetch(`${getApiBaseUrl()}/analytics/portfolio/${wallet}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch portfolio analytics.");
  }

  return portfolioAnalyticsSchema.parse(await response.json());
}
