-- Migration: Model Runs (Snapshot + Bet Ledger)
-- Purpose: Immutable model state snapshots and bet ledger generation
-- Created: 2025-12-19

-- =============================================================================
-- MODEL RUNS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_runs (
  id VARCHAR(100) PRIMARY KEY,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  model_id VARCHAR(100) NOT NULL,
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  config_snapshot JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_runs_season_week ON model_runs(season, week);
CREATE INDEX IF NOT EXISTS idx_model_runs_version ON model_runs(model_version);
CREATE INDEX IF NOT EXISTS idx_model_runs_status ON model_runs(status);

-- =============================================================================
-- MODEL RUN PROJECTIONS (Snapshot of projections at run time)
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_run_projections (
  id SERIAL PRIMARY KEY,
  model_run_id VARCHAR(100) NOT NULL REFERENCES model_runs(id),
  cfbd_game_id INTEGER NOT NULL,
  home_team VARCHAR(100) NOT NULL,
  away_team VARCHAR(100) NOT NULL,
  model_spread DECIMAL(5,2),
  model_total DECIMAL(5,2),
  home_rating DECIMAL(8,2),
  away_rating DECIMAL(8,2),
  uncertainty DECIMAL(4,3),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_run_id, cfbd_game_id)
);

CREATE INDEX IF NOT EXISTS idx_model_run_projections_run ON model_run_projections(model_run_id);
CREATE INDEX IF NOT EXISTS idx_model_run_projections_game ON model_run_projections(cfbd_game_id);

-- =============================================================================
-- MODEL RUN EDGES (Snapshot of edges at run time)
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_run_edges (
  id SERIAL PRIMARY KEY,
  model_run_id VARCHAR(100) NOT NULL REFERENCES model_runs(id),
  cfbd_game_id INTEGER NOT NULL,
  market_type VARCHAR(10) NOT NULL CHECK (market_type IN ('spread', 'total')),
  market_line DECIMAL(5,2) NOT NULL,
  model_line DECIMAL(5,2) NOT NULL,
  raw_edge DECIMAL(5,2) NOT NULL,
  effective_edge DECIMAL(5,2) NOT NULL,
  uncertainty DECIMAL(4,3) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away', 'over', 'under')),
  percentile DECIMAL(4,3),
  bettable BOOLEAN DEFAULT FALSE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_run_id, cfbd_game_id, market_type)
);

CREATE INDEX IF NOT EXISTS idx_model_run_edges_run ON model_run_edges(model_run_id);
CREATE INDEX IF NOT EXISTS idx_model_run_edges_bettable ON model_run_edges(bettable) WHERE bettable = TRUE;
CREATE INDEX IF NOT EXISTS idx_model_run_edges_percentile ON model_run_edges(percentile);

-- =============================================================================
-- ADD MODEL RUN ID TO BET RECORDS (for traceability)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bet_records' AND column_name = 'model_run_id'
  ) THEN
    ALTER TABLE bet_records ADD COLUMN model_run_id VARCHAR(100);
    CREATE INDEX idx_bet_records_model_run ON bet_records(model_run_id);
  END IF;
END $$;

-- =============================================================================
-- VIEWS
-- =============================================================================

-- View: Model run summary
CREATE OR REPLACE VIEW v_model_run_summary AS
SELECT
  mr.id as model_run_id,
  mr.season,
  mr.week,
  mr.model_version,
  mr.as_of_timestamp,
  mr.status,
  COUNT(DISTINCT mre.cfbd_game_id) as games_with_edges,
  SUM(CASE WHEN mre.bettable THEN 1 ELSE 0 END) as bettable_games,
  ROUND(AVG(ABS(mre.effective_edge)), 2) as avg_effective_edge,
  ROUND(AVG(mre.uncertainty), 3) as avg_uncertainty
FROM model_runs mr
LEFT JOIN model_run_edges mre ON mr.id = mre.model_run_id
GROUP BY mr.id, mr.season, mr.week, mr.model_version, mr.as_of_timestamp, mr.status;

-- View: Bet ledger with results
CREATE OR REPLACE VIEW v_bet_ledger AS
SELECT
  br.id,
  br.game_key,
  br.season,
  br.week,
  br.team,
  br.side,
  br.spread_at_bet,
  br.spread_at_close,
  br.effective_edge,
  br.raw_edge,
  br.uncertainty,
  br.percentile,
  br.result,
  br.model_version,
  br.model_run_id,
  br.timestamp,
  CASE
    WHEN br.result = 'win' THEN 0.91  -- $100 to win $91 at -110
    WHEN br.result = 'loss' THEN -1.00
    WHEN br.result = 'push' THEN 0.00
    ELSE NULL
  END as profit_units
FROM bet_records br
ORDER BY br.season, br.week, br.timestamp;

-- View: Weekly bet summary
CREATE OR REPLACE VIEW v_weekly_bet_summary AS
SELECT
  season,
  week,
  model_version,
  COUNT(*) as total_bets,
  SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) as pushes,
  ROUND(AVG(effective_edge), 2) as avg_edge,
  ROUND(AVG(uncertainty), 3) as avg_uncertainty,
  ROUND(
    SUM(CASE WHEN result = 'win' THEN 0.91 WHEN result = 'loss' THEN -1.0 ELSE 0 END),
    2
  ) as profit_units,
  ROUND(
    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END)::decimal /
    NULLIF(SUM(CASE WHEN result IN ('win', 'loss') THEN 1 ELSE 0 END), 0) * 100,
    1
  ) as win_pct
FROM bet_records
WHERE result IS NOT NULL
GROUP BY season, week, model_version
ORDER BY season, week;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE model_runs IS 'Immutable snapshots of model state at specific points in time';
COMMENT ON TABLE model_run_projections IS 'Projections frozen at model run time';
COMMENT ON TABLE model_run_edges IS 'Edges frozen at model run time';
COMMENT ON VIEW v_model_run_summary IS 'Summary stats for each model run';
COMMENT ON VIEW v_bet_ledger IS 'Complete bet ledger with profit/loss';
COMMENT ON VIEW v_weekly_bet_summary IS 'Weekly betting performance summary';
