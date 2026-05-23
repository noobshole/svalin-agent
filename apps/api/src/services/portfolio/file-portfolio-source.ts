import {
  portfolioOverviewSchema,
  type Address,
  type PortfolioOverview,
} from "@svalin-agent/shared";

import { readPortfolioSnapshots } from "../../adapters/db/read-portfolio-snapshots.js";
import type { PortfolioSource } from "./portfolio-source.js";

export class FilePortfolioSource implements PortfolioSource {
  async getOverview(wallet: Address): Promise<PortfolioOverview> {
    const snapshots = await readPortfolioSnapshots();
    const match = snapshots.find(
      (snapshot) => snapshot.wallet.toLowerCase() === wallet.toLowerCase(),
    );

    if (!match) {
      throw new Error(`No portfolio snapshot found for wallet ${wallet}.`);
    }

    return portfolioOverviewSchema.parse(match);
  }
}
