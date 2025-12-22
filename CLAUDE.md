# CFB Market-Edge

Personal decision-support app for NCAAF betting that identifies market discrepancies, tracks line movement, and generates model projections.

## Project Overview

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (Postgres)
- **Deployment**: Vercel
- **Odds Source**: The Odds API (DraftKings, Bovada)
- **Stats Source**: CollegeFootballData API

---

## CFB Model — Production Status (December 22, 2025)

### PRODUCTION MODEL: T-60 Ensemble

The CFB model is a **T-60 ensemble** combining three rating systems:

| Component | Weight | Source |
|-----------|--------|--------|
| Elo | 50% | `src/lib/models/t60-ensemble-v1.ts` |
| SP+ | 30% | `src/lib/models/t60-ensemble-v1.ts` |
| PPA (Points Per Play) | 20% | `src/lib/models/t60-ensemble-v1.ts` |

**Important:** The model does **NOT** use contrarian betting logic or confidence filters. All games with 2.5-5 pt edge are bet regardless of model disagreement.

### Production Edge Writer

**ONLY ONE JOB WRITES TO EDGES TABLE:**

```
/api/cron/materialize-edges → materializeEdgesT60()
```

Located in: `src/lib/jobs/materialize-edges-t60.ts`

**Deprecated models (GUARDED - cannot write to edges):**
- `src/lib/jobs/materialize-edges.ts` - Has `DEPRECATED_MODEL_GUARD = true`
- `src/lib/jobs/materialize-edges-v2.ts` - Has `DEPRECATED_MODEL_GUARD = true`

These deprecated files will error immediately if called, preventing accidental edge overwrites.

### T-60 Execution Validation (COMPLETED)

- **Execution Proxy**: T-60 spreads (DraftKings spread 60 minutes before kickoff)
- **Population**: FBS games only (FCS filtered out via `src/lib/fbs-teams.ts`)
- **T-60 Coverage**: 94.5% of FBS games (2920 of 3091)

### Backtest Results (FBS Only, 2022-2024)

| Season | Bets | Win% | ROI |
|--------|------|------|-----|
| 2022 | 350 | 65.7% | +25.5% |
| 2023 | 187 | 63.1% | +20.5% |
| 2024 | 221 | 59.3% | +13.2% |
| **TOTAL** | **758** | **63.2%** | **+20.6%** |

**Chronological Holdout:**
- Train (2022-2023): 537 bets, 64.8% win, +23.7% ROI
- Test (2024): 221 bets, 59.3% win, +13.2% ROI

### Production Deployment Status

**DEPLOYED TO PRODUCTION: December 22, 2025**

- Frozen config: `src/lib/models/t60-ensemble-v1.ts`
- FBS filter: `src/lib/fbs-teams.ts`
- Edge filter: 2.5-5 pts (no confidence filter)
- Backtest script: `scripts/cfb-t60-backtest-fbs.ts`
- Edge materializer: `src/lib/jobs/materialize-edges-t60.ts`

---

## What the CFB Model is Trained On

### Rating Systems

1. **Elo Ratings** (`src/lib/models/elo.ts`)
   - Initial rating: 1500
   - K-factor: 20, adjusted for margin of victory
   - Home field advantage: 2.5 points
   - Elo-to-spread divisor: 25
   - Weekly snapshots stored in `team_elo_snapshots` table
   - For bowl games (week > 13): capped at Week 13 Elo

2. **SP+ Ratings** (from CFBD API)
   - Stored in `advanced_team_ratings` table
   - Prior season used for early weeks

3. **PPA (EPA) Ratings** (from CFBD API)
   - Points per play efficiency
   - Scaled by ~35 plays to convert to game-level spread

### Ensemble Projection (`src/lib/backtest/ensemble-model.ts`)

```
projectedSpread = (eloSpread × 0.50) + (spSpread × 0.30) + (ppaSpread × 0.20)
```

With home field advantage of 2.0 points (optimized, lower than typical 2.5-3).

### Calibrated Edge Filters (`src/lib/jobs/materialize-edges.ts`)

| Edge Range | Win Rate | ROI | Action |
|------------|----------|-----|--------|
| < 2.5 pts | ~49% | -7% | SKIP (too small) |
| 2.5-3 pts | 59.5% | +13.6% | Very High confidence |
| 3-4 pts | 55.8% | +6.6% | High confidence |
| 4-5 pts | 54.8% | +4.5% | Medium confidence |
| 5+ pts | 46% | -11% | SKIP (model errors) |

These filters are defined in `CALIBRATION` constant in `src/lib/jobs/materialize-edges.ts` lines 76-91.

### Confidence Requirement

- Requires "high confidence": all 3 models (Elo, SP+, PPA) must agree within 5 points
- Defined in `src/lib/backtest/ensemble-model.ts` lines 119-126

### What is NOT Used in Production

- **Contrarian betting**: Early research showed contrarian signal, but production bets WITH the model, not against it
- **Line movement filters**: Explored in `scripts/edge-filter-approach.ts` but not in production
- **QB status adjustments**: Defined in `production-v1.ts` but not fully integrated

---

## Validation Status

### Pre-Deployment Checklist

| Step | Status | Result |
|------|--------|--------|
| 1. Sync T-60 spreads | ✅ DONE | 2920 FBS games with T-60 (94.5% coverage) |
| 2. FBS-only filtering | ✅ DONE | FCS games excluded via `src/lib/fbs-teams.ts` |
| 3. Year-by-year evaluation | ✅ DONE | All years profitable (2022: +25.5%, 2023: +20.5%, 2024: +13.2%) |
| 4. Chronological holdout | ✅ DONE | Train +23.7% ROI, Test +13.2% ROI |
| 5. Positive ROI after juice | ✅ DONE | +20.6% ROI overall on 758 bets |
| 6. No confidence filter | ✅ DONE | All model disagreement levels included |

### T-60 Execution Validation: COMPLETE

The model has been validated on T-60 execution lines (realistic betting window):

- **758 bets** across 2022-2024
- **63.2% win rate** (479-279)
- **+20.6% ROI** after -110 juice
- **All individual years profitable**
- **Holdout test passes**: 2024 shows +13.2% ROI on unseen data

### Year-by-Year Performance (T-60 FBS)

| Year | Bets | Win% | ROI | Status |
|------|------|------|-----|--------|
| 2022 | 350 | 65.7% | +25.5% | ✅ Profitable |
| 2023 | 187 | 63.1% | +20.5% | ✅ Profitable |
| 2024 | 221 | 59.3% | +13.2% | ✅ Profitable |

**Note:** ROI shows expected decay from 2022→2024, suggesting markets may be becoming more efficient. Continue monitoring.

---

## Live Betting Guidance

### Current Recommendation

**T-60 validation complete. Model ready for live deployment on FBS games.**

Criteria met:
- ✅ T-60 execution backtest: +20.6% ROI on 758 bets
- ✅ Year-by-year: All years profitable (no losing years)
- ✅ Chronological holdout: 2024 test set shows +13.2% ROI
- ✅ FBS filtering: Clean population, 94.5% T-60 coverage

### Bet Criteria

Only bet when:
1. Game is FBS (both teams in `FBS_TEAMS` set)
2. Edge is 2.5-5 pts (model spread vs market spread)
3. T-60 spread is available (60 min before kickoff)

### Expected Performance

Based on backtest:
- Win rate: ~60-65%
- ROI: ~13-25% (varies by year)
- Bet frequency: ~250 bets/season

### Monitoring

Watch for:
- Continued ROI decay (2022→2024 trend)
- Significant deviation from historical win rates
- Changes in market efficiency

---

## Architecture

### Database Schema

```
sportsbooks          - DraftKings, Bovada, FanDuel
teams                - NCAAF teams with CFBD mapping
events               - Games with odds_api_event_id
odds_ticks           - Line snapshots (deduplicated)
closing_lines        - Materialized closing numbers
results              - Final scores from CFBD
team_elo_snapshots   - Weekly Elo ratings per team
model_versions       - Model metadata
projections          - Model outputs per event
edges                - Computed edges per event/book
game_predictions     - Locked predictions at kickoff
cfbd_betting_lines   - Historical CFBD betting data
advanced_team_ratings - SP+ and other advanced metrics
```

### Cron Jobs (Vercel) — As of December 22, 2025

| Job | Schedule | Purpose |
|-----|----------|---------|
| `poll-odds` | Every 10 min | Fetch live spreads from The Odds API |
| `materialize-edges` | Every 15 min | Calculate T-60 ensemble edges (PRODUCTION) |
| `set-closing-lines` | Every 30 min | Lock closing line + prediction at kickoff |
| `sync-results` | 6 AM daily | Pull final scores from CFBD |
| `grade-bets` | 7 AM daily | Calculate WIN/LOSS for completed games |
| `sync-elo` | 6:30 AM daily | Update Elo ratings after games |
| `cleanup` | 3 AM daily | Clean old data |

**REMOVED from cron (December 22, 2025):**
- `run-pipeline` - Was causing edge overwrites with wrong model. Pipeline now only called manually if needed, and uses T-60 via `materializeEdgesT60()`.

### API Endpoints

- `GET /api/games` - Games with edges, results, and recommendations
- `GET /api/cron/*` - Cron job endpoints
- `GET /api/backtest/calibration` - Generate calibration curve from historical data

---

## Key Files

### Core Model (T-60 Ensemble)
- `src/lib/models/t60-ensemble-v1.ts` - Frozen T-60 ensemble config (weights, filters, calibration)
- `src/lib/fbs-teams.ts` - FBS team filter (excludes FCS games)
- `src/lib/team-aliases.ts` - Team name mapping (Odds API → DB)

### Backtest Scripts
- `scripts/cfb-t60-backtest-fbs.ts` - Main T-60 backtest (FBS only, no confidence filter)
- `scripts/fbs-coverage-report.ts` - FBS coverage analysis
- `scripts/check-t60-coverage.ts` - T-60 match rate by season

### Bowl Game Analysis
- `scripts/test-bowl-game.ts` - Test model on specific games
- `scripts/analyze-all-bowl-games.ts` - Analyze all upcoming bowl games
- `scripts/check-bowl-team-coverage.ts` - Verify 2025 bowl team data

### Legacy/Research
- `src/lib/backtest/ensemble-model.ts` - Old ensemble model (closing line)
- `scripts/final-assessment.ts` - Historical model assessment

### Data Sync
- `src/lib/jobs/poll-odds.ts` - Odds API polling with deduplication
- `src/lib/jobs/sync-results.ts` - CFBD results sync
- `src/lib/jobs/set-closing-lines.ts` - Closing line + prediction locking

### Frontend
- `src/app/page.tsx` - Homepage with stats, results, upcoming games
- `src/app/games/page.tsx` - Full games list with filters
- `src/app/model/page.tsx` - Model documentation page

---

## Environment Variables

```
# Supabase
SUPABASE_URL=https://cdhujemmhfbsmzchsuci.supabase.co
SUPABASE_ANON_KEY=<jwt_token>

# The Odds API
ODDS_API_KEY=<key>

# CollegeFootballData
CFBD_API_KEY=<key>
```

---

## Commands

```bash
# Development
npm run dev

# Build
npm run build

# Run specific sync
SUPABASE_URL="..." SUPABASE_ANON_KEY="..." npx tsx scripts/<script>.ts

# Run backtest calibration
curl http://localhost:3000/api/backtest/calibration?seasons=2022,2023,2024
```

---

## CBB Research — Archived (December 2024)

### Status: ARCHIVED — No Actionable Edge Found

CBB (college basketball) was explored as a potential second market. After comprehensive research, both spreads and totals markets showed high efficiency with no exploitable edge.

### Track A: CBB Spreads + Line Movement

**Dataset:** 5,914 games with DK open and T-60 spreads (2022-2024)

**Research Question:** Does betting WITH or AGAINST line movement produce edge?

**Scripts:**
- `scripts/sync-cbb-dk-open-v3.ts` - Synced DK opening spreads (93.5% coverage)
- `scripts/cbb-line-movement-backtest.ts` - WITH/AGAINST move analysis

**Results:**

| Strategy | Move Filter | Win% | ROI |
|----------|-------------|------|-----|
| WITH move | 0.5+ pts | 51.7% | -1.2% |
| AGAINST move | 0.5+ pts | 48.3% | -7.8% |
| WITH move | 1+ pts | 51.8% | -1.1% |
| AGAINST move | 3+ pts | 52.4% | +0.0% |

**Conclusion:** No reliable edge. Large season variance (2023 favored WITH, 2024 favored AGAINST at 3+), no monotonic relationship with move magnitude. Market is efficient.

### Track B: CBB Totals + Structural Signals

**Dataset:** 18,689 games with closing totals and results (2022-2025)

**Research Question:** Do rest days, schedule compression, or season phase predict totals?

**Scripts:**
- `scripts/cbb-totals-baseline.ts` - Baseline + structural signal analysis

**Results:**

| Signal | Games | Over% | Best Bet | ROI |
|--------|-------|-------|----------|-----|
| Baseline (all) | 18,689 | 49.9% | — | -4.5% |
| 8+ days rest | 646 | 53.8% | Over | +2.7% |
| Back-to-back | 1,655 | 52.7% | Over | +0.6% |
| 2-3 days rest | 4,115 | 48.4% | Under | -1.5% |

**Conclusion:** Market efficient. Only 8+ day rest shows marginal edge (+2.7%) but sample too small (646 games) and signal too weak to be actionable.

### Why CBB Was Archived

1. **Spreads:** Line movement contains no signal — neither following nor fading sharps works
2. **Totals:** Structural signals too weak to overcome vig
3. **Opportunity cost:** CFB model shows stronger backtest results (2.5-5 pt edge with +6-13% ROI) and needs T-60 validation before capital deployment

### CBB Tables (for reference)

```
cbb_games           - Games with scores, team IDs
cbb_teams           - Team lookup with aliases
cbb_betting_lines   - Spreads/totals at various timestamps
cbb_sync_progress   - Sync tracking for resumability
```

---

## 2025 Bowl Season Data (Current)

### Data Sources for 2025 Bowl Games

| Component | Data Used | Source |
|-----------|-----------|--------|
| Elo | Week 16 (latest) | `team_elo_snapshots` table |
| SP+ | 2025 season ratings | `advanced_team_ratings` table |
| PPA | 2025 season ratings | `advanced_team_ratings` table |

**Verified December 22, 2025:**
- Elo ratings are current (Week 16 = post-conference championship)
- Week 15 = Week 16 Elo because bowl games haven't occurred yet (expected)
- SP+ and PPA are season-level 2025 ratings from CFBD API

### Elo Verification

Many teams end the season with similar Elo to preseason (regression to mean). This is NOT a bug:
- Teams that over/underperform early regress back
- CFBD data matches our database exactly
- Script to verify: `scripts/verify-elo-accuracy.ts`

---

## Notes

- **Population**: FBS games only (FCS excluded via `src/lib/fbs-teams.ts`)
- **Execution Line**: T-60 (DraftKings spread 60 min before kickoff)
- **Edge Filter**: 2.5-5 points (below = vig eats profit, above = model likely wrong)
- **No Confidence Filter**: All model disagreement levels included (removed after backtest showed no benefit)
- **Odds Source**: DraftKings primary
- **Bowl Season**: End-of-season Elo (week 16) used for bowl games
- **Team Aliasing**: Odds API names mapped to DB names via `src/lib/team-aliases.ts`
