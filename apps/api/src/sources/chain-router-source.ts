import { detectAddressFamily, type ChainFamily, type PortfolioOverview } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import type { RecipientSignals } from "../risk/check.js";
import type { PortfolioSource } from "./portfolio-source.js";

/** Serves each wallet from the live source for its chain: Helius for Solana, FastNEAR for NEAR. */
export class ChainRouterSource implements PortfolioSource {
  constructor(private readonly sources: Partial<Record<ChainFamily, PortfolioSource>>) {}

  supports(family: ChainFamily) {
    return Boolean(this.sources[family]?.supports(family));
  }

  getOverview(wallet: string): Promise<PortfolioOverview> {
    const family = detectAddressFamily(wallet);
    const source = family ? this.sources[family] : undefined;
    if (!family || !source) {
      throw new ApiError(501, "chain_not_supported", "This wallet's chain is not supported.");
    }
    return source.getOverview(wallet);
  }

  inspectRecipient(recipient: string, payer: string | null): Promise<RecipientSignals> {
    const family = detectAddressFamily(recipient);
    const source = family ? this.sources[family] : undefined;
    if (!family || !source?.inspectRecipient) {
      throw new ApiError(501, "chain_not_supported", "This instance cannot check recipients on this chain.");
    }
    return source.inspectRecipient(recipient, payer);
  }
}
