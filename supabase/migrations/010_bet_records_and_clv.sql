-- Migration 010: Create bet_records table with CLV tracking
-- Run this in Supabase Dashboard > SQL Editor

-- =============================================================================
-- BET RECORDS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS bet_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team VARCHAR(100) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away', 'over', 'under')),
  market_type VARCHAR(10) NOT NULL DEFAULT 'spread' CHECK (market_type IN ('spread', 'total')),

  -- Spread fields
  spread_at_bet DECIMAL(5,1),
  spread_at_close DECIMAL(5,1),

  -- Total fields
  total_at_bet DECIMAL(5,1),
  total_at_close DECIMAL(5,1),

  -- Edge/model fields
  effective_edge DECIMAL(5,2) NOT NULL,
  raw_edge DECIMAL(5,2) NOT NULL,
  uncertainty DECIMAL(3,2) NOT NULL,
  percentile DECIMAL(4,3) NOT NULL,

  -- CLV tracking
  clv_points DECIMAL(5,2),

  -- Result fields
  result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push')),
  home_score INTEGER,
  away_score INTEGER,

  -- Metadata
  model_version VARCHAR(50) DEFAULT 'production-v1',
  model_run_id VARCHAR(100),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(game_key, season, week, market_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bet_records_season_week ON bet_records(season, week);
CREATE INDEX IF NOT EXISTS idx_bet_records_percentile ON bet_records(percentile);
CREATE INDEX IF NOT EXISTS idx_bet_records_result ON bet_records(result);
CREATE INDEX IF NOT EXISTS idx_bet_records_model ON bet_records(model_version);
CREATE INDEX IF NOT EXISTS idx_bet_records_clv ON bet_records(clv_points) WHERE clv_points IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bet_records_market_type ON bet_records(market_type);

-- Comments
COMMENT ON TABLE bet_records IS 'Immutable bet ledger for tracking and grading bets';
COMMENT ON COLUMN bet_records.clv_points IS 'Closing Line Value: positive = beat the close';
COMMENT ON COLUMN bet_records.market_type IS 'Type of bet: spread or total';

-- =============================================================================
-- CLV ANALYSIS VIEW
-- =============================================================================

CREATE OR REPLACE VIEW v_clv_by_edge_bucket AS
SELECT
  model_version,
  season,
  CASE
    WHEN percentile <= 0.05 THEN 'Top 5%'
    WHEN percentile <= 0.10 THEN 'Top 10%'
    WHEN percentile <= 0.20 THEN 'Top 20%'
    ELSE 'Other'
  END as edge_bucket,
  COUNT(*) as bets,
  ROUND(AVG(clv_points), 2) as avg_clv_points,
  ROUND(SUM(CASE WHEN clv_points > 0 THEN 1 ELSE 0 END)::decimal / NULLIF(COUNT(*), 0) * 100, 1) as clv_capture_pct,
  ROUND(AVG(effective_edge), 2) as avg_edge,
  ROUND(
    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END)::decimal /
    NULLIF(SUM(CASE WHEN result IN ('win', 'loss') THEN 1 ELSE 0 END), 0) * 100,
    1
  ) as win_pct
FROM bet_records
WHERE clv_points IS NOT NULL
GROUP BY model_version, season, edge_bucket
ORDER BY season, edge_bucket;

-- =============================================================================
-- BET PERFORMANCE VIEW
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

-- =============================================================================
-- CLV SUMMARY VIEW
-- =============================================================================

CREATE OR REPLACE VIEW v_clv_summary AS
SELECT
  season,
  week,
  market_type,
  COUNT(*) as bets,
  ROUND(AVG(clv_points), 2) as avg_clv_points,
  ROUND(
    SUM(CASE WHEN clv_points > 0 THEN 1 ELSE 0 END)::decimal / NULLIF(COUNT(*), 0) * 100,
    1
  ) as clv_capture_pct
FROM bet_records
WHERE clv_points IS NOT NULL
GROUP BY season, week, market_type
ORDER BY season, week, market_type;

-- Verify the migration
SELECT 'bet_records table created' as status, COUNT(*) as row_count FROM bet_records;
