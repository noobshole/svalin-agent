# Architecture

pnpm workspace + Turborepo. One API, one web app, one MCP server, two shared packages.

```text
                 ┌──────────────┐  free demo (from the browser)
 human ─────────▶│ apps/web     │─────────────────────────────┐
                 └──────────────┘                             ▼
                 ┌──────────────┐  x402-paying fetch   ┌──────────────┐  Solana  ┌──────────────────┐
 Claude/Cursor ─▶│ packages/mcp │─────────────────────▶│   apps/api   │─────────▶│ Helius DAS       │
                 └──────────────┘                      │  (Hono)      │  NEAR    ├──────────────────┤
 any x402 agent ──────────────────────────────────────▶│              │─────────▶│ FastNEAR, Ref,   │
                                                       │              │          │ NEAR RPC         │
                                                       │              │ verify/  ├──────────────────┤
                                                       │              │ settle ─▶│ facilitators     │
                                                       └──────┬───────┘          └──────────────────┘
                                                              │ settled payments
                                                              ▼
                                                     logs + Supabase api_payments
```

## API request pipeline (`apps/api/src/app.ts`)

1. `secureHeaders`, `cors`, JSON request log.
2. **Address gate** on `/v1/*`: rejects malformed addresses (400) and chains the active source
   cannot serve (501) *before* the paywall, so nobody is asked to pay for a request that can only
   fail. In production with no `payTo` configured, paid routes return 503.
3. **x402 paywall** (`payments/x402.ts`): `@x402/hono` middleware. Each paid route accepts
   exact-scheme USDC on every configured network (Solana via `ExactSvmScheme`, NEAR via
   `ExactNearScheme`, where the payer signs a NEP-366 delegated `ft_transfer` and the facilitator's
   relayer pays the gas). Routes are registered as `GET /v1/<route>/:address` and declare Bazaar
   discovery metadata (descriptions capped at 500 characters, the CDP facilitator's limit) so
   facilitators can list them. The middleware only settles when the handler returns < 400.
   Facilitators are tried in order (`facilitatorClients`), and each network goes to the first one
   that supports it: Coinbase's CDP facilitator when `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` are set
   (settling Solana through it lists the API in the Bazaar), the NEAR facilitator when
   `PAY_TO_NEAR` is set (FastNEAR reference facilitator, API key in `X-API-Key`), then the default
   Solana facilitator (PayAI on mainnet, x402.org on testnet). A facilitator that fails at startup
   is skipped, so bad keys for one never take the others down.
4. **Handlers**: `getOverview` (TTL cache + in-flight de-duplication) → `buildRiskReport` →
   optional `Narrator`.
5. **Ledger** (`payments/ledger.ts`): an `onAfterSettle` hook writes every settled payment as a JSON
   log line and, if configured, a row in `public.api_payments`.

## Boundaries

- `PortfolioSource` (`sources/portfolio-source.ts`) is the only way data enters.
  `ChainRouterSource` picks the source by address: Helius for Solana, `NearPortfolioSource` for
  NEAR (FastNEAR balances, Ref Finance prices with a 60-second cache, validator stakes read over
  NEAR RPC). Mock serves both for dev/tests. A new data source implements this interface without
  touching routes or the engine.
- On NEAR a quoted price alone is not trusted, because anyone can send an account a token whose
  Ref Finance price is fake or stale. A token outside the curated registry is valued at no more
  than the registry tokens (wNEAR, stablecoins, liquid staking and so on) in its Ref pools, and
  counts as unpriced if they hold none (`poolDepth` in `sources/near-source.ts`). The pool list
  (about 900 KB) is fetched only for accounts that need it and cached for five minutes. If it
  cannot be read the request fails, so the caller is not charged for a report that might be wrong.
- The Svalin Index is built outside the API: `apps/api/scripts/near-index.ts` runs on a schedule (every few hours) in the
  [svalin-index](https://github.com/noobshole/svalin-index) repository's workflow, grades every
  Ref-priced NEAR token with the same `poolDepth` (`src/ratings/near-tokens.ts`), adds market cap
  and holder data (cached between runs, since the public NEAR APIs rate limit bursts) and publishes
  the edition to that repository's `latest` branch. `GET /v1/index/near-tokens` serves the latest
  edition as published (`sources/index-feed.ts`, cached ten minutes), so the API never rebuilds it
  inside a request.
- Addresses (`packages/shared/src/address.ts`): Solana base58 or a NEAR account ID. Anything
  lowercase can be a NEAR account name, so a mistyped name passes the format gate; the NEAR
  source answers 404 for accounts that do not exist, and the payment is not settled. A token is
  not a wallet either: the NEAR source answers 422 `token_address` for a contract in Ref Finance's
  price list, with its Svalin Index grade worked out from the same pools, and the Helius source
  reads the account's owner alongside the first balance page and answers 422 for a token mint,
  token account or program. None of these is settled.
- `risk/engine.ts` is pure and deterministic: same holdings, same report. No I/O, no LLM.
- `narrate/narrator.ts` turns a finished report into prose. The LLM never sees an instruction to
  compute anything, its output is schema-checked, and any failure falls back to the template.
- `packages/shared` holds Zod schemas; types are `z.infer` of them. API responses, the web app
  and the MCP all validate against the same contract.

## Free demo rate limiting (`lib/client-ip.ts`, `lib/rate-limit.ts`)

The demo is limited per visitor per hour plus a global daily cap. The visitor key is never the
first `X-Forwarded-For` entry, because the caller chooses that. It is, in order:

1. The visitor IP passed by a server-side frontend in `x-svalin-client-ip`, accepted only with the
   matching `WEB_FORWARDING_SECRET` (compared in constant time). The bundled website is static
   and calls the API from the browser, so it needs none of this.
2. On Cloudflare Workers, `CF-Connecting-IP`.
3. The `X-Forwarded-For` entry added by our own hosting proxy, counted `TRUSTED_PROXY_HOPS` from
   the right.
4. The socket's remote address.

IPv6 addresses are grouped by their /64 network (`visitorKey`), the block a single subscriber
usually holds, so rotating addresses inside it does not reset the limit.

## Configuration guards (`env.ts`)

- Production refuses to boot on mock data.
- `payTo` addresses are validated per chain family at startup.
- Payment environment defaults to `testnet` outside production and `mainnet` in production.
- `WEB_FORWARDING_SECRET` must be at least 24 characters.
- Locally, `index.ts` reads the repo-root `.env`; variables set by the host take precedence. The
  Docker image never contains a `.env`.

## LLM narrator

`AnthropicNarrator` calls Claude Haiku 5.5 by default with low effort and a JSON-schema structured
output. Any non-`end_turn` stop (refusal, truncation), HTTP error or schema mismatch falls back to
the template narrator, so `/v1/brief` always returns a valid brief and the caller is never charged
for an error.

## Cloudflare Workers (`src/worker.ts`, `wrangler.toml`)

`index.ts` serves the app with Node; `worker.ts` serves the same `createApp` on Cloudflare
Workers with `nodejs_compat`. On Workers:

- Settings arrive as bindings and go through the same `loadConfig` guards.
- The free-demo key is `CF-Connecting-IP`, which Cloudflare sets and callers cannot override.
- Free-demo counts live in one Durable Object (`lib/durable-demo-limiter.ts`, binding
  `DEMO_LIMITER`), because Workers run many isolates and in-memory counts are never shared. It
  applies the same rule as the in-memory limiter (`decideDemoLimit`), persists counts to its
  storage, and fails closed (the demo pauses) if it cannot be reached.
- Payment facilitators load inside the first paid request (`initialization: "first-paid-request"`),
  because I/O started in one request cannot be awaited by another.
- Bazaar discovery metadata is off: its schema validation generates code at runtime, which
  Workers forbid.
- `fetch` is always called as a plain function (`lib/fetch.ts`); stored on an object and called as
  a method, it throws on Workers.

## Scaling notes

On a container host the cache and demo rate limiter are in-memory. That is fine for a single
replica. For more, pass a shared `DemoLimiter` (as Workers do) and move the cache to
Redis/Upstash; the interfaces are small (`TtlCache`, `DemoLimiter`).
