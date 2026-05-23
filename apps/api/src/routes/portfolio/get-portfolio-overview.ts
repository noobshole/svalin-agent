import {
  portfolioOverviewSchema,
  type Address,
  type PortfolioOverview,
} from "@svalin-agent/shared";

import { getPortfolioOverview } from "../../services/portfolio/get-portfolio-overview.js";

export async function getPortfolioOverviewRoute(
  wallet: Address,
): Promise<PortfolioOverview> {
  const overview = await getPortfolioOverview(wallet);

  return portfolioOverviewSchema.parse(overview);
}
