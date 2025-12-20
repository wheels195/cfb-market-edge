-- Migration: Backtest V1 Tables
-- Purpose: Support rigorous point-in-time backtesting with Elo-only model

-- ============================================
-- 1. Team Elo Snapshots (Point-in-Time from CFBD)
-- ============================================
CREATE TABLE IF NOT EXISTS team_elo_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,  -- 0 = preseason, N = after week N games
    elo NUMERIC NOT NULL,
    source TEXT NOT NULL DEFAULT 'cfbd',
    fetched_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_elo_snapshots_team_season
    ON team_elo_snapshots(team_id, season);
CREATE INDEX IF NOT EXISTS idx_elo_snapshots_season_week
    ON team_elo_snapshots(season, week);

COMMENT ON TABLE team_elo_snapshots IS
    'Point-in-time Elo ratings from CFBD. Week N = rating AFTER week N games. For week N game projection, use week N-1 snapshot.';

-- ============================================
-- 2. Add tick_type to odds_ticks
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'odds_ticks' AND column_name = 'tick_type'
    ) THEN
        ALTER TABLE odds_ticks ADD COLUMN tick_type TEXT;
    END IF;
END $$;

-- Add check constraint if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'odds_ticks' AND constraint_name = 'odds_ticks_tick_type_check'
    ) THEN
        ALTER TABLE odds_ticks ADD CONSTRAINT odds_ticks_tick_type_check
            CHECK (tick_type IN ('open', 'close', 'live') OR tick_type IS NULL);
    END IF;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_odds_ticks_tick_type
    ON odds_ticks(event_id, tick_type, market_type);

COMMENT ON COLUMN odds_ticks.tick_type IS
    'open = opening line (~7 days before), close = closing line (at kickoff), live = in-game';

-- ============================================
-- 3. Backtest Projections (Point-in-Time Audit Trail)
-- ============================================
CREATE TABLE IF NOT EXISTS backtest_projections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    model_version TEXT NOT NULL,

    -- POINT-IN-TIME AUDIT: Which data was used
    game_week INTEGER NOT NULL,                    -- The week of the game
    as_of_week INTEGER NOT NULL,                   -- Week used for Elo lookup (should be game_week - 1)
    home_elo_snapshot_week INTEGER NOT NULL,       -- Actual week of home Elo snapshot
    away_elo_snapshot_week INTEGER NOT NULL,       -- Actual week of away Elo snapshot

    -- Point-in-time inputs
    home_elo_entering NUMERIC NOT NULL,
    away_elo_entering NUMERIC NOT NULL,
    market_open_spread NUMERIC NOT NULL,
    market_open_price INTEGER NOT NULL,            -- ACTUAL price (e.g., -108, -112)
    price_is_fallback BOOLEAN NOT NULL DEFAULT FALSE,  -- True if we used -110 fallback

    -- Model computation trace
    elo_diff NUMERIC NOT NULL,                     -- home_elo - away_elo
    elo_implied_spread NUMERIC NOT NULL,           -- -elo_diff / 25
    elo_vs_market NUMERIC NOT NULL,                -- elo_implied_spread - market_open_spread
    elo_weight_used NUMERIC NOT NULL,              -- The weight applied
    elo_adjustment NUMERIC NOT NULL,               -- elo_vs_market * elo_weight
    model_spread_home NUMERIC NOT NULL,            -- market_open_spread + elo_adjustment
    spread_edge NUMERIC NOT NULL,                  -- market_open_spread - model_spread_home

    -- Probability (raw, pre-calibration)
    raw_cover_prob NUMERIC NOT NULL,

    -- Calibrated probability (filled after calibration step)
    calibrated_cover_prob NUMERIC,
    calibration_version TEXT,

    -- EV using ACTUAL price (filled after calibration)
    ev_at_actual_price NUMERIC,

    -- Bet decision
    recommended_side TEXT,                         -- 'home' or 'away'

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_backtest_proj_model
    ON backtest_projections(model_version, created_at);
CREATE INDEX IF NOT EXISTS idx_backtest_proj_event
    ON backtest_projections(event_id);

COMMENT ON TABLE backtest_projections IS
    'Point-in-time projections for backtesting. Contains full audit trail of inputs used.';

-- ============================================
-- 4. Model Calibration (Leakage-Safe Boundaries)
-- ============================================
CREATE TABLE IF NOT EXISTS model_calibration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version TEXT NOT NULL,
    calibration_method TEXT NOT NULL,              -- 'platt', 'isotonic', 'none'

    -- LEAKAGE PREVENTION: Explicit training boundaries
    train_season_start INTEGER NOT NULL,
    train_season_end INTEGER NOT NULL,
    train_games_used INTEGER NOT NULL,

    -- Hyperparameters used
    elo_weight NUMERIC NOT NULL,

    -- Platt scaling parameters (for method = 'platt')
    platt_a NUMERIC,                               -- Slope
    platt_b NUMERIC,                               -- Intercept

    -- Calibration quality metrics (on TRAIN set only)
    train_brier NUMERIC,
    train_log_loss NUMERIC,
    train_ece NUMERIC,                             -- Expected Calibration Error

    -- Validation metrics (on validation fold, if applicable)
    val_brier NUMERIC,
    val_ece NUMERIC,
    val_clv NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(model_version, train_season_start, train_season_end)
);

COMMENT ON TABLE model_calibration IS
    'Stores calibration parameters with explicit training boundaries to prevent leakage.';

-- ============================================
-- 5. Backtest Results (Aggregate Metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version TEXT NOT NULL,
    calibration_id UUID REFERENCES model_calibration(id),

    -- Test set boundaries
    test_season_start INTEGER NOT NULL,
    test_season_end INTEGER NOT NULL,
    test_games_evaluated INTEGER NOT NULL,

    -- Filtering criteria
    min_edge_threshold NUMERIC,

    -- Core metrics
    total_bets INTEGER NOT NULL,
    wins INTEGER NOT NULL,
    losses INTEGER NOT NULL,
    pushes INTEGER NOT NULL,
    win_rate NUMERIC NOT NULL,

    -- Financial metrics
    total_wagered NUMERIC NOT NULL,
    total_profit NUMERIC NOT NULL,
    roi NUMERIC NOT NULL,

    -- CLV metrics
    avg_clv NUMERIC,
    median_clv NUMERIC,
    clv_positive_pct NUMERIC,

    -- Calibration metrics on test set
    test_brier NUMERIC,
    test_ece NUMERIC,

    -- Risk metrics
    sharpe_ratio NUMERIC,
    max_drawdown NUMERIC,

    -- Segmented results (stored as JSON)
    by_edge_size JSONB,
    by_week_range JSONB,
    by_line_movement JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE backtest_results IS
    'Aggregate backtest results for a model version on a test set.';

-- ============================================
-- 6. Backtest Bets (Individual Bet Records)
-- ============================================
CREATE TABLE IF NOT EXISTS backtest_bets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backtest_result_id UUID REFERENCES backtest_results(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id),
    projection_id UUID REFERENCES backtest_projections(id),

    -- Bet details
    side TEXT NOT NULL,                            -- 'home' or 'away'
    spread_at_bet NUMERIC NOT NULL,
    price_at_bet INTEGER NOT NULL,

    -- Model outputs at bet time
    spread_edge NUMERIC NOT NULL,
    calibrated_prob NUMERIC NOT NULL,
    ev NUMERIC NOT NULL,

    -- Closing line (for CLV)
    spread_at_close NUMERIC,
    clv NUMERIC,

    -- Outcome
    actual_margin INTEGER,                         -- home_score - away_score
    outcome TEXT NOT NULL,                         -- 'win', 'loss', 'push'
    profit NUMERIC NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_bets_result
    ON backtest_bets(backtest_result_id);
CREATE INDEX IF NOT EXISTS idx_backtest_bets_event
    ON backtest_bets(event_id);

COMMENT ON TABLE backtest_bets IS
    'Individual bet records from backtest for detailed analysis.';
