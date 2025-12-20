# PROD_V1_LOCKED — Final Production Betting System

**Status:** LOCKED
**Frozen Date:** 2025-12-19
**Version:** V1 (FINAL)

---

## Production Specification

### Model
- **Type:** Elo-only (frozen)
- **Spread projection:** `(homeElo - awayElo) / 25 + 2.5 HFA`
- **Edge calculation:** `edge = marketSpreadHome - modelSpreadHome`

### Selection Rule
- **Volume:** Top 10 bets/week by absolute edge
- **Filter:** Exclude spreads where `3 < |marketSpread| < 7`
  - Keep: spreads ≤3 OR spreads ≥7
  - Exclude: medium spreads (3-7)

### Stake Sizing
- **Method:** Flat staking
- **Unit size:** $100 per bet
- **Max weekly exposure:** ~$1,000 (10 bets × $100)

### Risk Profile
- **Historical max drawdown:** ~9%
- **Expected ROI:** ~8%
- **Win rate:** ~57%

---

## Backtest Performance (2024 Test Set)

| Metric | Value |
|--------|-------|
| Bets | 120 |
| Win Rate | 56.7% |
| ROI | +8.13% |
| Max Drawdown | $945 (8.8%) |
| Volatility | 45.2% |

---

## Forward Test Requirements (MANDATORY)

Before real money deployment:

1. **Paper trade for 4-8 weeks**
2. **Log for each bet:**
   - Model edge at bet time
   - Market line used
   - Closing line (after game starts)
   - Actual result
3. **Pass criteria:**
   - No operational bugs
   - Bets match backtest logic exactly
   - No unexplained drift
   - CLV appears when using opening/early lines

If forward test fails → Fix operations, NOT the model.

---

## Change Control

**THIS SPECIFICATION IS LOCKED.**

- NO changes to model
- NO changes to selection rule
- NO changes to filters
- NO changes to stake sizing

Any modification requires:
1. New version number (V2, V3, etc.)
2. Full backtest comparison
3. Documented rationale
4. Explicit user approval

---

## What NOT To Do

- ❌ Add new features
- ❌ Revisit rejected filters
- ❌ Optimize thresholds further
- ❌ Scale bet size aggressively
- ❌ Chase optimal Kelly

---

## Version History

| Version | Date | Change |
|---------|------|--------|
| V1 | 2025-12-19 | Initial frozen production spec |
