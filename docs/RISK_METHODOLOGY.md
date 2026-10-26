# Risk methodology (v2026-10.7)

Svalin's report is computed by `apps/api/src/risk/engine.ts`. It is deterministic: the same
holdings always produce the same report. No number in a report comes from a language model.

## Inputs

- **Priced holdings** from the data source: Helius for Solana wallets; FastNEAR balances and Ref
  Finance prices for NEAR accounts. Tokens without a reliable price are excluded from totals and
  counted as `unpricedAssetCount`. Dust below $0.01 is dropped.
- **Category** from a curated registry (`packages/chain-config`): `native`, `stablecoin`,
  `liquid-staking`, `major`, `meme`. Anything not in the registry is `long-tail`.
- **Pool check for NEAR tokens outside the registry.** A quoted price alone is not trusted:
  anyone can send an account a token whose Ref Finance price is fake or stale. Such a token is
  valued at no more than the registry tokens (wNEAR, stablecoins, liquid staking and so on) held
  in its Ref pools, which is the most a sale of it could take out. Value on the other side of a
  pool counts only if it is a registry token, so two junk tokens paired with each other add
  nothing. A token whose pools hold no registry token counts as unpriced. Registry tokens are not
  checked. Both Ref pool types count: classic pools are read live, and the depth from
  concentrated-liquidity (DCL) pools comes from the latest Svalin Index edition, because the DCL
  contract cannot be paged inside a request. The bound is also capped at the backing the token has
  held for 24 hours in that edition (see the Svalin Index below), so a pool added this morning
  cannot make a wallet look richer, while one pulled since the edition lowers the value at once. A
  token too new for the Index counts as unpriced. If the edition cannot be read, live pools alone
  set the bound.
- **NEAR specifics.** Native NEAR and wNEAR are `native`. NEAR delegated to a validator staking
  pool counts as `liquid-staking`: it is not liquid, but like stNEAR, LiNEAR and rNEAR it earns
  staking rewards, so it is staked rather than idle. Up to 10 staking pools are read per account.

## Metrics

| Metric | Definition |
| --- | --- |
| `largestPosition` | Largest single token by value |
| `largestVolatilePosition` | Largest **economic exposure** excluding stablecoins. Native, wrapped and staked forms of the same asset are pooled: 40% SOL + 30% JitoSOL is one 70% SOL bet, and NEAR + stNEAR + validator-staked NEAR is one NEAR bet |
| `hhi` | Herfindahl-Hirschman index over priced positions, 0-10,000 |
| `effectivePositions` | 10,000 / HHI: how many equal-sized positions the portfolio behaves like |
| `*Pct` | Share of priced value per category |
| `dataCoverage` | priced tokens / (priced + unpriced tokens), 0-100 |
| `exitValueUsd`, `exitLossPct` | What selling every priced position now would fetch after price impact, and how much less that is than the priced value. Each NEAR token outside the registry fetches size × (1 − saleLoss(backing, size)), the Index's sale loss for the whole position against the backing it has held for 24 hours; registry tokens, NEAR and staked NEAR count at full value. Positions are treated as sold independently. Null when any position's depth is unknown (Solana for now) |

## Score (0 = safest, 100 = riskiest)

```text
concentration = 45 × ramp(largestVolatilePct, 30 → 80)
stableBuffer  = 20 × ramp(15 − stablecoinPct, 0 → 15)
longTail      = 35 × ramp(longTailPct + 0.6 × memePct, 0 → 50)
score = round(concentration + stableBuffer + longTail)
```

`ramp(x, a → b)` is 0 at or below `a`, 1 at or above `b`, linear in between.
Grades: A ≤ 20, B ≤ 40, C ≤ 60, D ≤ 80, F above. Levels: low ≤ 25, moderate ≤ 50,
elevated ≤ 75, high above.

A wallet with nothing Svalin can price is **not rated**: `score`, `grade` and `level` are `null`,
with a "no priced holdings" finding, plus the unpriced-holdings finding when it holds 5 or more
unpriced tokens. Scoring it 0 would grade a fresh or spam-only wallet as an A.

## Findings

| Kind | Trigger | Severity |
| --- | --- | --- |
| `concentration` | largest volatile exposure ≥ 40% | high ≥ 70, medium ≥ 55, else low |
| `long-tail-exposure` | long-tail ≥ 20% | high ≥ 40, medium ≥ 30, else low |
| `meme-exposure` | memecoins ≥ 15% | high ≥ 50, medium ≥ 30, else low |
| `stable-buffer` | stablecoins < 10% and value ≥ $100 | medium < 5%, else low |
| `lst-opportunity` | unstaked SOL or NEAR ≥ 20% and staked < ¼ of it | info |
| `idle-stablecoins` | stablecoins ≥ 50% | info |
| `unpriced-holdings` | ≥ 5 unpriced tokens (usually spam) | low |
| `small-portfolio` | priced value < $50 | info |
| `exit-cost` | exit value ≥ 5% below priced value | high ≥ 25, medium ≥ 10, else low |

## Confidence

```text
distance       = min(1, |value − threshold| / threshold)
coverageFactor = 0.7 + 0.3 × dataCoverage / 100
confidence     = round(100 × coverageFactor × (0.6 + 0.4 × distance))
```

A finding sitting exactly on its threshold with full data coverage scores 60. One a full
threshold-width past it scores 100. Unpriced spam tokens can lower confidence by at most 30%.

## Svalin Index: NEAR token grades

The [Svalin Index](https://svalin.noobshole.workers.dev/ratings) grades every NEAR token Ref Finance
prices, except registry tokens, which are the yardstick. A token's **real backing** is the same pool
check as above: the registry-token value in its Ref pools, classic and DCL. The grade answers how
much of a $1,000 sale would be lost to price movement, about `1000 / (backing + 1000)` in a
constant-product pool. A check of a real trade uses its size instead (`saleLoss(backing, size)`):
a $50,000 sale into $100,000 of backing loses about a third.

| Grade | Real backing | A $1,000 sale loses |
| --- | --- | --- |
| A | $1M or more | under 0.1% |
| B | $100K or more | under 1% |
| C | $20K or more | under 5% |
| D | $3K or more | 25% or less |
| F | under $3K | more than 25% |

**Backing has to hold for 24 hours.** A token is graded on the lowest backing it had in the last
24 hours, and backing that appeared less than 24 hours ago (a new pool, or a pool that was emptied
and refilled) counts as zero until then. A pool added to prop up a price cannot lift a grade the
same day, and a pool pulled for an hour still lowers it. The history this rule reads is archived
with each edition, so the rule is verified along with the grades.

Each edition also carries, where known, the market cap at the quoted price (price × total supply),
the share of supply held by the ten largest holders outside exchange pools, bridges, NEAR Intents
and burn addresses (flagged at 80% or more), and the holder count. They are shown beside the grade
and do not change it: on NEAR the largest holders of established tokens are often project
treasuries, vesting and staking contracts, so a cap on concentration would mostly punish them. The
index is rebuilt every few hours by `apps/api/scripts/near-index.ts` and published in the
[svalin-index](https://github.com/noobshole/svalin-index) repository. Methodology
`near-token-backing-v1` (from 22 October 2026) added DCL pools, the 24-hour hold and the burn
exclusion; earlier editions are `near-token-backing-v0` and still verify with the current code.

**Circuit breaker.** A new edition is refused, and the previous one stays published, when it looks
broken rather than like a market (`apps/api/src/ratings/edition-guard.ts`):
- it prices under 70% of the tokens the previous edition did;
- it grades under half as many tokens above F, when the previous edition had at least 20;
- its total real backing falls below 40%, or rises above three times, the previous edition's, when
  that was $1M or more.

Such swings within a few hours point to a broken or manipulated data source. The refusal fails the
run, so it is noticed. Replayed over the editions of 19–26 October 2026, it refused none, including
the methodology change and the day DCL pools were added (backing up 53%).

**Exit prices.** `GET /v1/exit/{contract}` (free trial at `/v1/demo/exit/{contract}`) turns a token's backing `B` into
what selling it would fetch, from the same constant-product model (`apps/api/src/ratings/exit-prices.ts`):

| Figure | Formula | Example: B = $100K |
| --- | --- | --- |
| A sale of `s` fetches | `s × B / (B + s)` | $10K fetches $9,091 |
| Exit price (average received per token) | `price × B / (B + s)` | 9.1% under the quote for $10K |
| Largest sale losing at most `L` (1% and 5%) | `B × L / (1 − L)` | $1,010 and $5,263 |
| The whole supply, sold at once | the sale formula with `s` = market cap | at most $98,039 of a $5M market cap |

Quotes are given for $1K, $10K, $100K and any `amountUsd` the caller adds. They need nothing but
an edition's backing, so every edition carries them implicitly and anyone can recompute them; the
website shows the same numbers. Splitting a sale across several pools fetches the same as one sale
into a pool of their combined depth, so the model holds across a token's Ref pools. It counts only
NEAR pools: a token that also trades on other chains or exchanges could fetch more there.

**Track record.** Each edition also publishes `near-track-record.json`: how the grades of the
editions sealed 1, 7 and 30 days earlier have moved since, as a transition matrix of grade then
against grade now (or gone from the Index), with counts of upgrades, downgrades and tokens that lost
all their backing. Only editions of the same methodology are compared, and the matrix is
recomputable from any two sealed editions (`apps/api/src/ratings/track-record.ts`).

## Recipient check: is it safe to pay this address?

`GET /v1/check/{address}` (version `2026-10.2`, `apps/api/src/risk/check.ts`) answers a different
question from the risk report: not how a wallet is spread, but whether to send it money. It is
deterministic: data sources gather the signals, and one pure function judges them.

| Signal | Verdict |
| --- | --- |
| A token contract, a Solana program or token account, or a NEAR named account that does not exist | block |
| Looks like an address the payer paid recently: the same first and last four characters but a different address (addresses of 32 characters or more) | block |
| A NEAR name that reads like one the payer paid recently: the same once 0/o, 1/l, 5/s, rn/m and vv/w are folded and dashes, underscores and dots dropped (binance-hot.near and binancehot.near) | block |
| A NEAR name one letter away from one the payer paid recently, after the same folding, when both names are 8 characters or more before their top-level suffix | caution |
| Never used | caution |
| A NEAR account running a contract (a DAO or an app) | caution |
| Less than 7 days old, or fewer than 5 transactions | caution |
| A first payment of $100 or more (needs `payer` and `amountUsd`) | caution |
| The recipient's history, or the payer's recent payments, could not be read | caution |
| Otherwise | allow |

The payer's history on NEAR is its own last 20 successful transactions plus the last 20 that
involve it, read from FastNEAR's transactions API. Reading its own apart means incoming payouts or
spam cannot push its payments out of view. Native and token transfers count, including those made
inside contract calls, and relayed ones count for their real sender. On Solana it is its last 15
transactions (system transfers, and token balance changes per owner). If any part of it
cannot be read, the check says so and cautions, because a gap could hide the very payment a
look-alike imitates. Age and activity come from FastNEAR on NEAR (age is the account's first
successful receipt) and from up to 1,000 signatures on Solana (more than that counts as
established).

The free demo (`/v1/demo/check/{address}`) does not read the payer's history, the costly part of a
check, so it does not catch look-alikes and says so in its reasons. The paid check does.

## Known limitations

- Prices come from the data provider. On NEAR the pool check bounds what a thinly traded token
  can add, but a position is still shown at its quoted price up to that bound, which can be more
  than a large sale would really fetch; exit value estimates what it would fetch. A token that
  trades only outside Ref Finance, or only against unvetted tokens, counts as unpriced.
- Solana prices are used as Helius quotes them; the pool check covers NEAR only.
- Exit value and exit prices model a token's Ref pools as one constant-product pool. Concentrated
  liquidity can fill a small sale better and a large one worse than that, and a token that also
  trades on other chains or exchanges could fetch more there.
- Positions inside DeFi protocols (LP tokens, lending deposits, perps) are only seen if they are
  held as fungible tokens with a price.
- The registry is hand-curated. Expanding it improves categorisation.
- The recipient check sees recent history only: an address the payer paid long ago is not
  compared. If a data provider is slow or rate limiting, a check returns "history unavailable"
  cautions rather than guessing. There is no NEAR scam list yet.
- Token names and symbols come from whoever created the token. Svalin strips control, invisible
  and direction-changing characters and keeps at most 32 characters, but the text is still
  untrusted: an agent should treat it as data, never as instructions. Index editions carry
  symbols as published.
- Changes to weights, thresholds or chain coverage bump `methodologyVersion`, which every report
  carries. 2026-10.2 added NEAR accounts. 2026-10.3 added the pool check for NEAR tokens
  outside the registry. 2026-10.4 stopped rating wallets with nothing priced. 2026-10.5 added
  Ref's concentrated-liquidity pools to the pool check, and 2026-10.6 capped it at backing that
  has held for 24 hours. 2026-10.7 added exit value and the `exit-cost` finding, outside the
  score. Weights and thresholds of the score are unchanged since 2026-10.1. The recipient check is
  versioned apart: 2026-10.2 added look-alike NEAR names.
