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
- [ ] Optional: a **web forwarding secret** (`WEB_FORWARDING_SECRET`, 24+ random characters), only
      if a server of yours calls the free scan for visitors and must pass on their address. The
      bundled website calls the API from the browser and does not need it.
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

- Workers Free allows 10 ms of CPU time per request, with some leeway for occasional overruns.
  Most reports use under 2 ms. The first NEAR report each minute parses Ref Finance's price list
  (about 4 ms), and the first one every five minutes that holds tokens outside the registry also
  reads Ref's pool list (about 3 ms). A very large wallet can exceed the limit and fail; a failed
  request is never charged. Workers Paid raises the limit.
- The free-scan limit is keyed on `CF-Connecting-IP`, which callers cannot set, so
  `TRUSTED_PROXY_HOPS` is not used.
- The free-scan limits are kept in one Durable Object (binding `DEMO_LIMITER`), so every Worker
  instance shares the same counts. The portfolio cache stays in each instance's memory.
- Svalin passes (Pro codes and Business keys) live in a second Durable Object (binding `KEY_STORE`), stored by
  their SHA-256 only. `wrangler deploy` creates it from the `v2` migration in `wrangler.toml`.
  Without the binding every key route answers 503, so a key is never sold into memory and lost.
- Workers Free allows 100,000 Durable Object requests a day, shared by free scans, pass calls and
  checkouts; past it they fail until 00:00 UTC. Refusals are remembered in each Worker instance, so
  a caller who keeps asking does not use them up. Move to Workers Paid before pass calls near that
  number.
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
  WEB_FORWARDING_SECRET=...     # optional: only for a server that proxies the free scan
  TRUSTED_PROXY_HOPS=1          # proxies in front of the API; 1 on most hosts
  ANTHROPIC_API_KEY=...         # optional
  SUPABASE_URL=...              # optional
  SUPABASE_SERVICE_ROLE_KEY=... # optional
  CDP_API_KEY_ID=...            # optional
  CDP_API_KEY_SECRET=...        # optional
  ```

  Prices default to $0.002 (portfolio, check and exit prices), $0.004 (risk) and $0.02 (brief).
  Override them with `PRICE_PORTFOLIO_USD`, `PRICE_RISK_USD`, `PRICE_BRIEF_USD`, `PRICE_CHECK_USD`
  and `PRICE_EXIT_USD`. Each visitor gets `DEMO_REQUESTS_PER_DAY` free calls (default 5), and
  `LOCK_FREE_NEXT_STEPS=true` leaves next steps out of the free risk report.

**Then, on any host:**

- [ ] **(test)** The first log line (on Workers, after the first request) is
      `"svalin_api_started"` with `"facilitators"` listing the Solana facilitator (`"x402.org"`
      on testnet, `"payai"` on mainnet), plus `"near"` once `PAY_TO_NEAR` is set and `"cdp"`
      first if you set CDP keys. A line saying `Failed to fetch supported kinds from facilitator`
      means that facilitator is unreachable or its keys are wrong; the others keep working.
- [ ] **(test)** `https://<api>/` shows `"payments": { "enabled": true, ... }` with Solana, and
      NEAR too once `PAY_TO_NEAR` is set.
- [ ] **(test)** `https://<api>/v1/demo/risk/<any Solana address>` returns a report with
      `"dataSource": "helius"`, and `https://<api>/v1/demo/risk/<any NEAR account>` one with
      `"dataSource": "fastnear"`.
- [ ] **(test)** `https://<api>/v1/risk/<address>` returns HTTP 402.
- [ ] **(test)** The free-scan limit cannot be dodged. Run this 6 times, changing the number each
      time; the 6th call must return `429` (with the default 5 a day):

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-For: 10.0.0.1" https://<api>/v1/demo/risk/<address>
  ```

  On a container host, if every call returns `200`, your host does not add its own proxy entry
  the usual way: set `TRUSTED_PROXY_HOPS=0` and redeploy.

## 3. Deploy the website (optional)

Agents use the API and the MCP server directly, so the website is optional. It is a static site
(`apps/web/out`): the free scan runs in the visitor's browser and calls the API directly, so the
API applies the free-scan limit to each visitor's own address.

**On Cloudflare Workers (static assets):**

- [ ] **Workers & Pages** → **Create** → **Import a repository** → choose this repository.
- [ ] Project name `svalin` (it must match `name` in `apps/web/wrangler.toml`), root directory
      `apps/web`, and:

  ```text
  Build command:  pnpm install --frozen-lockfile --filter "@svalin-agent/web..." && pnpm --filter "@svalin-agent/web..." build
  Deploy command: npx wrangler@4.146.0 deploy
  ```

- [ ] Build variable `NEXT_PUBLIC_API_BASE_URL=https://<api>`. It is built into the pages, so
      rebuild if the API address changes.
- [ ] On the API, set `ALLOWED_ORIGINS=https://<your-site>` so browsers may call it.
- [ ] **(test)** Paste a wallet on the landing page and get a graded report.

Any other static host works too: run the build, then publish `apps/web/out`, and copy the
security headers from `apps/web/out/_headers` into the host's header settings.

## 4. Test a payment on testnet

- [ ] Make a throwaway wallet and get test USDC from Circle's faucet (faucet.circle.com): Solana
      devnet USDC, or NEAR testnet USDC for a `.testnet` account.
- [ ] Run the MCP server locally with that wallet (`SVALIN_SOLANA_PRIVATE_KEY`, or
      `SVALIN_NEAR_ACCOUNT_ID` and `SVALIN_NEAR_PRIVATE_KEY`) and `SVALIN_API_URL=https://<api>`,
      then call `svalin_risk_report` from Claude Desktop or Claude Code.
- [ ] **(test)** The tool returns a report and `svalin_spend_status` shows $0.004 spent.
- [ ] **(test)** With Supabase set up, `select * from api_payments;` shows the payment.

### Svalin Pro and Svalin Business on testnet

The passes follow each chain's payment network, so on testnet they take test USDC and cost
nothing to try. A pass paid on a test network stops working when that chain moves to mainnet.

- [ ] **(test)** `https://<api>/v1/pro` lists the plans and, per chain, where to pay.
- [ ] **(test)** On the website's Pricing page, pay for Pro with test USDC: Solana devnet by scanning the QR code
      (Phantom or Solflare in testnet mode), or NEAR testnet by sending the exact amount shown. The
      page finds the payment within about 10 seconds (NEAR: about 30) and shows "Svalin Pro is active".
- [ ] **(test)** A scan then shows "Svalin Pro: 99 calls left today."
- [ ] **(test)** `POST https://<api>/v1/keys/business` answers 402 asking for $79 (`/v1/keys/pro`:
      $5); an x402 client that pays it gets a key, and `GET /v1/keys/me` with that key shows its
      calls. Paying again with the key in `Authorization` renews it.

## 5. Switch to mainnet

Each chain can switch on its own: `X402_ENV_SOLANA` and `X402_ENV_NEAR` override `X402_ENV` for
that chain. Solana's mainnet facilitator needs no approval, so Solana can take real USDC while NEAR
waits for its mainnet key.

- [ ] **Solana:** make sure the `PAY_TO_SOLANA` wallet has a USDC account on mainnet (receive a few
      cents of USDC once), then set `X402_ENV_SOLANA=mainnet`. Redeploy.
- [ ] **NEAR:** register your mainnet `PAY_TO_NEAR` account with USDC, request a NEAR **mainnet**
      facilitator key for it (keys are per network), set it as `NEAR_FACILITATOR_API_KEY`, set
      `PAY_TO_NEAR` to the mainnet account and `X402_ENV_NEAR=mainnet`. Redeploy.
- [ ] **(test)** `https://<api>/` lists each network with `"environment": "mainnet"` or `"testnet"`,
      and the website's Pricing and Docs pages say which chains take real USDC.
- [ ] Pay for one call with real USDC to confirm settlement end to end.
- [ ] Buy Svalin Pro once with real USDC on the website, check it activates, then set
      `LOCK_FREE_NEXT_STEPS=true`: the free scan's next steps then need Pro or a paid call.
- [ ] Update `SVALIN_PAYEES` in `.github/workflows/monitor.yml` to the mainnet receiving accounts.
      The hourly Monitor workflow fails, and GitHub emails you, if a paid route ever names a payee
      outside that list, the Index goes stale, or the website's security headers or scripts change.
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
