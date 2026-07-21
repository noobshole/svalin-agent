# Svalin Agent

Svalin Agent is a Web3 portfolio dashboard designed to make portfolio data legible to AI agents as well as to people. The current product is read-only: it aggregates a portfolio-shaped data model, provides analytics, and produces optimization suggestions across Ethereum, Base, and Solana. It does not execute transactions, request token approvals, or automate wallet actions.

## Prerequisites

- Node.js 20.18 or later
- pnpm 10.8.1

The repository pins its package manager through `packageManager` in the root `package.json`.

## Setup

```bash
pnpm install
```

Copy `.env.example` to `.env`, then start with the file-backed portfolio source:

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

### Environment variables

For zero-service local development, no secrets are required. Set `PORTFOLIO_SOURCE=file` to use the committed portfolio snapshot under `apps/api/src/adapters/db/data`. It is also the API default when the variable is unset.

Useful local variables:

- `PORTFOLIO_SOURCE=file` uses the bundled snapshot data. `mock` selects the in-code mock source.
- `NEXT_PUBLIC_API_BASE_URL` is optional locally. The web app falls back to `http://127.0.0.1:4000` when it is absent.
- `ALLOWED_ORIGINS` is optional locally. It restricts browser access to the API and defaults to common localhost ports.
- `PORT` is optional and defaults to `4000` for the API.

The following variables are placeholders for future integrations and are not required for the current file/mock flow: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `RPC_ETHEREUM_MAINNET`, and `RPC_BASE_MAINNET`.

## Development

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
```

`pnpm dev` runs `turbo run dev --parallel`, which starts the API watcher and the Next.js dev server. `pnpm build` and `pnpm typecheck` run the corresponding workspace tasks through Turborepo. The current `lint` scripts are placeholders, so `pnpm lint` does not yet run a real lint rule set.

## Repository layout

- `apps/api` - Node API server. HTTP routes delegate to services, which delegate to data or chain adapters.
- `apps/web` - Next.js App Router dashboard, wallet UI, analytics, and agent suggestion panels.
- `packages/shared` - shared TypeScript types and Zod response schemas.
- `packages/chain-config` - Ethereum, Base, and Solana metadata plus the test contract/program registry.
- `supabase/migrations` - the initial Postgres schema for wallet profiles, portfolio snapshots, and agent recommendations.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the API flow and package boundaries.

## Current status

Real today:

- The API serves portfolio, analytics, contract-registry, agent-capability, and agent-suggestion endpoints.
- Ethereum, Base, and Solana are present in the shared chain model and agent capability response.
- The web app has an injected EVM wallet-connect UI used to scope dashboard requests.
- The app is read-only; transaction execution and token approval flows are intentionally absent.

Mocked or synthetic today:

- Portfolio data comes from a committed JSON snapshot or the in-code mock source, not live chain/indexer data.
- Performance history is derived synthetically from the current portfolio total.
- Agent suggestions are deterministic rules over portfolio holdings, not LLM or LangGraph output.
- The wallet UI is not yet connected to a live portfolio provider or authenticated account model, and there is no Solana wallet-connect flow.
- The chain contract registry contains test placeholders; `isTestContract` identifies them as such.
- Supabase migrations exist, but the current API uses the file/mock portfolio source rather than a Supabase adapter.
