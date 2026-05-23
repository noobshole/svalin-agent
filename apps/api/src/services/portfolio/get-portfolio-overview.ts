import {
  portfolioOverviewSchema,
  type Address,
  type PortfolioOverview,
} from "@svalin-agent/shared";

import { MockPortfolioSource } from "./mock-portfolio-source.js";
import { resolvePortfolioSource } from "./resolve-portfolio-source.js";

export async function getPortfolioOverview(
  wallet: Address,
): Promise<PortfolioOverview> {
  const source = resolvePortfolioSource();
  let overview: PortfolioOverview;

  try {
    overview = await source.getOverview(wallet);
  } catch (error) {
    if (process.env.PORTFOLIO_SOURCE === "file") {
      throw error;
    }

    overview = await new MockPortfolioSource().getOverview(wallet);
  }

  return portfolioOverviewSchema.parse(overview);
}
