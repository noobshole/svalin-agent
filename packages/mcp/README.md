# svalin-mcp

MCP server for [Svalin](https://github.com/noobshole/svalin-agent): read-only portfolio risk
reports for Solana wallets and NEAR accounts, for AI agents. Works in Claude Desktop, Claude Code, Cursor, and
any MCP client.

The free scan works with no setup. Paid tools are billed per call in USDC over
[x402](https://x402.org), from a Solana or NEAR wallet **you** control, with a hard
per-call limit and a session budget. Svalin never holds your funds and can never move them.

## Tools

| Tool | Default cost | What it returns |
| --- | --- | --- |
| `svalin_risk_scan` | free, rate limited | Risk score 0-100, grade A-F, exposure metrics, findings with actions |
| `svalin_risk_report` | $0.004 | Same report, no rate limit |
| `svalin_portfolio` | $0.002 | Priced holdings with allocation and risk category per token |
| `svalin_brief` | $0.02 | Headline, summary and up to 3 actions, plus the full report |
| `svalin_check_recipient` | $0.002 | Before paying someone: allow, caution or block, with reasons (address poisoning, brand-new wallets, tokens and programs) |
| `svalin_check_recipient_free` | free, rate limited | The same check as a free trial, without the payer's history (no look-alike check) |
| `svalin_spend_status` | free | Paying wallet, amount spent, budget remaining |

Prices are set by the API you point at. The MCP refuses any payment above `SVALIN_MAX_PRICE_USD`.

## Install

`svalin-mcp` is not on npm yet. Until it is, run it [from source](#from-source); the `npx`
commands below work once it is published.

Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "svalin": {
      "command": "npx",
      "args": ["-y", "svalin-mcp"],
      "env": {
        "SVALIN_API_URL": "https://YOUR-SVALIN-API",
        "SVALIN_SOLANA_PRIVATE_KEY": "",
        "SVALIN_MAX_PRICE_USD": "0.05",
        "SVALIN_BUDGET_USD": "1"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add svalin -e SVALIN_API_URL=https://YOUR-SVALIN-API -- npx -y svalin-mcp
```

### From source

With Node.js 20.18 or later and pnpm:

```bash
git clone https://github.com/noobshole/svalin-agent
cd svalin-agent
pnpm install
pnpm build
```

Then, in the configuration above, replace `"command": "npx"` and its `"args"` with
`"command": "node"` and `"args": ["/full/path/to/svalin-agent/packages/mcp/dist/index.js"]`.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `SVALIN_API_URL` | required | Base URL of a Svalin API |
| `SVALIN_SOLANA_PRIVATE_KEY` | unset | Base58 secret key (Phantom/Solflare export format). Pays in Solana USDC |
| `SVALIN_SOLANA_RPC_URL` | public RPC | Optional RPC for building Solana payments |
| `SVALIN_NEAR_ACCOUNT_ID` | unset | NEAR account that pays, e.g. `my-agent.near`. Set with the key below |
| `SVALIN_NEAR_PRIVATE_KEY` | unset | `ed25519:…` full-access key of that account (`secp256k1` keys are refused). Pays in NEAR USDC; no NEAR is needed for gas |
| `SVALIN_NEAR_RPC_URL` | public RPC | Optional RPC for building NEAR payments |
| `SVALIN_PREFERRED_NETWORK` | `solana` | `solana` or `near` when both wallets are set |
| `SVALIN_MAX_PRICE_USD` | `0.05` | Hard per-call cap |
| `SVALIN_BUDGET_USD` | `1` | Hard cap per MCP session (resets when the client restarts) |

**Use a dedicated hot wallet** holding only a few dollars of USDC. Never put a main wallet key
in an MCP config. With no key set, only the free scan works.

## How payment works

1. The tool calls the Svalin API.
2. The API answers `402 Payment Required` with the price in USDC on Solana and NEAR.
3. svalin-mcp checks the price against your limits, signs a USDC transfer for exactly that amount
   (on NEAR, a delegated `ft_transfer` whose gas the facilitator pays), and retries.
4. A facilitator settles the transfer on-chain and the API returns the data. You are not charged
   if the API returns an error.
