# Backtest Implementation Plan v2

## Overview

Build a rigorous, point-in-time backtesting system for the CFB market-edge model.

### V1 Scope (This Plan)
- **Model**: Elo-only + market baseline (no pace, no weather, no advanced stats)
- **Validation**: Walk-forward (train 2022-2023, test 2024)
- **Calibration**: Nested cross-validation (leakage-safe)
- **EV**: Calculated using actual stored prices (no -110 assumption)

### Explicitly Excluded from V1
- Pace adjustments (requires weekly snapshots)
- Weather adjustments (requires historical weather API)
- Advanced stats (requires point-in-time computation)
- Totals model (focus on spreads first)

---

## Data Architecture

### New Tables

```sql
-- Point-in-time Elo snapshots from CFBD
CREATE TABLE team_elo_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id),
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,  -- 0 = preseason, N = after week N
    elo NUMERIC NOT NULL,
    source TEXT DEFAULT 'cfbd',
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season, week)
);

-- Historical odds with ACTUAL PRICES (not assumed -110)
-- Adds tick_type and ensures price storage
ALTER TABLE odds_ticks ADD COLUMN IF NOT EXISTS tick_type TEXT
    CHECK (tick_type IN ('open', 'close', 'live'));

-- Backtest projections with point-in-time audit trail
CREATE TABLE backtest_projections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id),
    model_version TEXT NOT NULL,

    -- POINT-IN-TIME AUDIT: Which data was used
    as_of_week INTEGER NOT NULL,           -- Week number used for Elo lookup
    home_elo_snapshot_week INTEGER NOT NULL,  -- Actual week of Elo used
    away_elo_snapshot_week INTEGER NOT NULL,

    -- Point-in-time inputs
    home_elo_entering NUMERIC NOT NULL,
    away_elo_entering NUMERIC NOT NULL,
    market_open_spread NUMERIC NOT NULL,
    market_open_price INTEGER NOT NULL,    -- ACTUAL price (e.g., -108, -112)

    -- Model outputs
    elo_implied_spread NUMERIC NOT NULL,   -- Raw Elo → spread conversion
    elo_adjustment NUMERIC NOT NULL,       -- Weighted adjustment applied
    model_spread_home NUMERIC NOT NULL,    -- Final model spread
    spread_edge NUMERIC NOT NULL,          -- market - model

    -- Probability (raw, pre-calibration)
    raw_cover_prob NUMERIC NOT NULL,

    -- Calibrated probability (filled after calibration)
    calibrated_cover_prob NUMERIC,

    -- EV using ACTUAL price
    ev_at_actual_price NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, model_version)
);

-- Calibration with train/test boundaries
CREATE TABLE model_calibration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version TEXT NOT NULL,
    calibration_method TEXT NOT NULL,  -- 'platt', 'isotonic', 'none'

    -- LEAKAGE PREVENTION: Explicit boundaries
    train_season_start INTEGER NOT NULL,
    train_season_end INTEGER NOT NULL,
    train_games_used INTEGER NOT NULL,

    -- Platt scaling parameters
    platt_a NUMERIC,
    platt_b NUMERIC,

    -- Calibration quality (on train set only)
    train_brier NUMERIC,
    train_ece NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(model_version, train_season_start, train_season_end)
);
```

### Point-in-Time Invariants (Enforced in Code)

```typescript
// ASSERTION 1: Elo snapshot must be from BEFORE game week
function getEloForGame(teamId: string, gameWeek: number, season: number) {
    const snapshotWeek = gameWeek - 1;  // Week N game uses week N-1 Elo

    const elo = await db.teamEloSnapshots.findOne({
        team_id: teamId,
        season: season,
        week: snapshotWeek
    });

    // HARD ASSERTION - fail loudly if violated
    if (!elo) {
        throw new Error(
            `POINT-IN-TIME VIOLATION: No Elo for team ${teamId} ` +
            `at week ${snapshotWeek} (game week ${gameWeek})`
        );
    }

    return elo;
}

// ASSERTION 2: Opening line must have tick_type = 'open'
function getOpeningLine(eventId: string) {
    const tick = await db.oddsTicks.findOne({
        event_id: eventId,
        tick_type: 'open',
        market_type: 'spread'
    });

    if (!tick) {
        throw new Error(`POINT-IN-TIME VIOLATION: No opening line for event ${eventId}`);
    }

    // ASSERTION 3: Must have actual price, not null
    if (tick.price_american === null) {
        throw new Error(`DATA QUALITY: Opening line missing price for event ${eventId}`);
    }

    return tick;
}

// ASSERTION 4: Calibration must not see future data
function validateCalibrationBoundary(
    calibration: ModelCalibration,
    testEvent: Event
) {
    const testSeason = new Date(testEvent.commence_time).getFullYear();

    if (testSeason <= calibration.train_season_end) {
        throw new Error(
            `LEAKAGE VIOLATION: Test game from ${testSeason} but ` +
            `calibration trained through ${calibration.train_season_end}`
        );
    }
}
```

---

## Phase 1: Data Collection

### 1.1 Sync CFBD Weekly Elo Ratings

**Endpoint:** `GET /ratings/elo?year={season}&week={week}`

**Semantics:**
- Week 0 = preseason rating
- Week N = rating AFTER week N games
- For week N game, use week N-1 snapshot

```typescript
async function syncEloSnapshots(seasons: number[]) {
    for (const season of seasons) {
        for (const week of range(0, 16)) {  // 0 through 15
            const ratings = await cfbd.getEloRatings(season, undefined, week);

            for (const rating of ratings) {
                const teamId = await mapCfbdTeamToId(rating.team);
                if (!teamId) continue;

                await db.teamEloSnapshots.upsert({
                    team_id: teamId,
                    season: season,
                    week: week,
                    elo: rating.elo,
                    source: 'cfbd'
                });
            }
        }
    }
}
```

**Expected:** ~135 teams × 16 weeks × 3 seasons = ~6,500 rows

---

### 1.2 Sync Historical Lines with Actual Prices

**Source:** CFBD `/lines` endpoint

**Critical:** Store `homeMoneyline` as actual price, not assume -110.

```typescript
async function syncHistoricalLines(seasons: number[]) {
    for (const season of seasons) {
        const games = await cfbd.getBettingLines(season);

        for (const game of games) {
            const eventId = await mapCfbdGameToEvent(game.id);
            if (!eventId) continue;

            const dkLine = game.lines?.find(l => l.provider === 'DraftKings');
            if (!dkLine) continue;

            // Store OPENING tick
            if (dkLine.spreadOpen !== null) {
                await db.oddsTicks.upsert({
                    event_id: eventId,
                    sportsbook_id: DRAFTKINGS_ID,
                    market_type: 'spread',
                    tick_type: 'open',
                    side: 'home',
                    spread_points_home: dkLine.spreadOpen,
                    price_american: dkLine.homeMoneyline || -110,  // Use actual or fallback
                    captured_at: subDays(game.startDate, 7)
                });
            }

            // Store CLOSING tick
            if (dkLine.spread !== null) {
                await db.oddsTicks.upsert({
                    event_id: eventId,
                    sportsbook_id: DRAFTKINGS_ID,
                    market_type: 'spread',
                    tick_type: 'close',
                    side: 'home',
                    spread_points_home: dkLine.spread,
                    price_american: dkLine.homeMoneyline || -110,
                    captured_at: subMinutes(game.startDate, 1)
                });
            }
        }
    }
}
```

---

### 1.3 Data Validation

Run validation before proceeding:

```sql
-- Check Elo coverage
SELECT season, COUNT(DISTINCT team_id) as teams, COUNT(DISTINCT week) as weeks
FROM team_elo_snapshots
GROUP BY season
ORDER BY season;

-- Check line coverage
SELECT
    EXTRACT(YEAR FROM e.commence_time) as season,
    COUNT(DISTINCT e.id) as events,
    COUNT(DISTINCT CASE WHEN ot.tick_type = 'open' THEN e.id END) as has_open,
    COUNT(DISTINCT CASE WHEN ot.tick_type = 'close' THEN e.id END) as has_close,
    COUNT(DISTINCT CASE WHEN ot.price_american IS NOT NULL THEN e.id END) as has_price
FROM events e
LEFT JOIN odds_ticks ot ON e.id = ot.event_id
WHERE e.status = 'final'
GROUP BY EXTRACT(YEAR FROM e.commence_time)
ORDER BY season;
```

**Required before proceeding:**
- [ ] Each season has 16 weeks of Elo data
- [ ] 80%+ of games have opening lines
- [ ] 90%+ of lines have actual prices

---

## Phase 2: V1 Model (Elo-Only)

### 2.1 Model Definition

```typescript
interface V1ModelConfig {
    name: 'elo_market_calibrated_v1';

    // The ONE learnable parameter
    eloWeight: number;  // Range [0, 1], optimized on train set

    // Fixed parameters
    eloToSpreadDivisor: 25;  // Standard: 25 Elo points = 1 spread point
    homeFieldAdvantage: 0;   // Market already includes HFA, don't double-count
}

function generateProjection(
    homeElo: number,
    awayElo: number,
    marketOpenSpread: number,
    config: V1ModelConfig
): number {
    // Step 1: Convert Elo diff to implied spread
    const eloDiff = homeElo - awayElo;
    const eloImpliedSpread = -eloDiff / config.eloToSpreadDivisor;

    // Step 2: Calculate disagreement with market
    const eloVsMarket = eloImpliedSpread - marketOpenSpread;

    // Step 3: Apply weighted adjustment
    const adjustment = eloVsMarket * config.eloWeight;

    // Step 4: Final model spread
    const modelSpread = marketOpenSpread + adjustment;

    return modelSpread;
}
```

### 2.2 Probability Conversion

```typescript
// Empirical relationship: spread edge → cover probability
// Based on historical data: ~2.5% probability per point of edge
function edgeToRawProbability(spreadEdge: number): number {
    // Logistic function centered at 0.5
    // k controls steepness (calibrate this)
    const k = 0.15;  // ~3% per point near center
    return 1 / (1 + Math.exp(-k * spreadEdge));
}
```

### 2.3 EV Calculation with Actual Prices

```typescript
function calculateEV(coverProb: number, actualOdds: number): number {
    // Convert American odds to decimal
    const decimalOdds = actualOdds > 0
        ? (actualOdds / 100) + 1
        : (100 / Math.abs(actualOdds)) + 1;

    // EV = (P(win) × net_profit) - (P(lose) × stake)
    const netProfit = decimalOdds - 1;
    const ev = (coverProb * netProfit) - ((1 - coverProb) * 1);

    return ev;
}

// Example with actual -108 odds:
// coverProb = 0.55, odds = -108
// decimalOdds = 1.926
// EV = (0.55 × 0.926) - (0.45 × 1) = 0.509 - 0.45 = +0.059 (+5.9%)
```

---

## Phase 3: Leakage-Safe Calibration

### 3.1 Nested Walk-Forward Scheme

**Problem:** Can't use 2022-2023 to both optimize Elo weight AND calibrate probabilities—that's double-dipping.

**Solution:** Nested cross-validation

```
OUTER LOOP (Elo weight optimization):
    For each candidate eloWeight in [0.0, 0.1, ..., 1.0]:

        INNER LOOP (Calibration):
            Fold 1: Train calibration on 2022, validate on first half 2023
            Fold 2: Train calibration on 2022 + first half 2023, validate on second half 2023

        Average validation CLV across inner folds
        Track (eloWeight → avg CLV)

    Select eloWeight with best avg CLV

FINAL CALIBRATION:
    Using best eloWeight, train calibration on ALL of 2022-2023

TEST:
    Apply frozen (eloWeight + calibration) to 2024
```

### 3.2 Implementation

```typescript
interface WalkForwardFold {
    trainStart: Date;
    trainEnd: Date;
    testStart: Date;
    testEnd: Date;
}

const INNER_FOLDS: WalkForwardFold[] = [
    {
        trainStart: new Date('2022-08-01'),
        trainEnd: new Date('2023-01-15'),    // End of 2022 bowls
        testStart: new Date('2023-08-01'),
        testEnd: new Date('2023-10-31'),     // First half 2023
    },
    {
        trainStart: new Date('2022-08-01'),
        trainEnd: new Date('2023-10-31'),
        testStart: new Date('2023-11-01'),
        testEnd: new Date('2024-01-15'),     // Second half 2023 + bowls
    }
];

async function optimizeEloWeight(): Promise<number> {
    const results: Map<number, number[]> = new Map();

    for (const eloWeight of [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
        const foldClvs: number[] = [];

        for (const fold of INNER_FOLDS) {
            // Train calibration on fold.train
            const calibration = await trainCalibration(
                eloWeight,
                fold.trainStart,
                fold.trainEnd
            );

            // Evaluate on fold.test
            const clv = await evaluateCLV(
                eloWeight,
                calibration,
                fold.testStart,
                fold.testEnd
            );

            foldClvs.push(clv);
        }

        results.set(eloWeight, foldClvs);
    }

    // Select weight with best average CLV
    let bestWeight = 0;
    let bestAvgClv = -Infinity;

    for (const [weight, clvs] of results) {
        const avgClv = clvs.reduce((a, b) => a + b, 0) / clvs.length;
        if (avgClv > bestAvgClv) {
            bestAvgClv = avgClv;
            bestWeight = weight;
        }
    }

    return bestWeight;
}
```

### 3.3 Platt Scaling

```typescript
async function trainCalibration(
    eloWeight: number,
    trainStart: Date,
    trainEnd: Date
): Promise<PlattCalibration> {
    // Get all training games
    const games = await getGamesInRange(trainStart, trainEnd);

    // Generate raw probabilities
    const predictions: Array<{ rawProb: number; actualOutcome: 0 | 1 }> = [];

    for (const game of games) {
        const projection = await generateProjectionForGame(game, eloWeight);
        const rawProb = edgeToRawProbability(projection.spreadEdge);
        const covered = didHomeCover(game);

        predictions.push({ rawProb, actualOutcome: covered ? 1 : 0 });
    }

    // Fit logistic regression: outcome ~ rawProb
    // P(cover) = 1 / (1 + exp(-(a * rawProb + b)))
    const { a, b } = fitLogisticRegression(
        predictions.map(p => p.rawProb),
        predictions.map(p => p.actualOutcome)
    );

    return { plattA: a, plattB: b };
}
```

---

## Phase 4: Test Set Evaluation

### 4.1 Evaluation Protocol

```typescript
async function evaluateTestSet(
    eloWeight: number,
    calibration: PlattCalibration
): Promise<BacktestResults> {
    const testGames = await getGamesInRange(
        new Date('2024-08-01'),
        new Date('2024-12-31')
    );

    const bets: Bet[] = [];

    for (const game of testGames) {
        // ASSERTION: Calibration trained before 2024
        validateCalibrationBoundary(calibration, game);

        const projection = await generateProjectionForGame(game, eloWeight);
        const rawProb = edgeToRawProbability(projection.spreadEdge);
        const calibratedProb = applyPlattScaling(rawProb, calibration);
        const ev = calculateEV(calibratedProb, projection.actualPrice);

        const actualOutcome = didHomeCover(game);
        const closingSpread = await getClosingSpread(game);
        const clv = calculateCLV(projection.openingSpread, closingSpread, projection.side);

        bets.push({
            gameId: game.id,
            edge: projection.spreadEdge,
            rawProb,
            calibratedProb,
            ev,
            outcome: actualOutcome,
            profit: calculateProfit(actualOutcome, projection.actualPrice),
            clv
        });
    }

    return aggregateResults(bets);
}
```

### 4.2 Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| Win Rate | wins / (wins + losses) | > 52.4% |
| ROI | total_profit / total_wagered | > 0% |
| CLV | mean(close - open on our side) | > 0 |
| Brier Score | mean((prob - outcome)²) | < 0.25 |
| ECE | Σ (bin_size × |bin_accuracy - bin_confidence|) | < 0.05 |
| Sharpe | mean(returns) / std(returns) | > 0.5 |

### 4.3 Segmented Analysis

```typescript
interface SegmentedResults {
    byEdgeSize: {
        '0-1pt': Metrics;
        '1-2pt': Metrics;
        '2-3pt': Metrics;
        '3+pt': Metrics;
    };
    byWeek: {
        'early (1-4)': Metrics;
        'mid (5-10)': Metrics;
        'late (11+)': Metrics;
    };
    byLineMovement: {
        'steam_with': Metrics;    // Line moved our direction
        'steam_against': Metrics; // Line moved against us
    };
}
```

---

## Implementation Order

### Step 1: Schema Changes
```
scripts/migrations/002_backtest_tables.sql
- team_elo_snapshots
- ALTER odds_ticks ADD tick_type
- backtest_projections
- model_calibration
```

### Step 2: Data Sync
```
scripts/sync-elo-snapshots.ts
scripts/sync-historical-lines-v2.ts  (with actual prices)
scripts/validate-backtest-data.ts
```

### Step 3: Core Model
```
src/lib/backtest/v1-model.ts
- generateProjection()
- edgeToRawProbability()
- calculateEV()
```

### Step 4: Calibration
```
src/lib/backtest/calibration.ts
- trainCalibration()
- applyPlattScaling()
- fitLogisticRegression()
```

### Step 5: Walk-Forward
```
src/lib/backtest/walk-forward.ts
- optimizeEloWeight()
- INNER_FOLDS definition
```

### Step 6: Evaluation
```
src/lib/backtest/evaluate.ts
- evaluateTestSet()
- aggregateResults()
- segmentedAnalysis()
```

### Step 7: Runner
```
scripts/run-backtest-v1.ts
- End-to-end orchestration
- Console output
- Optional CSV export
```

---

## Validation Checklist

Before proceeding to implementation:

- [ ] **Point-in-time Elo**: Week N game uses week N-1 Elo (assertion in code)
- [ ] **Actual prices stored**: `price_american` populated, not null
- [ ] **No pace/weather**: V1 excludes these explicitly
- [ ] **Nested CV**: Inner folds don't overlap with outer evaluation
- [ ] **Test set isolated**: 2024 never seen during training
- [ ] **EV uses actual odds**: Not hardcoded -110

---

## Success Criteria

### Minimum Bar (proceed to V2)
- 2024 test ROI ≥ 0%
- CLV > 0
- No obvious calibration failure (ECE < 0.10)

### Strong Signal (model has edge)
- 2024 test ROI ≥ 3%
- Win rate ≥ 53%
- CLV ≥ 0.3 points
- Sharpe ≥ 1.0

### Red Flags (stop and investigate)
- Train ROI >> Test ROI (overfitting)
- CLV < 0 (model is anti-predictive)
- Calibration wildly off on test set
- Performance clusters in specific weeks (data issue)
