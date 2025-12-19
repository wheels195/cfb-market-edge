# CFB Market-Edge: Production Model Plan

## Executive Summary

This document outlines the complete plan to build a production-ready college football betting model. The model's purpose is **line projection** — determining what the spread/total should be given available information — not outcome prediction.

**Core Principle:** At any point in time, the model may only use information that would have been available at that moment.

---

## Part 1: Current State (What We've Built)

### Infrastructure ✅

| Component | Status | Details |
|-----------|--------|---------|
| Next.js 14 App | Complete | App Router, TypeScript, Tailwind CSS |
| Supabase Database | Complete | Postgres with proper schema |
| The Odds API Client | Complete | Events, odds polling, line snapshots |
| CFBD API Client | Complete | Games, results, teams, ratings |
| Vercel Deployment | Ready | Cron jobs configured |

### Data Successfully Synced ✅

| Data Type | Count | Source | Notes |
|-----------|-------|--------|-------|
| Events | 4,172 | Odds API + CFBD | 2022-2025 seasons |
| Results | 4,172 | CFBD | Final scores for all games |
| Closing Lines | 27,910 | CFBD | Spreads and totals |
| Teams | 787 | Both APIs | With name mappings |
| Odds Ticks | Variable | Odds API | Real-time line snapshots |

### Data Synced But NOT Used in Model ❌

| Data Type | Count | Source | Why Not Used |
|-----------|-------|--------|--------------|
| SP+ Ratings | 814 | CFBD | Post-season calculation (future data leak) |
| Recruiting Rankings | Synced | CFBD | Not incorporated into model |
| Talent Composite | Synced | CFBD | Not incorporated into model |
| Advanced Stats (PPA, etc.) | Synced | CFBD | Not incorporated into model |

### What We Learned (Failures)

1. **Using end-of-season SP+ leaks future data** — Backtest results were invalid
2. **Using prior-season SP+ alone yields -5% ROI** — Market already prices this in
3. **We measured wrong metrics** — Win rate and ROI instead of CLV
4. **No walk-forward simulation** — Didn't respect chronological ordering
5. **Didn't use all available data** — Ignored injuries, weather, advanced stats

---

## Part 2: Available Data Inventory

### From CollegeFootballData API

| Endpoint | Data Available | Point-in-Time? | Priority |
|----------|---------------|----------------|----------|
| `/games` | Schedule, results, venue, weather | Yes (after game) | Critical |
| `/games/teams` | Team box scores | Yes (after game) | High |
| `/drives` | Drive-level data | Yes (after game) | Medium |
| `/plays` | Play-by-play | Yes (after game) | Low (v2) |
| `/stats/season` | Season team stats | Cumulative | High |
| `/stats/game` | Per-game team stats | Yes | High |
| `/player/usage` | Player snap counts | Yes | Medium |
| `/injuries` | Injury reports | Yes (weekly) | Critical |
| `/weather` | Game weather | Yes (forecast) | High (totals) |
| `/recruiting/teams` | Recruiting rankings | Preseason | Medium |
| `/talent` | Talent composite | Preseason | Medium |
| `/coaches` | Coach records | Yes | Low |
| `/venues` | Stadium info, capacity, elevation | Static | Low |
| `/lines` | Historical betting lines | Yes | Critical |
| `/ratings/sp` | SP+ ratings | NO (post-season) | Do Not Use Directly |
| `/ratings/elo` | CFBD Elo | Weekly | Reference Only |
| `/ppa/teams` | Predicted Points Added | Cumulative | High |
| `/stats/season/advanced` | Success rate, explosiveness, havoc | Cumulative | High |

### From The Odds API

| Endpoint | Data Available | Point-in-Time? | Priority |
|----------|---------------|----------------|----------|
| `/sports/{sport}/events` | Upcoming games | Yes | Critical |
| `/sports/{sport}/odds` | Current odds, multiple books | Yes | Critical |
| `/sports/{sport}/scores` | Live scores | Yes | Medium |
| Historical odds | Line movement over time | Yes | High |

### What We Must Use (Currently Ignored)

1. **Injuries** — QB status alone can swing a line 3-7 points
2. **Weather** — Wind/cold significantly impacts totals
3. **Advanced stats** — PPA, success rate give week-by-week signal
4. **Recruiting/Talent** — Preseason priors for rating initialization
5. **Line movement** — Sharp money indicator

---

## Part 3: The Correct Model Architecture

### Mental Model Shift

```
OLD (Wrong):                    NEW (Correct):
─────────────────               ─────────────────
"Who will win?"                 "What should the line be?"
"What's the final score?"       "Given what we know NOW"
Train on outcomes               Project lines, measure CLV
Use end-of-season data          Walk forward chronologically
Measure win rate                Measure Closing Line Value
```

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     WALK-FORWARD ENGINE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐     ┌──────────────┐     ┌────────────────┐  │
│   │   RATING    │     │  PROJECTION  │     │  EVALUATION    │  │
│   │   SYSTEM    │────▶│    ENGINE    │────▶│    (CLV)       │  │
│   └─────────────┘     └──────────────┘     └────────────────┘  │
│         │                    │                     │            │
│         ▼                    ▼                     ▼            │
│   ┌─────────────┐     ┌──────────────┐     ┌────────────────┐  │
│   │ Team Elo    │     │ Spread Model │     │ Beat Close?    │  │
│   │ (dynamic)   │     │ Total Model  │     │ By how much?   │  │
│   │ Updates     │     │ + Features   │     │ How often?     │  │
│   │ weekly      │     │              │     │                │  │
│   └─────────────┘     └──────────────┘     └────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │        FEATURE INPUTS         │
              │  (Point-in-Time Only)         │
              ├───────────────────────────────┤
              │ • Current team ratings        │
              │ • Recent form (last 3-5)      │
              │ • Injuries (as of game day)   │
              │ • Weather forecast            │
              │ • Rest days / travel          │
              │ • Home field advantage        │
              │ • Line movement signals       │
              │ • Preseason priors            │
              └───────────────────────────────┘
```

---

## Part 4: Implementation Plan

### Phase 1: Dynamic Rating System

**Goal:** Build Elo-style ratings that update after each game, storing point-in-time snapshots.

**Tasks:**

1. Create `team_ratings_history` table
   ```sql
   CREATE TABLE team_ratings_history (
     id UUID PRIMARY KEY,
     team_id UUID REFERENCES teams(id),
     season INTEGER,
     week INTEGER,
     rating NUMERIC,           -- Overall Elo-style rating
     off_rating NUMERIC,       -- Offensive component
     def_rating NUMERIC,       -- Defensive component
     games_played INTEGER,
     created_at TIMESTAMPTZ,
     UNIQUE(team_id, season, week)
   );
   ```

2. Implement rating initialization
   - New season: `rating = 0.6 * last_season_final + 0.4 * league_average`
   - New teams: Use recruiting rank as proxy

3. Implement rating update after each game
   - Use margin of victory with diminishing returns (cap at ~28 points)
   - Apply home field normalization
   - K-factor that decreases as season progresses

4. Create snapshot at each week
   - Freeze ratings before projecting upcoming games
   - Store in `team_ratings_history`

**Files to Create:**
- `src/lib/models/rating-system.ts`
- `src/lib/models/rating-updater.ts`
- `scripts/build-historical-ratings.ts`

---

### Phase 2: Walk-Forward Simulation Engine

**Goal:** Process historical games chronologically, generating projections using only past data.

**Tasks:**

1. Create `projections_history` table
   ```sql
   CREATE TABLE projections_history (
     id UUID PRIMARY KEY,
     event_id UUID REFERENCES events(id),
     projection_time TIMESTAMPTZ,      -- When projection was made
     model_spread_home NUMERIC,
     model_total NUMERIC,
     closing_spread NUMERIC,
     closing_total NUMERIC,
     clv_spread NUMERIC,               -- model_spread - closing_spread
     clv_total NUMERIC,
     result_margin INTEGER,            -- Actual margin (for analysis)
     UNIQUE(event_id)
   );
   ```

2. Build walk-forward loop
   ```typescript
   for (const season of [2022, 2023, 2024]) {
     initializeRatings(season);

     for (const week of getWeeks(season)) {
       // 1. Get games for this week
       const games = getGamesForWeek(season, week);

       // 2. Generate projections (ratings frozen from previous week)
       for (const game of games) {
         const projection = generateProjection(game, currentRatings);
         storeProjection(projection);
       }

       // 3. After games complete, update ratings
       for (const game of getCompletedGames(season, week)) {
         updateRatings(game);
       }

       // 4. Snapshot ratings for next week
       snapshotRatings(season, week);
     }
   }
   ```

3. Calculate CLV for each projection
   - `clv_spread = projected_spread - closing_spread`
   - Positive CLV = we got a better number than the market

**Files to Create:**
- `src/lib/backtest/walk-forward.ts`
- `src/lib/backtest/clv-calculator.ts`
- `scripts/run-walk-forward.ts`

---

### Phase 3: Feature Integration

**Goal:** Add all available point-in-time features to projection engine.

**3A. Injuries (Critical)**

1. Sync historical injury data from CFBD
2. Create injury impact model
   - QB out: +/- 3-7 points
   - Key skill players: +/- 1-2 points
   - Multiple starters: compound effect

3. Apply injury adjustment to projections

**3B. Weather (High Priority for Totals)**

1. Sync weather data for all games
2. Create weather adjustment model
   - High wind (>15mph): Reduce total by 2-4 points
   - Extreme cold (<32°F): Reduce total by 1-2 points
   - Rain/snow: Reduce total by 1-3 points

3. Apply to totals projections only

**3C. Recent Form**

1. Calculate rolling metrics (last 3-5 games)
   - Margin of victory
   - Offensive/defensive efficiency
   - Turnover differential

2. Weight recent performance higher than early season

**3D. Rest & Travel**

1. Calculate days since last game
2. Calculate travel distance
3. Apply adjustments
   - Short rest (<6 days): Slight penalty
   - Long travel + short rest: Larger penalty
   - Bye week advantage: Slight boost

**3E. Line Movement (Sharp Money Signal)**

1. Track opening line to current line
2. Large moves toward one side = sharp money
3. Can use as confirmation signal (not primary)

**Files to Create:**
- `src/lib/features/injuries.ts`
- `src/lib/features/weather.ts`
- `src/lib/features/form.ts`
- `src/lib/features/rest-travel.ts`
- `src/lib/features/line-movement.ts`
- `scripts/sync-injuries.ts`
- `scripts/sync-weather.ts`

---

### Phase 4: Parameter Tuning

**Goal:** Optimize model parameters using CLV as the objective.

**Method:**
- Tuning set: 2022 season
- Validation set: 2023-2024 seasons
- Never tune on validation data

**Parameters to Tune:**

| Parameter | Description | Initial | Range |
|-----------|-------------|---------|-------|
| `K_FACTOR_EARLY` | Rating volatility (weeks 1-4) | 32 | 20-50 |
| `K_FACTOR_LATE` | Rating volatility (weeks 5+) | 20 | 10-30 |
| `HFA_SPREAD` | Home field advantage (spread) | 2.5 | 2.0-4.0 |
| `HFA_TOTAL` | Home field advantage (total) | 1.0 | 0-2.0 |
| `MOV_CAP` | Margin of victory cap | 28 | 21-35 |
| `MOV_SCALE` | MOV diminishing returns | 0.8 | 0.6-1.0 |
| `REGRESSION_FACTOR` | Preseason regression to mean | 0.4 | 0.3-0.5 |
| `WEATHER_WIND_COEF` | Wind impact on totals | -0.2 | -0.3 to -0.1 |
| `INJURY_QB_IMPACT` | QB injury point swing | 5.0 | 3.0-7.0 |

**Tuning Process:**

```typescript
function tune(params: ModelParams): TuningResult {
  // Run walk-forward on 2022
  const results = runWalkForward(2022, params);

  // Calculate CLV metrics
  return {
    meanCLV: mean(results.clvs),
    clvPositiveRate: results.clvs.filter(c => c > 0).length / results.length,
    clvStdDev: stdDev(results.clvs)
  };
}

// Grid search or Bayesian optimization
const bestParams = optimize(tune, parameterRanges);

// Validate on 2023-2024
const validation = runWalkForward([2023, 2024], bestParams);
```

**Files to Create:**
- `src/lib/tuning/parameter-search.ts`
- `src/lib/tuning/clv-metrics.ts`
- `scripts/tune-model.ts`

---

### Phase 5: Production Deployment

**Goal:** Deploy model for live betting decisions.

**5A. Live Projection Pipeline**

1. Daily job to update ratings (after yesterday's games)
2. Generate projections for upcoming games
3. Compare to current market lines
4. Surface edges meeting threshold

**5B. Hypothetical Bet Tracking**

1. When edge exceeds threshold, log "bet"
2. Track line at bet time
3. Compare to closing line (CLV)
4. Track actual result
5. Calculate running P&L

**5C. Monitoring Dashboard**

- Current week's edges
- Historical CLV by week
- Rating leaderboard
- Model health metrics

**Files to Create:**
- `src/app/api/cron/update-ratings/route.ts`
- `src/app/api/cron/generate-projections/route.ts`
- `src/lib/tracking/bet-tracker.ts`
- `src/app/dashboard/page.tsx`

---

## Part 5: Evaluation Framework

### Primary Metric: Closing Line Value (CLV)

```
CLV = Your Projected Line - Closing Line

Example (Spread):
  Your projection: Home -3.5
  Closing line: Home -6.0
  CLV = -3.5 - (-6.0) = +2.5 points

  If you bet Home -3.5, you got 2.5 points of value.
```

### CLV Targets

| Metric | Poor | Acceptable | Good | Excellent |
|--------|------|------------|------|-----------|
| Mean CLV | < 0 | 0 to 0.5 | 0.5 to 1.0 | > 1.0 |
| CLV+ Rate | < 50% | 50-52% | 52-55% | > 55% |
| CLV Sharpe | < 0.1 | 0.1-0.2 | 0.2-0.3 | > 0.3 |

### Secondary Metrics

1. **Edge Persistence** — Does your edge survive to close?
2. **Directional Accuracy** — Did the line move your way?
3. **Segment Analysis** — CLV by game type (favorites, totals, etc.)

### What NOT to Optimize

- ❌ Win rate (too noisy, vig destroys marginal edges)
- ❌ ROI (variance too high for small samples)
- ❌ ATS record (same as win rate)

---

## Part 6: Timeline & Milestones

### Week 1: Rating System
- [ ] Design `team_ratings_history` schema
- [ ] Implement Elo update function
- [ ] Build historical ratings for 2021-2024
- [ ] Validate ratings make intuitive sense

### Week 2: Walk-Forward Engine
- [ ] Build chronological game processor
- [ ] Implement projection generation
- [ ] Calculate CLV for all historical games
- [ ] Establish baseline CLV metrics

### Week 3: Feature Integration
- [ ] Sync injury data
- [ ] Sync weather data
- [ ] Implement feature extractors
- [ ] Integrate features into projections

### Week 4: Tuning & Validation
- [ ] Implement parameter search
- [ ] Tune on 2022 data
- [ ] Validate on 2023-2024
- [ ] Document optimal parameters

### Week 5: Production
- [ ] Deploy live projection pipeline
- [ ] Implement bet tracker
- [ ] Build monitoring dashboard
- [ ] Begin paper trading

---

## Part 7: File Structure

```
cfb-market-edge/
├── src/
│   ├── lib/
│   │   ├── models/
│   │   │   ├── rating-system.ts      # Elo-style rating engine
│   │   │   ├── rating-updater.ts     # Weekly update logic
│   │   │   └── projection-engine.ts  # Line projection
│   │   ├── features/
│   │   │   ├── injuries.ts           # Injury impact model
│   │   │   ├── weather.ts            # Weather adjustments
│   │   │   ├── form.ts               # Recent form metrics
│   │   │   ├── rest-travel.ts        # Rest/travel factors
│   │   │   └── line-movement.ts      # Sharp money signals
│   │   ├── backtest/
│   │   │   ├── walk-forward.ts       # Chronological simulation
│   │   │   └── clv-calculator.ts     # CLV computation
│   │   ├── tuning/
│   │   │   ├── parameter-search.ts   # Optimization logic
│   │   │   └── clv-metrics.ts        # Evaluation metrics
│   │   └── tracking/
│   │       └── bet-tracker.ts        # Hypothetical bet log
│   └── app/
│       ├── dashboard/
│       │   └── page.tsx              # Monitoring UI
│       └── api/
│           └── cron/
│               ├── update-ratings/
│               └── generate-projections/
├── scripts/
│   ├── build-historical-ratings.ts   # One-time rating build
│   ├── run-walk-forward.ts           # Backtest runner
│   ├── tune-model.ts                 # Parameter optimization
│   ├── sync-injuries.ts              # Injury data sync
│   └── sync-weather.ts               # Weather data sync
└── supabase/
    └── migrations/
        ├── 001_initial_schema.sql
        ├── 002_closing_lines.sql
        ├── 003_advanced_ratings.sql
        ├── 004_ratings_history.sql    # NEW
        └── 005_projections_history.sql # NEW
```

---

## Part 8: Success Criteria

### Model is Production-Ready When:

1. **Walk-forward CLV is positive** on validation set (2023-2024)
2. **CLV+ rate exceeds 52%** consistently
3. **No look-ahead bias** — verified by code review
4. **All features use point-in-time data** — verified by timestamps
5. **Paper trading confirms live CLV** matches backtest

### Red Flags to Watch For:

- Validation CLV much worse than tuning CLV (overfit)
- Large edges that disappear by close (stale data)
- Model disagrees with market by >7 points frequently (data error)
- CLV collapses in live trading (implementation bug)

---

## Appendix: Key Formulas

### Elo Update

```
K = K_FACTOR * (1 - games_played / 15)  # K decreases through season
margin_adj = sign(margin) * min(abs(margin), MOV_CAP) ^ MOV_SCALE
expected = 1 / (1 + 10^((away_rating - home_rating) / 400))
actual = 0.5 + margin_adj / 100  # Scaled to 0-1
new_rating = old_rating + K * (actual - expected)
```

### Spread Projection

```
base_spread = (away_rating - home_rating) / RATING_TO_SPREAD_SCALE
hfa_adj = HFA_SPREAD  # Home team gets this many points
injury_adj = sum(injury_impacts)  # Positive = home helped
spread_projection = base_spread + hfa_adj + injury_adj
```

### Total Projection

```
base_total = LEAGUE_AVG_TOTAL
pace_adj = (home_pace + away_pace - league_avg_pace) * PACE_COEF
weather_adj = wind * WIND_COEF + cold * COLD_COEF
total_projection = base_total + pace_adj + weather_adj
```

### CLV Calculation

```
clv_spread = model_spread - closing_spread
clv_total = model_total - closing_total

# Interpretation:
# clv > 0: Model got a better number than close (good)
# clv < 0: Model got a worse number than close (bad)
```
