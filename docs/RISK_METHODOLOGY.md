# Risk methodology (v2026-10.5)

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
  contract cannot be paged inside a request. If that edition cannot be read, classic pools alone
  set the bound, which can only lower a value.
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
| D | $3K or more | under 25% |
| F | under $3K | 25% or more |

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

## Known limitations

- Prices come from the data provider. On NEAR the pool check bounds what a thinly traded token
  can add, but a position is still shown at its quoted price up to that bound, which can be more
  than a large sale would really fetch. A token that trades only outside Ref Finance, or only
  against unvetted tokens, counts as unpriced.
- Solana prices are used as Helius quotes them; the pool check covers NEAR only.
- Positions inside DeFi protocols (LP tokens, lending deposits, perps) are only seen if they are
  held as fungible tokens with a price.
- The registry is hand-curated. Expanding it improves categorisation.
- Changes to weights, thresholds or chain coverage bump `methodologyVersion`, which every report
  carries. 2026-10.2 added NEAR accounts. 2026-10.3 added the pool check for NEAR tokens
  outside the registry. 2026-10.4 stopped rating wallets with nothing priced. 2026-10.5 added
  Ref's concentrated-liquidity pools to the pool check. Weights and thresholds are unchanged since
  2026-10.1.
