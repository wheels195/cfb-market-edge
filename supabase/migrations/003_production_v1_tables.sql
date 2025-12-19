-- Migration: Production v1 Tables
-- Model: v3_ppadiff_regime2
-- Created: 2025-12-19

-- =============================================================================
-- QB STATUS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS qb_status (
  id SERIAL PRIMARY KEY,
  team VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('confirmed', 'questionable', 'out', 'unknown')),
  player_name VARCHAR(100),
  as_of_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team, season, week)
);

CREATE INDEX IF NOT EXISTS idx_qb_status_lookup ON qb_status(team, season, week);
CREATE INDEX IF NOT EXISTS idx_qb_status_timestamp ON qb_status(as_of_timestamp);

-- =============================================================================
-- BET RECORDS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS bet_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team VARCHAR(100) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away')),
  spread_at_bet DECIMAL(5,1) NOT NULL,
  spread_at_close DECIMAL(5,1),
  effective_edge DECIMAL(5,2) NOT NULL,
  raw_edge DECIMAL(5,2) NOT NULL,
  uncertainty DECIMAL(3,2) NOT NULL,
  percentile DECIMAL(4,3) NOT NULL,
  result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push')),
  home_score INTEGER,
  away_score INTEGER,
  model_version VARCHAR(50) DEFAULT 'production-v1',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_key, season, week)
);

CREATE INDEX IF NOT EXISTS idx_bet_records_season_week ON bet_records(season, week);
CREATE INDEX IF NOT EXISTS idx_bet_records_percentile ON bet_records(percentile);
CREATE INDEX IF NOT EXISTS idx_bet_records_result ON bet_records(result);
CREATE INDEX IF NOT EXISTS idx_bet_records_model ON bet_records(model_version);

-- =============================================================================
-- MONITORING ALERTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('warning', 'critical')),
  category VARCHAR(20) NOT NULL CHECK (category IN ('performance', 'clv', 'data')),
  message TEXT NOT NULL,
  metric VARCHAR(50) NOT NULL,
  value DECIMAL(10,4) NOT NULL,
  threshold DECIMAL(10,4) NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON monitoring_alerts(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_alerts_category ON monitoring_alerts(category);

-- =============================================================================
-- HEALTH CHECKS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS health_checks (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50) NOT NULL,
  healthy BOOLEAN NOT NULL,
  message TEXT,
  details JSONB,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_component ON health_checks(component, checked_at DESC);

-- =============================================================================
-- BOOK OUTAGES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS book_outages (
  id SERIAL PRIMARY KEY,
  book VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  UNIQUE(book, started_at)
);

CREATE INDEX IF NOT EXISTS idx_book_outages_active ON book_outages(book) WHERE ended_at IS NULL;

-- =============================================================================
-- ADD DEDUPE HASH TO ODDS_TICKS (if not exists)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'odds_ticks' AND column_name = 'dedupe_hash'
  ) THEN
    ALTER TABLE odds_ticks ADD COLUMN dedupe_hash VARCHAR(200);
    CREATE UNIQUE INDEX idx_odds_ticks_dedupe ON odds_ticks(dedupe_hash);
  END IF;
END $$;

-- =============================================================================
-- MODEL VERSION REGISTRY
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL UNIQUE,
  model_id VARCHAR(100) NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL,
  config JSONB NOT NULL,
  is_production BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert production v1 configuration
INSERT INTO model_versions (version, model_id, promoted_at, config, is_production, notes)
VALUES (
  'production-v1',
  'v3_ppadiff_regime2',
  '2025-12-19',
  '{
    "spread": {"HFA": 3.0, "ELO_TO_SPREAD": 25, "MEAN_RATING": 1500},
    "week0": {"PRIOR_ELO": 0.35, "ROSTER_CONTINUITY": 0.35, "RECRUITING": 0.20, "CONFERENCE_BASE": 0.10},
    "regime": {
      "WEEK_1": {"prior": 0.70, "inSeason": 0.30},
      "WEEK_2": {"prior": 0.60, "inSeason": 0.40},
      "WEEK_3": {"prior": 0.50, "inSeason": 0.50},
      "WEEK_4": {"prior": 0.40, "inSeason": 0.60},
      "WEEKS_5_PLUS": {"prior": 0.30, "inSeason": 0.70}
    },
    "update": {"PPA_WEIGHT": 0.75, "MARGIN_WEIGHT": 0.25, "K_FACTOR": 20, "MARGIN_CAP": 21, "PPA_SCALE": 250},
    "uncertainty": {
      "week": {"WEEKS_0_1": 0.45, "WEEKS_2_4": 0.25, "WEEKS_5_PLUS": 0.10},
      "roster": {"BOTTOM_QUARTILE": 0.15, "SECOND_QUARTILE": 0.08, "TOP_HALF": 0.00},
      "qb": {"TRANSFER_OUT": 0.20, "RETURNING": 0.00},
      "coach": {"NEW_COACH": 0.10, "RETURNING": 0.00},
      "cap": 0.75
    },
    "betting": {
      "DEFAULT_EDGE_PERCENTILE": 0.05,
      "MIN_EFFECTIVE_EDGE": 3.0,
      "WEEKS_1_4": {"EDGE_PERCENTILE": 0.05, "MAX_UNCERTAINTY": 0.50, "REQUIRE_QB_CONFIRMED": true},
      "WEEKS_5_PLUS": {"EDGE_PERCENTILE": 0.05, "MAX_UNCERTAINTY": 0.60, "REQUIRE_QB_CONFIRMED": false}
    },
    "monitoring": {
      "TOP_5_MIN_WIN_RATE": 0.52,
      "CONSECUTIVE_WEEKS_BEFORE_ALERT": 3,
      "MIN_CLV_CAPTURE_RATE": 0.45,
      "MIN_EDGE_PERSISTENCE": 0.40
    }
  }'::jsonb,
  TRUE,
  'Initial production model. Top 5% win rate: 58.0%, ROI: +10.8% (2022-2024 backtest)'
)
ON CONFLICT (version) DO UPDATE SET
  is_production = TRUE,
  notes = EXCLUDED.notes;

-- =============================================================================
-- VIEWS FOR MONITORING
-- =============================================================================

CREATE OR REPLACE VIEW v_bet_performance AS
SELECT
  model_version,
  season,
  CASE WHEN week <= 4 THEN 'Weeks 1-4' ELSE 'Weeks 5+' END as week_bucket,
  COUNT(*) as total_bets,
  SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) as pushes,
  ROUND(
    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END)::decimal /
    NULLIF(SUM(CASE WHEN result IN ('win', 'loss') THEN 1 ELSE 0 END), 0) * 100,
    1
  ) as win_pct,
  ROUND(AVG(uncertainty), 3) as avg_uncertainty,
  ROUND(AVG(effective_edge), 2) as avg_effective_edge
FROM bet_records
WHERE result IS NOT NULL
GROUP BY model_version, season, week_bucket;

CREATE OR REPLACE VIEW v_clv_summary AS
SELECT
  season,
  week,
  COUNT(*) as bets,
  ROUND(AVG(spread_at_close - spread_at_bet), 2) as avg_line_movement,
  ROUND(
    SUM(CASE
      WHEN (side = 'home' AND spread_at_close > spread_at_bet) OR
           (side = 'away' AND spread_at_close < spread_at_bet)
      THEN 1 ELSE 0
    END)::decimal / COUNT(*) * 100,
    1
  ) as clv_capture_pct
FROM bet_records
WHERE spread_at_close IS NOT NULL
GROUP BY season, week
ORDER BY season, week;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE qb_status IS 'Pre-kickoff QB status for uncertainty adjustment';
COMMENT ON TABLE bet_records IS 'Historical bet records for performance tracking';
COMMENT ON TABLE monitoring_alerts IS 'System alerts for performance degradation';
COMMENT ON TABLE model_versions IS 'Frozen model configurations';
COMMENT ON VIEW v_bet_performance IS 'Aggregated betting performance by model and week bucket';
COMMENT ON VIEW v_clv_summary IS 'CLV capture rate by week';
