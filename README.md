<div align="center">

# Svalin

**Read-only portfolio risk intelligence for AI agents.**

Give Svalin a Solana wallet or a NEAR account. Get back a priced portfolio and a deterministic
risk report: a 0-100 score, an A-F grade, exposure metrics, and findings with concrete next
steps. Agents pay per call in USDC over [x402](https://x402.org) on Solana or NEAR. No API keys, no
accounts, and no way to move funds.

[![CI](https://github.com/noobshole/svalin-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/noobshole/svalin-agent/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
![Node 20.18+](https://img.shields.io/badge/node-20.18%2B-339933)
![x402 v2](https://img.shields.io/badge/payments-x402%20v2-0052FF)
![MCP](https://img.shields.io/badge/MCP-server-6E56CF)

[Free scan](https://svalin.noobshole.workers.dev) · [Features](#features) · [How it works](#how-it-works) · [Use cases](#use-cases) · [Endpoints](#endpoints) · [Use it from an agent](#use-it-from-an-agent) · [Run locally](#run-locally) · [Trust and safety](#trust-and-safety) · [Docs](#documentation)

</div>

## Features

- **Risk reports.** A 0-100 score and A-F grade from concentration, stablecoin buffer and long-tail
  exposure, with findings that explain each risk in plain English and suggest a next step.
- **Solana and NEAR.** Solana wallets (`7xKX…`) and NEAR accounts (`alice.near`) go through the
  same engine and the same endpoints.
- **Priced portfolios.** Live balances and USD prices, with each token placed in a risk category:
  stablecoin, native, liquid staking, major, meme or long-tail. Staked SOL and NEAR count as staked.
- **Briefs.** A headline, a short summary and up to three actions for explaining a wallet to a
  person, written by Claude when configured and by a template otherwise.
- **Svalin Index.** Every NEAR token with a price, graded A-F by the real money in its pools, with
  market cap, top-10 holder share and holder count. Rebuilt every few hours and published in the
  [svalin-index](https://github.com/noobshole/svalin-index) repository;
  [see it live](https://svalin.noobshole.workers.dev/ratings).
- **Pay per call.** USDC over x402 on Solana or NEAR. No keys, no accounts, no subscription.
- **MCP server.** `svalin-mcp` brings the tools to Claude, Cursor and any MCP client, with a hard
  per-call price cap and a session budget.
- **Read-only.** Svalin never asks for keys, approvals or signatures from the wallet it analyses,
  and it has no code path that moves funds.
- **Deterministic.** Same holdings, same report. No LLM computes a number, and the
  [methodology](docs/RISK_METHODOLOGY.md) is public and versioned.

## How it works

```text
agent ── GET /v1/risk/{wallet} ──────────────▶ Svalin API
agent ◀── 402 Payment Required: $0.004 USDC on Solana or NEAR
agent ── retry with PAYMENT-SIGNATURE ───────▶ paywall ── verify / settle ──▶ facilitator
agent ◀── 200 risk report ───────────────────── engine ◀── Helius (Solana) · FastNEAR + Ref Finance (NEAR)
```

Invalid addresses are rejected *before* the paywall, and failed responses (4xx/5xx), such as a
NEAR account that does not exist, are never settled, so a caller is never charged for an error.

A trimmed risk report:

```json
{
  "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "chain": "solana",
  "score": 49,
  "grade": "C",
  "level": "moderate",
  "metrics": { "totalValueUsd": 17071.37, "stablecoinPct": 7.26, "memePct": 13.47, "effectivePositions": 3.54 },
  "findings": [
    {
      "severity": "medium",
      "title": "SOL (incl. staked) is 59.8% of the portfolio",
      "summary": "A single volatile exposure above 40% means one price move dominates the outcome.",
      "action": "Consider capping SOL exposure near 40% by rotating part into stablecoins or a second, uncorrelated major.",
      "confidence": 64
    }
  ],
  "methodologyVersion": "2026-10.3"
}
```

## Use cases

Svalin is the read-only risk step in an agent workflow. Agents and people ask it how risky a
wallet is before they act, and act somewhere else.

```mermaid
flowchart TB
    S(("Svalin"))
    S --> G & W & T & R & C

    subgraph G["Agent guardrails"]
        direction TB
        G1["Check risk before<br/>a swap or rebalance"] ~~~ G2["Ask a human<br/>on a poor grade"] ~~~ G3["Spend caps per call<br/>and per session"]
    end
    subgraph W["Wallet copilots"]
        direction TB
        W1["Explain a wallet<br/>in plain English"] ~~~ W2["Scheduled<br/>risk briefs"] ~~~ W3["Staking and<br/>stablecoin tips"]
    end
    subgraph T["Treasuries and DAOs"]
        direction TB
        T1["Concentration<br/>limits"] ~~~ T2["Stablecoin<br/>buffer checks"] ~~~ T3["One report per<br/>treasury wallet"]
    end
    subgraph R["Research and analytics"]
        direction TB
        R1["Score wallets<br/>in a batch"] ~~~ R2["Spot spam and<br/>long-tail tokens"] ~~~ R3["Solana and NEAR<br/>in one format"]
    end
    subgraph C["Agent tool catalogs"]
        direction TB
        C1["Pay per call<br/>over x402"] ~~~ C2["OpenAPI and<br/>llms.txt"] ~~~ C3["One-line<br/>MCP install"]
    end
```

### Orchestration pattern: the risk gate

An orchestrator agent checks the wallet with Svalin before it hands a plan to an executor. Svalin
only reads. Execution stays with a separate tool that you control, and you choose the grade
thresholds.

```mermaid
flowchart LR
    O["Orchestrator agent<br/>(on a request or a schedule)"] -->|"svalin_risk_report<br/>$0.004"| G{"Grade?"}
    G -->|"A or B"| X["Executor agent<br/>(your own wallet tools)"]
    G -->|"C to F"| B["svalin_brief · $0.02<br/>headline and up to 3 actions"]
    B --> H{"Human<br/>approves?"}
    H -->|"yes"| X
    H -->|"no"| S(["Stop and report"])
    X -.->|"re-check the new grade"| O
```

| Pattern | Svalin calls | Cost per wallet (default prices) |
| --- | --- | --- |
| Risk gate before an action | `risk`, then `brief` when the grade is poor | $0.004 to $0.024 |
| Scheduled treasury check | `risk` for each wallet on each run | $0.004 per run |
| Wallet explainer in chat | `brief` | $0.02 |
| Batch research | `portfolio` or `risk` for each wallet | $0.002 to $0.004 |
| Trying it out | free scan | Free, 10 per hour |

Any orchestrator that can call MCP tools or make HTTP requests can use these patterns.

## Endpoints

| Endpoint | Price | Returns |
| --- | --- | --- |
| `GET /v1/demo/risk/{address}` | Free, 10 per hour per visitor | Risk report |
| `GET /v1/index/near-tokens` | Free | The Svalin Index: every NEAR token graded A-F by the real money behind its price |
| `GET /v1/portfolio/{address}` | $0.002 | Priced holdings, allocation and a risk category per token |
| `GET /v1/risk/{address}` | $0.004 | Score, grade, exposure metrics and findings with actions |
| `GET /v1/brief/{address}` | $0.02 | Headline, summary and up to 3 actions, plus the full report |
| `GET /` · `/openapi.json` · `/llms.txt` | Free | Machine-readable service description for agents |

`{address}` is a Solana address or a NEAR account ID. Prices are the defaults and can be changed
per deployment with the `PRICE_*` environment variables.

## Use it from an agent

**MCP (Claude Code, Claude Desktop, Cursor and any MCP client).** The free scan works with no
setup. Add a dedicated hot wallet holding a few dollars of USDC, on Solana or NEAR, to unlock the
paid tools.

```bash
claude mcp add svalin -e SVALIN_API_URL=https://YOUR-SVALIN-API -- npx -y svalin-mcp
```

Tools, configuration and spend limits are documented in [packages/mcp](packages/mcp#readme).

**Any x402 client (TypeScript):**

```ts
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const pay = wrapFetchWithPayment(fetch, new x402Client().register("solana:*", new ExactSvmScheme(signer)));
const report = await (await pay(`https://YOUR-SVALIN-API/v1/risk/${wallet}`)).json();
```

## Run locally

Requires Node 20.18+ and pnpm 10.

```bash
pnpm install
cp .env.example .env      # works as-is: sample data, payments off
pnpm build
pnpm dev                  # API on :4000, website on :3000
```

Open http://localhost:3000 and scan any Solana address or NEAR account. Without
`HELIUS_API_KEY` the API serves clearly labelled sample data, and it refuses to start in production
that way. Add a free [Helius](https://dashboard.helius.dev) key to `.env` for live data; NEAR data
needs no key.

To try the paywall, set `PAY_TO_SOLANA` and/or `PAY_TO_NEAR` with `X402_ENV=testnet` and call a
paid endpoint: you get a `402` with a `PAYMENT-REQUIRED` header offering Solana devnet and NEAR
testnet USDC.

```bash
pnpm test        # risk engine, Helius and NEAR mapping, paywall, facilitators, rate limiting, narrator, MCP end-to-end payment
pnpm typecheck
```

The MCP end-to-end test runs the whole payment path offline: MCP tool call, x402 client signing a
real NEAR USDC transfer, API paywall, facilitator verify and settle, handler, ledger entry.

## Project structure

| Path | What it is |
| --- | --- |
| `apps/api` | Hono API: Solana portfolios (Helius) and NEAR portfolios (FastNEAR, Ref Finance), deterministic risk engine, x402 paywall (Solana and NEAR USDC), payments ledger, OpenAPI and `llms.txt` |
| `apps/web` | Next.js landing page and free wallet scanner |
| `packages/mcp` | `svalin-mcp`: MCP server with an auto-paying x402 client and hard spend caps |
| `packages/shared` | Zod schemas: the single contract shared by the API, the website and the MCP server |
| `packages/chain-config` | Chains, x402 networks (CAIP-2), facilitators, curated token registry |
| `supabase/migrations` | Database schema, including the `api_payments` ledger |
| `docs/` | Risk methodology and deployment guide |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the request pipeline and module boundaries.

## Trust and safety

| Guarantee | How it is enforced |
| --- | --- |
| Cannot move funds | No signing, approval or transfer code for analysed wallets; the manifest declares `canMoveFunds: false` |
| Never charged for errors | Address validation runs before the paywall; payments settle only on a successful response |
| No fake data in production | The API refuses to start in production without a live data source |
| Bounded agent spending | `svalin-mcp` enforces a per-call price cap and a per-session budget |
| Free tier cannot be abused | Per-visitor and global daily limits, keyed on addresses the caller cannot forge |
| Deterministic scoring | The risk engine has no I/O and no LLM; methodology changes bump a version number |

Found a security issue? Please report it privately through a
[security advisory](https://github.com/noobshole/svalin-agent/security/advisories/new) rather than a
public issue.

## Deploy

- **API:** Cloudflare Workers (using [`apps/api/wrangler.toml`](apps/api/wrangler.toml)), Render
  (New → Blueprint, using [`render.yaml`](render.yaml)) or any container host using the root
  `Dockerfile`.
- **Website:** a static site (`apps/web`), deployed to Cloudflare with
  [`apps/web/wrangler.toml`](apps/web/wrangler.toml) or to any static host.
- **MCP server:** npm and the official MCP Registry.

Step-by-step instructions, with a test after each step, are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Limitations

- Wallet analysis covers Solana and NEAR.
- On NEAR, a token outside the curated registry is valued at no more than its Ref Finance pools
  could pay out, and one with no real pool counts as unpriced, so an account full of airdropped
  junk shows low data coverage rather than a fake fortune. Solana prices come from Helius as
  quoted.
- The cache and the free-tier limits are held in memory, so a container deployment runs as a
  single instance. On Cloudflare Workers the free-tier limits live in a Durable Object instead.
- Reports describe current holdings only.

## Documentation

| Document | For |
| --- | --- |
| [Risk methodology](docs/RISK_METHODOLOGY.md) | How scores, grades and findings are computed |
| [Architecture](ARCHITECTURE.md) | Request pipeline, boundaries and configuration guards |
| [Deployment](docs/DEPLOYMENT.md) | Running your own API, website and MCP server |
| [MCP server](packages/mcp#readme) | Installing and configuring `svalin-mcp` |

## License

[Apache License 2.0](LICENSE); see [NOTICE](NOTICE). Svalin reports exposures; it is not
financial advice and does not tell anyone what to buy.
