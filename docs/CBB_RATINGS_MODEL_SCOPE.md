# CBB Ratings Model Test — Scope Document

## Executive Summary

We previously tested CBB via line movement and structural signals, finding no edge. However, we **never tested a ratings-based model** — the approach that works for CFB (+20.6% ROI).

This document scopes out a proper ratings-based model test for CBB spreads.

---

## Data Available

### Current Coverage

| Data | Count | Notes |
|------|-------|-------|
| Games with T-60 spread | 6,328 | Backtest universe |
| Games with close spread | 24,017 | |
| Games with DK open spread | 5,918 | |
| Team ratings per season | ~360 | Offensive, defensive, net ratings |

### Rating Fields Available

From `cbb_team_ratings` table:
- `offensive_rating` — Points per 100 possessions offense
- `defensive_rating` — Points per 100 possessions allowed
- `net_rating` — Offensive - Defensive (margin per 100)
- `srs_rating` — Simple Rating System
- Season-level (not weekly snapshots)

### Missing Data

- **Weekly rating snapshots** — Only have season-end ratings, not point-in-time
- **Totals at T-60** — Have spread but not totals at execution timing
- **Conference/tournament flags** — Would need to add

---

## Proposed Model: Net Rating Spread

### Hypothesis

Teams' net ratings (margin per 100 possessions) can be converted to a spread projection. When this projection disagrees with the market by 2.5-5 points, there may be profitable betting opportunities.

### Formula

```
Model Spread = (Away Net Rating - Home Net Rating) / K + HFA

Where:
- K = scaling factor (TBD via calibration, likely ~3-4)
- HFA = home field advantage (~3-4 points for CBB)
```

This mirrors the CFB approach:
- CFB: Elo differential / 25 + HFA
- CBB: Net rating differential / K + HFA

### Edge Calculation

```
Edge = Market Spread (T-60) - Model Spread

If |Edge| in [2.5, 5.0]:
  - Edge > 0 → Bet Home
  - Edge < 0 → Bet Away
```

---

## Test Plan

### Phase 1: Data Preparation

1. **Verify point-in-time ratings**
   - Current ratings are season-level
   - For backtest validity, need to ensure we're not using future data
   - Option A: Use prior season ratings (conservative)
   - Option B: Sync weekly snapshots from CBBD (more work)

2. **Build backtest dataset**
   ```sql
   SELECT
     g.id,
     g.season,
     g.home_team_id,
     g.away_team_id,
     g.home_score,
     g.away_score,
     bl.spread_t60 AS market_spread,
     bl.spread_close AS close_spread,
     home_r.net_rating AS home_net,
     away_r.net_rating AS away_net
   FROM cbb_games g
   JOIN cbb_betting_lines bl ON bl.game_id = g.id
   JOIN cbb_team_ratings home_r ON home_r.team_id = g.home_team_id
   JOIN cbb_team_ratings away_r ON away_r.team_id = g.away_team_id
   WHERE bl.spread_t60 IS NOT NULL
     AND g.home_score IS NOT NULL
     AND home_r.season = g.season - 1  -- Prior season ratings (conservative)
     AND away_r.season = g.season - 1
   ```

3. **Establish sample sizes**
   - Target: 3,000+ games for train, 1,000+ for test
   - Verify coverage by season

### Phase 2: Model Calibration (Train Set Only)

**Train:** 2022-2023 seasons
**Test:** 2024 (holdout)

1. **Calibrate K (scaling factor)**
   - Grid search K in [2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
   - Minimize MAE of model spread vs actual margin

2. **Calibrate HFA (home field advantage)**
   - Grid search HFA in [2.0, 2.5, 3.0, 3.5, 4.0]
   - Or derive from data: mean(home margin) when spread = 0

3. **Find profitable edge range**
   - Bucket edges: [0-1], [1-2], [2-2.5], [2.5-3], [3-4], [4-5], [5+]
   - Calculate win rate and ROI per bucket
   - Identify sweet spot (expect 2.5-5 pts like CFB)

### Phase 3: Holdout Validation

**CRITICAL: Only run once, no refitting**

1. Apply frozen parameters (K, HFA, edge filter) to 2024
2. Record:
   - Total bets
   - Win rate
   - ROI at -110
3. Compare to baseline (random betting = -4.5% ROI)

### Phase 4: Decision

| Result | Action |
|--------|--------|
| ROI > +5% on 500+ bets | Proceed to production testing |
| ROI 0-5% on 500+ bets | Investigate, possibly iterate |
| ROI < 0% | Archive CBB, confirm market efficiency |

---

## Key Differences from CFB

| Aspect | CFB | CBB |
|--------|-----|-----|
| Rating sources | Elo + SP+ + PPA (3 signals) | Net rating only (1 signal) |
| Weekly updates | Yes (Elo weekly) | No (season-level) |
| Home field advantage | ~2.0 pts | ~3.5 pts (higher) |
| Market efficiency | Lower | Higher (more volume) |
| Expected edge | +20.6% ROI | Unknown (likely lower) |

---

## Implementation Files

```
scripts/
├── cbb-build-backtest-dataset.ts   # Create joined dataset
├── cbb-calibrate-model.ts          # Grid search K, HFA
├── cbb-ratings-backtest.ts         # Run backtest with edge filter
└── cbb-holdout-validation.ts       # Final 2024 test

docs/
└── CBB_RATINGS_MODEL_SCOPE.md      # This document
```

---

## Risks & Mitigations

### Risk 1: Point-in-time leakage
**Problem:** Season-level ratings include games we're betting on
**Mitigation:** Use prior season ratings (conservative) or sync weekly snapshots

### Risk 2: Small sample size
**Problem:** 6,328 games split across train/test may not be enough
**Mitigation:** If insufficient, expand to include close spread games (24K) with adjusted methodology

### Risk 3: Overfitting K and HFA
**Problem:** Grid search on train may not generalize
**Mitigation:** Use coarse grid, validate on holdout, check year-by-year stability

### Risk 4: Rating quality
**Problem:** CBBD ratings may not be as predictive as KenPom/BartTorvik
**Mitigation:** If initial test fails, investigate syncing KenPom data (paid API)

---

## Success Criteria

Before proceeding to production:

1. ✅ Holdout ROI > 0% (beats random)
2. ✅ Holdout ROI > +5% (meaningfully profitable)
3. ✅ 500+ bets in holdout (statistical significance)
4. ✅ Year-by-year stability (no single year drives results)
5. ✅ Edge filter makes sense (2.5-5 pts or similar)

---

## Next Steps

1. **Verify data quality** — Run join query, check for NULLs and coverage
2. **Build baseline** — Bet all games with T-60 spread, expect -4.5% ROI
3. **Add model** — Implement net rating spread projection
4. **Calibrate** — Grid search on 2022-2023
5. **Validate** — Run frozen model on 2024 holdout
6. **Decide** — Proceed or archive based on results

---

## Estimated Effort

| Task | Time |
|------|------|
| Data prep + verification | 1-2 hours |
| Baseline backtest | 30 min |
| Model calibration | 1-2 hours |
| Holdout validation | 30 min |
| Documentation | 30 min |

**Total: ~4-5 hours** to definitively answer whether CBB has a ratings-based edge.

---

## Questions to Resolve

1. **Point-in-time:** Should we use prior season ratings or try to sync weekly?
   - Recommendation: Start with prior season (simpler), upgrade if promising

2. **Single rating vs ensemble:** Should we try combining net_rating + srs_rating?
   - Recommendation: Start simple (net_rating only), add complexity if needed

3. **Conference filtering:** Should we filter to Power conferences only?
   - Recommendation: Start with all D1, segment later if needed

4. **Neutral site games:** Do we have data to identify these?
   - Need to check — may need to exclude or handle differently
