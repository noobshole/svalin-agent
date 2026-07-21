# Architecture

Svalin Agent is a pnpm workspace managed by Turborepo. Runtime code is split between a Node API in `apps/api`, a Next.js App Router application in `apps/web`, and shared packages for schemas, types, and chain metadata.

## API layering

`apps/api/src` follows a route -> service -> adapter pattern.

- Routes are the HTTP-facing boundary. They receive validated route inputs from `create-api-server.ts`, call a service, and validate the response contract.
- Services hold application behavior such as source selection, analytics generation, and rule-based suggestions.
- Adapters read or call external boundaries. The current portfolio adapter is file-backed; the Supabase directory currently contains migrations, not a runtime API adapter.

### Portfolio overview example

The `GET /portfolio/:wallet` path in `apps/api/src/server/create-api-server.ts` calls `getPortfolioOverviewRoute` in `apps/api/src/routes/portfolio/get-portfolio-overview.ts`. The route delegates to `getPortfolioOverview` in `apps/api/src/services/portfolio/get-portfolio-overview.ts` and returns `portfolioOverviewSchema.parse(overview)`.

The service resolves a `PortfolioSource`, calls `source.getOverview(wallet)`, and validates the result again. When the source is not explicitly `file`, it falls back to `MockPortfolioSource` if the selected source fails.

With `PORTFOLIO_SOURCE=file`, `resolve-portfolio-source.ts` returns `FilePortfolioSource`. Its `getOverview` implementation calls the adapter function `readPortfolioSnapshots` in `apps/api/src/adapters/db/read-portfolio-snapshots.ts`. That adapter locates `portfolio-snapshots.json`, reads it with Node file APIs, parses JSON, and validates each wallet snapshot before returning it.

The path is therefore:

```text
GET /portfolio/:wallet
  -> getPortfolioOverviewRoute
  -> getPortfolioOverview service
  -> FilePortfolioSource
  -> readPortfolioSnapshots adapter
  -> portfolio-snapshots.json
```

## PortfolioSource selection

`apps/api/src/services/portfolio/portfolio-source.ts` defines the boundary used by portfolio services:

```ts
export interface PortfolioSource {
  getOverview(wallet: Address): Promise<PortfolioOverview>;
}
```

`resolve-portfolio-source.ts` reads `PORTFOLIO_SOURCE` and chooses the implementation:

- `mock` returns `MockPortfolioSource`.
- Any other value, including an unset variable, returns `FilePortfolioSource`.

This is deliberate: it keeps the service independent from where portfolio data comes from. A future live indexer or Supabase source can implement the same interface without changing routes, analytics, or agent services.

## Shared validation boundary

`packages/shared` exports TypeScript types and Zod schemas such as `portfolioOverviewSchema`, `portfolioAnalyticsSchema`, `agentSuggestionsResponseSchema`, and `agentCapabilitiesResponseSchema`.

The API validates values at multiple boundary points instead of trusting internal casts:

- `readPortfolioSnapshots.ts` validates every parsed wallet snapshot with `portfolioOverviewSchema.parse(...)`.
- `FilePortfolioSource` validates its selected snapshot before returning it.
- `getPortfolioOverview.ts` validates the service result.
- `get-portfolio-overview.ts` validates the route response before it is serialized.
- Other routes apply the same pattern for analytics, suggestions, contracts, and agent capabilities.

The web API helpers import the same schemas and parse JSON responses after `fetch`. This gives the web and API one response contract, and makes malformed data fail at the boundary where it is received.

## Chain configuration and agent capabilities

`packages/chain-config/src/index.ts` exports `supportedChains` and `contractRegistry`.

`supportedChains` contains Ethereum, Base, and Solana metadata, including chain family, RPC URL, native currency, explorer URL, and feature flags for portfolio, analytics, and agent support. `contractRegistry` contains the corresponding contract or program entries and currently marks them as test contracts.

The agent capability service in `apps/api/src/services/agent/get-agent-capabilities.ts` iterates over `supportedChains`. For each chain it checks both the `agent` feature flag and whether `contractRegistry` contains an entry whose name includes `Agent`. That result determines the reported readiness status. The service also exposes chain-specific supported actions; Solana includes `staking-review` in addition to portfolio, risk, yield, and recommendation actions.

`get-agent-capabilities.ts` in the agent routes directory validates this service result with `agentCapabilitiesResponseSchema`, and `create-api-server.ts` exposes it at `GET /agent/capabilities`.

## Current constraints

- Portfolio reads are file/mock-backed, not live on-chain or indexer-backed.
- Analytics performance points are synthetic.
- Agent suggestions are rule-based and read-only.
- The EVM wallet component provides an injected wallet connection for dashboard scoping, but it is not yet a live portfolio-data or authentication integration.
- No transaction execution path exists.
