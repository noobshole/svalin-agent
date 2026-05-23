import type { Address, PortfolioOverview } from "@svalin-agent/shared";

export interface PortfolioSource {
  getOverview(wallet: Address): Promise<PortfolioOverview>;
}
