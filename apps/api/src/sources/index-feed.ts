import type { RatedTokenRow } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";

type FetchLike = typeof fetch;

/** The latest edition, parsed once for single-token lookups. */
export type ParsedIndex = { generatedAt: string; methodology: string; byContract: Map<string, RatedTokenRow> };

/** Something that returns the latest published index edition as JSON text. */
export interface IndexFeed {
  latest(): Promise<string>;
  /** The latest edition parsed, reused while the edition is unchanged. Rejects when it cannot be fetched. */
  parsed?(): Promise<ParsedIndex>;
}

export function parseIndex(text: string): ParsedIndex {
  const body = JSON.parse(text) as { generatedAt?: string; methodology?: string; rows?: RatedTokenRow[] };
  return {
    generatedAt: body.generatedAt ?? "",
    methodology: body.methodology ?? "",
    byContract: new Map((body.rows ?? []).map((row) => [row[0], row])),
  };
}

/**
 * One token's row in the latest edition (undefined if it is not graded there), with the edition.
 * Rejects when the edition cannot be fetched, so callers can tell "not graded" from "unavailable".
 */
export async function indexedToken(feed: IndexFeed, contract: string): Promise<{ index: ParsedIndex; row: RatedTokenRow | undefined }> {
  const index = feed.parsed ? await feed.parsed() : parseIndex(await feed.latest());
  return { index, row: index.byContract.get(contract) };
}

/**
 * The Svalin Index is built on a schedule (scripts/near-index.ts) and published as a static file.
 * The API serves the latest edition as-is: it is too large to rebuild inside a request, and serving
 * the published file means every edition anyone sees is one that was recorded.
 */
export class RemoteIndexFeed implements IndexFeed {
  private cached: { at: number; body: Promise<string> } | undefined;
  private parsedCache: { body: Promise<string>; parsed: Promise<ParsedIndex> } | undefined;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: FetchLike = callFetch,
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  latest(): Promise<string> {
    if (this.cached && this.now() - this.cached.at < this.ttlMs) return this.cached.body;
    const body = this.fetchImpl(this.url, { signal: AbortSignal.timeout(10_000) }).then(
      (response) => {
        if (!response.ok) throw new Error(`index feed returned ${response.status}`);
        return response.text();
      },
    );
    this.cached = { at: this.now(), body };
    body.catch(() => {
      if (this.cached?.body === body) this.cached = undefined;
    });
    return body.catch(() => {
      throw new ApiError(503, "index_unavailable", "The token index is not available right now.", "Retry in a few minutes.");
    });
  }

  /** Parsed once per fetched edition, so lookups do not re-read the whole file. */
  parsed(): Promise<ParsedIndex> {
    const body = this.latest();
    const source = this.cached?.body ?? body;
    if (!this.parsedCache || this.parsedCache.body !== source) {
      this.parsedCache = { body: source, parsed: body.then(parseIndex) };
    }
    return this.parsedCache.parsed;
  }
}
