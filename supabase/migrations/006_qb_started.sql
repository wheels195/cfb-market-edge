-- Migration: QB Started (Post-Game Truth)
-- Purpose: Track which QB actually started each game (identified by highest pass attempts)
-- Usage: Backtest validation, analytics, model validation
-- Source: CFBD player game stats
-- Created: 2025-12-19

-- =============================================================================
-- QB STARTED TABLE (Post-Game Truth)
-- =============================================================================

CREATE TABLE IF NOT EXISTS qb_started (
  id SERIAL PRIMARY KEY,
  cfbd_game_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team VARCHAR(100) NOT NULL,
  player_id VARCHAR(50),
  player_name VARCHAR(150) NOT NULL,
  pass_attempts INTEGER NOT NULL,
  pass_completions INTEGER,
  pass_yards INTEGER,
  pass_tds INTEGER,
  interceptions INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cfbd_game_id, team)
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_qb_started_game ON qb_started(cfbd_game_id);
CREATE INDEX IF NOT EXISTS idx_qb_started_team_season ON qb_started(team, season);
CREATE INDEX IF NOT EXISTS idx_qb_started_week ON qb_started(season, week);
CREATE INDEX IF NOT EXISTS idx_qb_started_player ON qb_started(player_name, season);

-- =============================================================================
-- QB STATUS HISTORY (Pre-Kickoff Status with Timestamps)
-- =============================================================================
-- Note: qb_status table already exists from 003_production_v1_tables.sql
-- This adds a history table for tracking all status changes

CREATE TABLE IF NOT EXISTS qb_status_history (
  id SERIAL PRIMARY KEY,
  team VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('confirmed', 'questionable', 'out', 'unknown')),
  player_name VARCHAR(100),
  as_of_timestamp TIMESTAMPTZ NOT NULL,
  source VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_status_history_lookup ON qb_status_history(team, season, week, as_of_timestamp DESC);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- View: Compare pre-kickoff status vs actual starter
CREATE OR REPLACE VIEW v_qb_status_vs_started AS
SELECT
  s.season,
  s.week,
  s.team,
  s.player_name as started_qb,
  s.pass_attempts,
  qs.player_name as pregame_qb,
  qs.status as pregame_status,
  qs.as_of_timestamp as status_timestamp,
  CASE
    WHEN qs.player_name IS NULL THEN 'no_pregame_status'
    WHEN LOWER(s.player_name) = LOWER(qs.player_name) AND qs.status = 'confirmed' THEN 'correct_confirmed'
    WHEN LOWER(s.player_name) = LOWER(qs.player_name) AND qs.status = 'questionable' THEN 'correct_questionable'
    WHEN LOWER(s.player_name) != LOWER(qs.player_name) AND qs.status = 'out' THEN 'correct_out'
    WHEN LOWER(s.player_name) != LOWER(qs.player_name) THEN 'wrong_starter'
    ELSE 'other'
  END as accuracy
FROM qb_started s
LEFT JOIN qb_status qs ON
  s.team = qs.team AND
  s.season = qs.season AND
  s.week = qs.week
ORDER BY s.season, s.week, s.team;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE qb_started IS 'Post-game truth: which QB actually started (highest pass attempts)';
COMMENT ON TABLE qb_status_history IS 'All pre-kickoff QB status updates with timestamps';
COMMENT ON VIEW v_qb_status_vs_started IS 'Compare pre-kickoff predictions vs actual starters for validation';
