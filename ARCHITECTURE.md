# Architecture

pnpm workspace + Turborepo. One API, one web app, one MCP server, two shared packages.

```text
                 ┌──────────────┐  free demo (server-side fetch)
 human ─────────▶│  apps/web    │─────────────────────────────┐
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
- Addresses (`packages/shared/src/address.ts`): Solana base58 or a NEAR account ID. Anything
  lowercase can be a NEAR account name, so a mistyped name passes the format gate; the NEAR
  source answers 404 for accounts that do not exist, and the payment is not settled.
- `risk/engine.ts` is pure and deterministic: same holdings, same report. No I/O, no LLM.
- `narrate/narrator.ts` turns a finished report into prose. The LLM never sees an instruction to
  compute anything, its output is schema-checked, and any failure falls back to the template.
- `packages/shared` holds Zod schemas; types are `z.infer` of them. API responses, the web app
  and the MCP all validate against the same contract.

## Free demo rate limiting (`lib/client-ip.ts`, `lib/rate-limit.ts`)

The demo is limited per visitor per hour plus a global daily cap. The visitor key is never the
first `X-Forwarded-For` entry, because the caller chooses that. It is, in order:

1. The visitor IP passed by the web app in `x-svalin-client-ip`, accepted only with the matching
   `WEB_FORWARDING_SECRET` (compared in constant time).
2. The `X-Forwarded-For` entry added by our own hosting proxy, counted `TRUSTED_PROXY_HOPS` from
   the right.
3. The socket's remote address.

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

## Scaling notes

The cache and demo rate limiter are in-memory. That is fine for a single replica. For more,
move both to Redis/Upstash; the interfaces are small (`TtlCache`, `DemoRateLimiter`).
