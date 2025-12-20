# TOTALS_V1 - ARCHIVED

**Status:** NOT VIABLE
**Archived:** 2025-12-20
**Reason:** Failed Phase 3 holdout validation

## Summary

TOTALS_V1 attempted to find edge in college football totals markets using SP+ ratings as the primary signal. The model showed promising results on train data (2022-2023) but collapsed on the 2024 holdout.

## Final Results

| Dataset | Threshold | Bets | Win Rate | ROI |
|---------|-----------|------|----------|-----|
| Train (2022-2023) | SP+ > 115 | 354 | 54.8% | +4.6% |
| **Holdout (2024)** | SP+ > 115 | 114 | **46.5%** | **-11.2%** |

## What Was Tested

### Phase 2 Tests
1. **Pace-only model**: r = -0.004, no signal
2. **SP+ × Pace interaction**: Quadrant patterns noted but unstable
3. **Total-range conditioning**: Overfit (+7.8% train → -7.6% holdout)
4. **Seasonal regime split**: Consistent direction but low volume

### Phase 3 Validation
- Threshold sweep: All thresholds positive on train
- Volume stress test: Edge collapsed as volume increased on holdout
- Market awareness: "Late signal" pattern did not persist

## Failure Modes

1. **Regime shift**: 2024 behaved differently than 2022-2023
2. **Sample size**: Low bet volume (~3-12/week) limits significance
3. **Market efficiency**: Totals markets may be more efficient than spreads
4. **Feature insufficiency**: SP+ alone cannot predict totals deviations

## Lessons Learned

- Train performance (+4.6% ROI) was noise, not signal
- The "high SP+ → under" pattern was spurious
- Totals require different features than spreads (weather, pace, game script)

## Recommendation

Do NOT deploy. Do NOT add features. Archive and revisit only if:
- New data sources become available (sharp money, weather API)
- Spreads model shows sustained edge for 12+ months
- Significant regime change in CFB totals markets

## Files Created (Archive Reference)

- `scripts/totals-backtest-baseline.ts`
- `scripts/totals-backtest-sp.ts`
- `scripts/totals-backtest-pace.ts`
- `scripts/totals-backtest-sp-pace.ts`
- `scripts/totals-backtest-range.ts`
- `scripts/totals-backtest-seasonal.ts`
- `scripts/totals-backtest-contrarian.ts`
- `scripts/totals-sp-correlation.ts`
- `scripts/totals-phase3-validation.ts`
- `scripts/totals-v1-summary.ts`
