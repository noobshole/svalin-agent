import {
  portfolioAnalyticsSchema,
  type Address,
  type PortfolioAnalytics,
} from "@svalin-agent/shared";

import { getPortfolioAnalytics } from "../../services/analytics/get-portfolio-analytics.js";

export async function getPortfolioAnalyticsRoute(
  wallet: Address,
): Promise<PortfolioAnalytics> {
  const analytics = await getPortfolioAnalytics(wallet);

  return portfolioAnalyticsSchema.parse(analytics);
}
