/**
 * The global fetch, called as a plain function. Stored as a class field and called as
 * `this.fetchImpl(...)`, the global fetch throws "Illegal invocation" on Cloudflare Workers.
 */
export const callFetch: typeof fetch = (input, init) => fetch(input, init);
