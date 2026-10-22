import type { RatedTokenRow } from "@svalin-agent/shared";

import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";

type FetchLike = typeof fetch;

/** Something that returns the latest published index edition as JSON text. */
export interface IndexFeed {
  latest(): Promise<string>;
  /** One token's row in the latest edition, or undefined if it is not graded there. */
  row?(contract: string): Promise<RatedTokenRow | undefined>;
}

/**
 * The Svalin Index is built on a schedule (scripts/near-index.ts) and published as a static file.
 * The API serves the latest edition as-is: it is too large to rebuild inside a request, and serving
 * the published file means every edition anyone sees is one that was recorded.
 */
export class RemoteIndexFeed implements IndexFeed {
  private cached: { at: number; body: Promise<string> } | undefined;
  private rows: { body: Promise<string>; byContract: Promise<Map<string, RatedTokenRow>> } | undefined;

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

  /**
   * One token's row, parsed once per fetched edition so lookups do not re-read the whole file.
   * Rejects when the edition cannot be fetched, so callers can tell "not graded" from "unavailable".
   */
  async row(contract: string): Promise<RatedTokenRow | undefined> {
    const body = this.latest();
    const source = this.cached?.body ?? body;
    let rows = this.rows;
    if (!rows || rows.body !== source) {
      rows = {
        body: source,
        byContract: body.then((text) => {
          const parsed = (JSON.parse(text) as { rows?: RatedTokenRow[] }).rows ?? [];
          return new Map(parsed.map((row) => [row[0], row]));
        }),
      };
      this.rows = rows;
    }
    return (await rows.byContract).get(contract);
  }
}
