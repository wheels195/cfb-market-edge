# Phase 6: Production Readiness

**Status:** COMPLETE
**Date:** 2025-12-20

## Overview

Phase 6 focused on production infrastructure for capital protection, not new alpha discovery.

## Completed Components

### 1. Spreads Model Frozen (`src/lib/models/production-v1.ts`)

```typescript
MODEL_VERSION = 'production-v1'
MODEL_ID = 'v3_ppadiff_regime2'
FROZEN_DATE = '2024-12-XX'

// Core parameters
HOME_FIELD_ADVANTAGE: 3.0
ELO_TO_SPREAD_DIVISOR: 25
MEAN_RATING: 1500

// Two-regime weighting
REGIME_1 (Weeks 1-4): prior_weight: 0.65, performance_weight: 0.35
REGIME_2 (Weeks 5+):  prior_weight: 0.25, performance_weight: 0.75

// Betting thresholds
edge_floor_early: 1.5
edge_floor_late: 1.0
max_uncertainty_multiplier: 1.3
```

### 2. Live Monitoring (`src/lib/models/monitoring.ts`)

- **MonitoringStore class**: Tracks all placed bets
- **CLV calculation**: Compares bet price vs closing line
- **Performance metrics**: Win rate, ROI, edge persistence
- **Alert system**:
  - Win rate below threshold
  - CLV capture below target
  - Season divergence from backtest
- **Daily reports**: Automated summary generation

### 3. Weekly Diagnostics (`scripts/weekly-diagnostics.ts`)

Run every Sunday after games are graded:

```bash
npx tsx scripts/weekly-diagnostics.ts [season] [week]
```

Outputs:
- Week-by-week performance table
- Rolling metrics (4-week, 8-week, season)
- Regime comparison (Weeks 1-4 vs 5+)
- Edge decay detection
- Capital protection status

### 4. Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Win Rate | < 52% | < 48% |
| ROI | < -2% | < -10% |
| Edge Decay | 8pp drop | 10pp drop |
| Losing Streak | - | 3+ weeks |
| CLV Capture | < 50% | < 45% |

### 5. Capital Protection Logic

```
🔴 PAUSE: Critical alerts present
   → Reduce or suspend betting immediately
   → Conduct full model review

🟡 CAUTION: Warnings present
   → Reduce stake sizes
   → Monitor next 2 weeks closely

🟢 NORMAL: No alerts
   → Continue standard operation
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `bet_records` | Live bet tracking (populated during production) |
| `diagnostic_reports` | Weekly report storage |
| `materialized_edges` | Current edge calculations |

## Deployment Checklist

When deploying to production:

1. **Environment variables set**
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ODDS_API_KEY`
   - `CFBD_API_KEY`

2. **Cron jobs configured (Vercel)**
   - `poll-odds`: Every 2-10 min based on game proximity
   - `materialize-edges`: Every 5 min
   - `sync-results`: Daily at 6 AM
   - `run-model`: Every 4 hours

3. **Monitoring active**
   - Daily reports enabled
   - Alert thresholds set per production-v1.ts
   - Weekly diagnostics scheduled

4. **Bet recording workflow**
   - Each placed bet writes to `bet_records`
   - Include: event_id, side, spread_at_bet, effective_edge
   - After game: update result, spread_at_close

## What NOT To Do

- Do NOT modify frozen model parameters
- Do NOT deploy TOTALS_V1 (archived - failed validation)
- Do NOT ignore critical alerts
- Do NOT increase stake during drawdowns

## Files Reference

| File | Purpose |
|------|---------|
| `src/lib/models/production-v1.ts` | Frozen model config |
| `src/lib/models/betting-rules.ts` | Hard-coded betting logic |
| `src/lib/models/monitoring.ts` | CLV tracking, alerts |
| `scripts/weekly-diagnostics.ts` | Weekly performance report |
| `docs/TOTALS_V1_ARCHIVED.md` | Why totals model was not deployed |
