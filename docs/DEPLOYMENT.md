# Deployment

How to run your own Svalin: the API, the website and the MCP server. Each step is done once.
Steps marked **(test)** confirm the previous step worked.

## 1. Accounts and wallets

- [ ] A [Helius](https://dashboard.helius.dev) API key for live Solana data (the free plan works).
      NEAR data (FastNEAR, Ref Finance and NEAR RPC) needs no key.
- [ ] Two **receiving wallets**, used only for Svalin payments:
  - a Solana wallet (Phantom or Solflare). Its public address becomes `PAY_TO_SOLANA`.
  - a NEAR account (for example `svalin-pay.near`, created in Meteor or MyNearWallet). Its
    account ID becomes `PAY_TO_NEAR`. Use a `.testnet` account while testing. A NEAR account
    can only receive a token after registering with it once, so send it a little USDC first
    (on testnet, the faucet at faucet.circle.com does this).

  These are *receiving* addresses. The API only ever needs the public address, never a key.
- [ ] A **NEAR facilitator API key**. NEAR payments settle through the FastNEAR reference
      facilitator, which issues one key per network and receiving account. Request access with
      the [access request form](https://github.com/fastnear/x402-facilitator/issues/new?template=access_request.yml)
      (never put a private key or API key in that public issue). The key becomes
      `NEAR_FACILITATOR_API_KEY`. Without it, Svalin still asks for NEAR payments, but they cannot
      settle.
- [ ] Optional: an Anthropic API key for LLM-written briefs (Claude Haiku 5.5 by default).
- [ ] Optional: a Coinbase Developer Platform **secret API key** (portal.cdp.coinbase.com). With
      it, Solana payments settle through Coinbase's CDP facilitator, which makes the API
      discoverable in the x402 Bazaar.
- [ ] A **web forwarding secret**: a random string of at least 24 characters shared by the API
      and the website, so each website visitor gets their own free-scan allowance. Render's
      Blueprint (step 2) generates one for you; otherwise use a password manager.
- [ ] Optional: a Supabase project for the payments ledger. In the SQL editor, run every file in
      `supabase/migrations/` in name order, then copy the project URL and service-role key.

## 2. Deploy the API

The API runs on Cloudflare Workers or as a Docker container on Render or any other container
host.

**On Cloudflare Workers:**

- [ ] Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → choose
      this repository.
- [ ] Project name `svalin-api` (it must match `name` in `apps/api/wrangler.toml`), root directory
      `apps/api`, and:

  ```text
  Build command:  pnpm install --frozen-lockfile --filter "@svalin-agent/api..." && pnpm --filter "@svalin-agent/api^..." build
  Deploy command: npx wrangler@4.146.0 deploy
  ```

  Or deploy from your own computer: `npx wrangler@4.146.0 login`, then
  `pnpm build && pnpm --filter @svalin-agent/api run deploy:worker`.
- [ ] After the first deploy, open the Worker's **Settings → Variables and Secrets**. Add
      `HELIUS_API_KEY` as a **Secret**, and `PAY_TO_SOLANA` and `PUBLIC_BASE_URL` (the Worker's
      `https://svalin-api.<your-subdomain>.workers.dev` address) as text variables. Later add
      `PAY_TO_NEAR`, and `NEAR_FACILITATOR_API_KEY` as a Secret. `NODE_ENV` and `X402_ENV` come
      from `wrangler.toml`.

How Workers differ from a container host:

- Workers Free allows 10 ms of CPU time per request. Most reports use under 2 ms. The first
  NEAR report each minute parses Ref Finance's price list (about 5–8 ms), and a very large
  wallet can exceed the limit and fail; a failed request is never charged. Workers Paid raises
  the limit.
- The free-scan limit is keyed on `CF-Connecting-IP`, which callers cannot set, so
  `TRUSTED_PROXY_HOPS` is not used.
- The free-scan limits are kept in one Durable Object (binding `DEMO_LIMITER`), so every Worker
  instance shares the same counts. The portfolio cache stays in each instance's memory.
- Payment facilitators are loaded inside the first paid request, and Bazaar discovery metadata
  is off: its schema check generates code at runtime, which Workers forbid.
- The `"svalin_api_started"` log line appears on the first request after each deploy, in the
  Worker's **Logs** tab.

**On Render:** Dashboard → **New** → **Blueprint** → choose this repository. `render.yaml` sets up
the Docker build, the health check, a single instance, testnet payments and a generated
`WEB_FORWARDING_SECRET`, then asks for the values it cannot know. Leave the optional ones empty,
and leave `PAY_TO_NEAR` empty until you have a NEAR facilitator key.

`render.yaml` selects Render's free instance type, which sleeps after 15 minutes without traffic
and takes about a minute to wake. For production, choose a paid instance type (service →
Settings → Instance Type).

**On any other container host (Railway, Fly.io, …):**

- [ ] New service from this repository, using the root `Dockerfile`.
- [ ] Health check path `/health`, and a single instance (the cache and demo limits are in memory).
- [ ] Environment variables:

  ```text
  NODE_ENV=production
  PUBLIC_BASE_URL=https://<your-api-domain>
  HELIUS_API_KEY=...
  PAY_TO_SOLANA=...
  PAY_TO_NEAR=...
  NEAR_FACILITATOR_API_KEY=...  # from the access request; one per network and payee
  X402_ENV=testnet              # switch to mainnet in step 5 (needs a mainnet facilitator key)
  ALLOWED_ORIGINS=https://<your-web-domain>
  WEB_FORWARDING_SECRET=...     # the same value goes on the website
  TRUSTED_PROXY_HOPS=1          # proxies in front of the API; 1 on most hosts
  ANTHROPIC_API_KEY=...         # optional
  SUPABASE_URL=...              # optional
  SUPABASE_SERVICE_ROLE_KEY=... # optional
  CDP_API_KEY_ID=...            # optional
  CDP_API_KEY_SECRET=...        # optional
  ```

  Prices default to $0.002 (portfolio), $0.004 (risk) and $0.02 (brief). Override them with
  `PRICE_PORTFOLIO_USD`, `PRICE_RISK_USD` and `PRICE_BRIEF_USD`.

**Then, on any host:**

- [ ] **(test)** The first log line (on Workers, after the first request) is
      `"svalin_api_started"` with `"facilitators"` listing the Solana facilitator (`"x402.org"`
      on testnet, `"payai"` on mainnet), plus `"near"` once `PAY_TO_NEAR` is set and `"cdp"`
      first if you set CDP keys, and `"webVisitorForwarding":"on"` once the website is set up. A line saying `Failed to fetch supported kinds from facilitator` means that
      facilitator is unreachable or its keys are wrong; the others keep working.
- [ ] **(test)** `https://<api>/` shows `"payments": { "enabled": true, ... }` with Solana, and
      NEAR too once `PAY_TO_NEAR` is set.
- [ ] **(test)** `https://<api>/v1/demo/risk/<any Solana address>` returns a report with
      `"dataSource": "helius"`, and `https://<api>/v1/demo/risk/<any NEAR account>` one with
      `"dataSource": "fastnear"`.
- [ ] **(test)** `https://<api>/v1/risk/<address>` returns HTTP 402.
- [ ] **(test)** The free-scan limit cannot be dodged. Run this 11 times, changing the number each
      time; the 11th call must return `429`:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-For: 10.0.0.1" https://<api>/v1/demo/risk/<address>
  ```

  On a container host, if every call returns `200`, your host does not add its own proxy entry
  the usual way: set `TRUSTED_PROXY_HOPS=0` and redeploy.

## 3. Deploy the website (optional)

Agents use the API and the MCP server directly, so the website is optional. Any Next.js host
works; the steps below are for Vercel. Vercel's Hobby plan is for non-commercial use only.

- [ ] Import this repository and set **Root Directory** to `apps/web`. Build settings come from
      `apps/web/vercel.json`.
- [ ] Environment: `SVALIN_API_URL=https://<api>`, `NEXT_PUBLIC_API_BASE_URL=https://<api>` and
      `WEB_FORWARDING_SECRET=<the API's value>`. Set them before the first deploy:
      `NEXT_PUBLIC_API_BASE_URL` is built into the pages, so redeploy if the API address changes.
- [ ] **(test)** Paste a wallet on the landing page and get a graded report.

## 4. Test a payment on testnet

- [ ] Make a throwaway wallet and get test USDC from Circle's faucet (faucet.circle.com): Solana
      devnet USDC, or NEAR testnet USDC for a `.testnet` account.
- [ ] Run the MCP server locally with that wallet (`SVALIN_SOLANA_PRIVATE_KEY`, or
      `SVALIN_NEAR_ACCOUNT_ID` and `SVALIN_NEAR_PRIVATE_KEY`) and `SVALIN_API_URL=https://<api>`,
      then call `svalin_risk_report` from Claude Desktop or Claude Code.
- [ ] **(test)** The tool returns a report and `svalin_spend_status` shows $0.004 spent.
- [ ] **(test)** With Supabase set up, `select * from api_payments;` shows the payment.

## 5. Switch to mainnet

- [ ] Request a NEAR **mainnet** facilitator key for your mainnet `PAY_TO_NEAR` account (keys are
      per network), set it as `NEAR_FACILITATOR_API_KEY`, and set `X402_ENV=mainnet`. Redeploy.
- [ ] Pay for one call with real USDC to confirm settlement end to end.
- [ ] With CDP keys set, run CDP's free validation check on `https://<api>/v1/risk/<address>` and
      fix any "required" failure. The x402 Bazaar lists endpoints after a settlement through the
      CDP facilitator and drops them after 30 days without one.

## 6. Publish the MCP server

- [ ] Log in to npm (`npm login`), then publish from the package folder. Use `pnpm publish`, which
      resolves the workspace references and builds first:

  ```bash
  cd packages/mcp
  pnpm publish --access public
  ```

- [ ] List it in the official [MCP Registry](https://github.com/modelcontextprotocol/registry):
      `server.json` and the `mcpName` field are ready. Install `mcp-publisher`, then from
      `packages/mcp` run `mcp-publisher login github` and `mcp-publisher publish`.
- [ ] For each later release, bump `version` in both `package.json` and `server.json` (a test
      fails if they differ) and publish both again.
