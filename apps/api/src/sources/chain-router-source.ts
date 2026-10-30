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
    return upstream(() => source.getOverview(wallet));
  }

  inspectRecipient(recipient: string, payer: string | null): Promise<RecipientSignals> {
    const family = detectAddressFamily(recipient);
    const source = family ? this.sources[family] : undefined;
    if (!family || !source?.inspectRecipient) {
      throw new ApiError(501, "chain_not_supported", "This instance cannot check recipients on this chain.");
    }
    return upstream(() => source.inspectRecipient!(recipient, payer));
  }
}

/**
 * A source that fails in a way it did not foresee, such as an answer cut off half-way or one that
 * is not JSON, has still failed upstream: a 502 the caller can retry and is never charged for, not
 * a 500. The original error is logged.
 */
async function upstream<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error(JSON.stringify({ level: "error", msg: "source_failed", error: String(error), stack: (error as Error)?.stack }));
    throw new ApiError(502, "upstream_error", "A data provider's answer could not be read. Try again in a minute.");
  }
}
