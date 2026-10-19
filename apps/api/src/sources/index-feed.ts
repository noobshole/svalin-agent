import { ApiError } from "../lib/errors.js";
import { callFetch } from "../lib/fetch.js";

type FetchLike = typeof fetch;

/** Something that returns the latest published index edition as JSON text. */
export interface IndexFeed {
  latest(): Promise<string>;
}

/**
 * The Svalin Index is built on a schedule (scripts/near-index.ts) and published as a static file.
 * The API serves the latest edition as-is: it is too large to rebuild inside a request, and serving
 * the published file means every edition anyone sees is one that was recorded.
 */
export class RemoteIndexFeed implements IndexFeed {
  private cached: { at: number; body: Promise<string> } | undefined;

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
}
