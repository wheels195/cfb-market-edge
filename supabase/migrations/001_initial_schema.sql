-- CFB Market-Edge Database Schema
-- Initial migration for Supabase Postgres

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Reference Tables
-- ============================================

-- Sportsbooks (DraftKings, FanDuel)
CREATE TABLE sportsbooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL,  -- matches The Odds API bookmaker key
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert reference data
INSERT INTO sportsbooks (key, name) VALUES
    ('draftkings', 'DraftKings'),
    ('fanduel', 'FanDuel');

-- Teams
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    abbrev TEXT,
    cfbd_team_id TEXT,  -- CollegeFootballData mapping
    odds_api_name TEXT,  -- The Odds API team name (for matching)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name)
);

-- Team name aliases for matching between APIs
CREATE TABLE team_aliases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    source TEXT NOT NULL,  -- 'odds_api', 'cfbd', 'manual'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(alias, source)
);

-- ============================================
-- Core Tables
-- ============================================

-- Events (Games)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    league TEXT NOT NULL DEFAULT 'NCAAF',
    commence_time TIMESTAMPTZ NOT NULL,
    home_team_id UUID NOT NULL REFERENCES teams(id),
    away_team_id UUID NOT NULL REFERENCES teams(id),
    odds_api_event_id TEXT UNIQUE NOT NULL,
    cfbd_game_id TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'final', 'cancelled', 'postponed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_commence_time ON events(commence_time);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_home_team ON events(home_team_id);
CREATE INDEX idx_events_away_team ON events(away_team_id);

-- ============================================
-- Odds Data
-- ============================================

-- Odds Ticks (line snapshots)
-- Stores both spreads and totals in canonical format
CREATE TABLE odds_ticks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sportsbook_id UUID NOT NULL REFERENCES sportsbooks(id),
    market_type TEXT NOT NULL CHECK (market_type IN ('spread', 'total')),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- For spreads: home or away side
    -- For totals: over or under
    side TEXT NOT NULL,

    -- For spreads: always store as home team spread (e.g., -6.5 means home favored by 6.5)
    spread_points_home NUMERIC,

    -- For totals: the total points number
    total_points NUMERIC,

    -- Price in both formats
    price_american INTEGER NOT NULL,
    price_decimal NUMERIC NOT NULL,

    -- For deduplication
    payload_hash TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_spread CHECK (
        (market_type = 'spread' AND side IN ('home', 'away') AND spread_points_home IS NOT NULL)
        OR market_type != 'spread'
    ),
    CONSTRAINT valid_total CHECK (
        (market_type = 'total' AND side IN ('over', 'under') AND total_points IS NOT NULL)
        OR market_type != 'total'
    )
);

-- Composite indexes for efficient queries
CREATE INDEX idx_odds_ticks_event_book_market_time
    ON odds_ticks(event_id, sportsbook_id, market_type, captured_at DESC);

CREATE INDEX idx_odds_ticks_dedup
    ON odds_ticks(event_id, sportsbook_id, market_type, side, payload_hash);

CREATE INDEX idx_odds_ticks_captured_at ON odds_ticks(captured_at DESC);

-- Closing Lines (materialized from odds_ticks)
CREATE TABLE closing_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sportsbook_id UUID NOT NULL REFERENCES sportsbooks(id),
    market_type TEXT NOT NULL CHECK (market_type IN ('spread', 'total')),
    side TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,  -- timestamp of the closing tick

    spread_points_home NUMERIC,
    total_points NUMERIC,
    price_american INTEGER NOT NULL,
    price_decimal NUMERIC NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id, sportsbook_id, market_type, side)
);

-- ============================================
-- Results
-- ============================================

CREATE TABLE results (
    event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    final_total INTEGER GENERATED ALWAYS AS (home_score + away_score) STORED,
    home_margin INTEGER GENERATED ALWAYS AS (home_score - away_score) STORED,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Modeling
-- ============================================

-- Model Versions
CREATE TABLE model_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    config JSONB,  -- model parameters
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert baseline model version
INSERT INTO model_versions (name, description) VALUES
    ('elo_v1', 'Baseline Elo rating model with home field advantage');

-- Team Ratings (for Elo model)
CREATE TABLE team_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    model_version_id UUID NOT NULL REFERENCES model_versions(id),
    rating NUMERIC NOT NULL DEFAULT 1500,
    games_played INTEGER NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    season INTEGER NOT NULL,

    UNIQUE(team_id, model_version_id, season)
);

CREATE INDEX idx_team_ratings_team ON team_ratings(team_id);
CREATE INDEX idx_team_ratings_model ON team_ratings(model_version_id);

-- Team Stats (for totals model)
CREATE TABLE team_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    total_points_for INTEGER NOT NULL DEFAULT 0,
    total_points_against INTEGER NOT NULL DEFAULT 0,
    avg_points_for NUMERIC GENERATED ALWAYS AS (
        CASE WHEN games_played > 0 THEN total_points_for::NUMERIC / games_played ELSE 0 END
    ) STORED,
    avg_points_against NUMERIC GENERATED ALWAYS AS (
        CASE WHEN games_played > 0 THEN total_points_against::NUMERIC / games_played ELSE 0 END
    ) STORED,
    last_updated TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, season)
);

-- Projections
CREATE TABLE projections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    model_version_id UUID NOT NULL REFERENCES model_versions(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Model outputs (home team perspective)
    model_spread_home NUMERIC NOT NULL,  -- negative = home favored
    model_total_points NUMERIC NOT NULL,

    -- Optional: confidence/factors
    home_rating NUMERIC,
    away_rating NUMERIC,
    home_avg_points_for NUMERIC,
    home_avg_points_against NUMERIC,
    away_avg_points_for NUMERIC,
    away_avg_points_against NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id, model_version_id)
);

CREATE INDEX idx_projections_event ON projections(event_id);
CREATE INDEX idx_projections_generated ON projections(generated_at DESC);

-- ============================================
-- Edges
-- ============================================

CREATE TABLE edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sportsbook_id UUID NOT NULL REFERENCES sportsbooks(id),
    market_type TEXT NOT NULL CHECK (market_type IN ('spread', 'total')),
    as_of TIMESTAMPTZ NOT NULL,  -- the tick time used for calculation

    -- Market numbers
    market_spread_home NUMERIC,
    market_total_points NUMERIC,
    market_price_american INTEGER,

    -- Model numbers
    model_spread_home NUMERIC,
    model_total_points NUMERIC,

    -- Computed edge
    edge_points NUMERIC NOT NULL,

    -- Recommendation
    recommended_side TEXT NOT NULL,  -- 'home', 'away', 'over', 'under'
    recommended_bet_label TEXT NOT NULL,  -- e.g., "Home -6.5" or "Under 55.5"

    -- Ranking (within book/market)
    rank_abs_edge INTEGER,

    -- Optional explanation
    explain JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id, sportsbook_id, market_type)
);

CREATE INDEX idx_edges_event ON edges(event_id);
CREATE INDEX idx_edges_rank ON edges(rank_abs_edge);
CREATE INDEX idx_edges_edge_points ON edges(ABS(edge_points) DESC);

-- ============================================
-- Operational Tables
-- ============================================

-- API Usage Tracking
CREATE TABLE api_usage_daily (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL UNIQUE,
    odds_api_calls INTEGER NOT NULL DEFAULT 0,
    cfbd_api_calls INTEGER NOT NULL DEFAULT 0,
    events_synced INTEGER NOT NULL DEFAULT 0,
    ticks_written INTEGER NOT NULL DEFAULT 0,
    dedupe_hits INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job Runs (audit log)
CREATE TABLE job_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
    records_processed INTEGER,
    error_message TEXT,
    metadata JSONB
);

CREATE INDEX idx_job_runs_name_time ON job_runs(job_name, started_at DESC);

-- ============================================
-- Functions
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER results_updated_at
    BEFORE UPDATE ON results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER edges_updated_at
    BEFORE UPDATE ON edges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER api_usage_daily_updated_at
    BEFORE UPDATE ON api_usage_daily
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Views (for convenience)
-- ============================================

-- Latest odds per event/book/market
CREATE OR REPLACE VIEW latest_odds AS
SELECT DISTINCT ON (event_id, sportsbook_id, market_type, side)
    ot.*
FROM odds_ticks ot
ORDER BY event_id, sportsbook_id, market_type, side, captured_at DESC;

-- Upcoming events with teams
CREATE OR REPLACE VIEW upcoming_events AS
SELECT
    e.*,
    ht.name as home_team_name,
    ht.abbrev as home_team_abbrev,
    at.name as away_team_name,
    at.abbrev as away_team_abbrev
FROM events e
JOIN teams ht ON e.home_team_id = ht.id
JOIN teams at ON e.away_team_id = at.id
WHERE e.status = 'scheduled'
  AND e.commence_time > NOW()
ORDER BY e.commence_time;
