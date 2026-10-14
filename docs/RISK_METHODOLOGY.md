# Risk methodology (v2026-10.2)

Svalin's report is computed by `apps/api/src/risk/engine.ts`. It is deterministic: the same
holdings always produce the same report. No number in a report comes from a language model.

## Inputs

- **Priced holdings** from the data source: Helius for Solana wallets; FastNEAR balances and Ref
  Finance prices for NEAR accounts. Tokens without a reliable price are excluded from totals and
  counted as `unpricedAssetCount`. Dust below $0.01 is dropped.
- **Category** from a curated registry (`packages/chain-config`): `native`, `stablecoin`,
  `liquid-staking`, `major`, `meme`. Anything not in the registry is `long-tail`.
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
elevated ≤ 75, high above. An empty wallet scores 0 with a single "no priced holdings" finding.

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

## Known limitations

- Prices come from the data provider. Thinly traded tokens can be mispriced; on NEAR, Ref Finance
  prices many small tokens, which then show up as long-tail exposure.
- Positions inside DeFi protocols (LP tokens, lending deposits, perps) are only seen if they are
  held as fungible tokens with a price.
- The registry is hand-curated. Expanding it improves categorisation.
- Changes to weights, thresholds or chain coverage bump `methodologyVersion`, which every report
  carries. 2026-10.2 added NEAR accounts; weights and thresholds are unchanged from 2026-10.1.
