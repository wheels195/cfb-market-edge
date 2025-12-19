-- Migration: Model V2 Tables
-- Creates tables for player-level ratings, returning production, and walk-forward engine

-- ============================================================
-- RETURNING PRODUCTION (from CFBD API)
-- ============================================================
CREATE TABLE IF NOT EXISTS returning_production (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    -- PPA returning
    total_ppa NUMERIC,
    total_passing_ppa NUMERIC,
    total_rushing_ppa NUMERIC,
    total_receiving_ppa NUMERIC,
    -- Percent returning
    percent_ppa NUMERIC,
    percent_passing_ppa NUMERIC,
    percent_rushing_ppa NUMERIC,
    percent_receiving_ppa NUMERIC,
    -- Usage returning
    usage NUMERIC,
    passing_usage NUMERIC,
    rushing_usage NUMERIC,
    receiving_usage NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season)
);

-- ============================================================
-- PLAYER SEASON STATS
-- ============================================================
CREATE TABLE IF NOT EXISTS player_seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_player_id VARCHAR,
    player_name VARCHAR NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    position VARCHAR,
    -- Passing
    passing_completions INTEGER DEFAULT 0,
    passing_attempts INTEGER DEFAULT 0,
    passing_yards INTEGER DEFAULT 0,
    passing_tds INTEGER DEFAULT 0,
    passing_ints INTEGER DEFAULT 0,
    -- Rushing
    rushing_attempts INTEGER DEFAULT 0,
    rushing_yards INTEGER DEFAULT 0,
    rushing_tds INTEGER DEFAULT 0,
    -- Receiving
    receptions INTEGER DEFAULT 0,
    receiving_yards INTEGER DEFAULT 0,
    receiving_tds INTEGER DEFAULT 0,
    -- Defensive
    tackles NUMERIC DEFAULT 0,
    solo_tackles NUMERIC DEFAULT 0,
    tackles_for_loss NUMERIC DEFAULT 0,
    sacks NUMERIC DEFAULT 0,
    interceptions INTEGER DEFAULT 0,
    passes_defended INTEGER DEFAULT 0,
    fumbles_recovered INTEGER DEFAULT 0,
    -- Games
    games_played INTEGER DEFAULT 0,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cfbd_player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_player_seasons_team ON player_seasons(team_id, season);
CREATE INDEX IF NOT EXISTS idx_player_seasons_name ON player_seasons(player_name);

-- ============================================================
-- PLAYER USAGE (snap counts, touch shares)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_player_id VARCHAR,
    player_name VARCHAR NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    position VARCHAR,
    -- Usage metrics
    overall_usage NUMERIC,
    passing_usage NUMERIC,
    rushing_usage NUMERIC,
    receiving_usage NUMERIC,
    -- First/second down
    first_down_usage NUMERIC,
    second_down_usage NUMERIC,
    third_down_usage NUMERIC,
    -- Situational
    standard_downs_usage NUMERIC,
    passing_downs_usage NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cfbd_player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_player_usage_team ON player_usage(team_id, season);

-- ============================================================
-- ROSTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    cfbd_player_id VARCHAR,
    player_name VARCHAR NOT NULL,
    first_name VARCHAR,
    last_name VARCHAR,
    position VARCHAR,
    jersey_number INTEGER,
    height INTEGER,  -- inches
    weight INTEGER,  -- pounds
    year VARCHAR,    -- FR, SO, JR, SR, GR
    home_city VARCHAR,
    home_state VARCHAR,
    -- Recruiting info if available
    recruit_stars INTEGER,
    recruit_rating NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season, cfbd_player_id)
);

CREATE INDEX IF NOT EXISTS idx_rosters_team_season ON rosters(team_id, season);
CREATE INDEX IF NOT EXISTS idx_rosters_player ON rosters(cfbd_player_id);

-- ============================================================
-- RECRUITING CLASSES
-- ============================================================
CREATE TABLE IF NOT EXISTS recruiting_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    rank INTEGER,
    points NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season)
);

-- ============================================================
-- COACHES
-- ============================================================
CREATE TABLE IF NOT EXISTS coaches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_name VARCHAR NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    games INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    preseason_rank INTEGER,
    postseason_rank INTEGER,
    -- Career stats
    srs NUMERIC,
    sp_overall NUMERIC,
    sp_offense NUMERIC,
    sp_defense NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season)
);

-- ============================================================
-- GAME ADVANCED STATS (per-game PPA, success rate, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS game_advanced_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_game_id INTEGER NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER,
    opponent_id UUID REFERENCES teams(id),
    is_home BOOLEAN,
    -- Offense
    off_plays INTEGER,
    off_drives INTEGER,
    off_ppa NUMERIC,
    off_total_ppa NUMERIC,
    off_success_rate NUMERIC,
    off_explosiveness NUMERIC,
    off_power_success NUMERIC,
    off_stuff_rate NUMERIC,
    off_line_yards NUMERIC,
    off_rushing_ppa NUMERIC,
    off_passing_ppa NUMERIC,
    -- Defense
    def_plays INTEGER,
    def_drives INTEGER,
    def_ppa NUMERIC,
    def_total_ppa NUMERIC,
    def_success_rate NUMERIC,
    def_explosiveness NUMERIC,
    def_power_success NUMERIC,
    def_stuff_rate NUMERIC,
    def_line_yards NUMERIC,
    def_rushing_ppa NUMERIC,
    def_passing_ppa NUMERIC,
    def_havoc_total NUMERIC,
    def_havoc_front_seven NUMERIC,
    def_havoc_db NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cfbd_game_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_game_advanced_team_season ON game_advanced_stats(team_id, season, week);

-- ============================================================
-- WEATHER DATA
-- ============================================================
CREATE TABLE IF NOT EXISTS game_weather (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_game_id INTEGER NOT NULL,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER,
    -- Weather conditions
    temperature NUMERIC,  -- Fahrenheit
    dew_point NUMERIC,
    humidity NUMERIC,
    precipitation NUMERIC,
    snowfall NUMERIC,
    wind_direction NUMERIC,  -- degrees
    wind_speed NUMERIC,  -- mph
    pressure NUMERIC,
    weather_condition VARCHAR,  -- description
    -- Venue info
    is_indoor BOOLEAN DEFAULT FALSE,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cfbd_game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_weather_event ON game_weather(event_id);

-- ============================================================
-- TEAM RATINGS HISTORY (point-in-time, week by week)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_ratings_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    -- Our calculated ratings
    overall_rating NUMERIC,
    off_rating NUMERIC,
    def_rating NUMERIC,
    -- Components
    returning_production_factor NUMERIC,
    recruiting_factor NUMERIC,
    recent_form_factor NUMERIC,
    -- Metadata
    games_played INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_team_ratings_history_lookup ON team_ratings_history(team_id, season, week);

-- ============================================================
-- PLAYER RATINGS (our calculated Elo-style ratings)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_player_id VARCHAR NOT NULL,
    player_name VARCHAR NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    position VARCHAR,
    season INTEGER NOT NULL,
    -- Ratings
    overall_rating NUMERIC,
    -- Confidence (increases with games played)
    games_played INTEGER DEFAULT 0,
    confidence NUMERIC DEFAULT 0.3,
    -- Prior (from recruiting)
    initial_rating NUMERIC,
    -- Metadata
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cfbd_player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_player_ratings_team ON player_ratings(team_id, season);

-- ============================================================
-- PLAYER RATINGS HISTORY (point-in-time)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_ratings_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_player_id VARCHAR NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    rating NUMERIC,
    UNIQUE(cfbd_player_id, season, week)
);

-- ============================================================
-- PROJECTIONS V2 (with full adjustment breakdown)
-- ============================================================
CREATE TABLE IF NOT EXISTS projections_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    projected_at TIMESTAMPTZ DEFAULT NOW(),
    -- Spread projection
    base_spread NUMERIC,
    hfa_adj NUMERIC,
    weather_adj NUMERIC,
    rest_adj NUMERIC,
    player_adj NUMERIC,
    form_adj NUMERIC,
    situation_adj NUMERIC,
    final_spread NUMERIC,
    -- Total projection
    base_total NUMERIC,
    pace_adj NUMERIC,
    weather_total_adj NUMERIC,
    final_total NUMERIC,
    -- Market comparison
    market_spread NUMERIC,
    market_total NUMERIC,
    closing_spread NUMERIC,
    closing_total NUMERIC,
    -- CLV calculation
    clv_spread NUMERIC,
    clv_total NUMERIC,
    -- Confidence
    confidence_score NUMERIC,
    -- Metadata
    model_version VARCHAR,
    UNIQUE(event_id)
);

-- ============================================================
-- LINE MOVEMENT ANALYSIS
-- ============================================================
CREATE TABLE IF NOT EXISTS line_movement_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    opening_spread NUMERIC,
    current_spread NUMERIC,
    closing_spread NUMERIC,
    movement_open_to_current NUMERIC,
    movement_open_to_close NUMERIC,
    -- Sharp money signals
    sharp_side VARCHAR,  -- 'home', 'away', or null
    sharp_confidence NUMERIC,
    -- Steam detection
    steam_detected BOOLEAN DEFAULT FALSE,
    steam_direction VARCHAR,
    steam_magnitude NUMERIC,
    -- Analysis
    is_reverse_line_movement BOOLEAN DEFAULT FALSE,
    public_side_estimate VARCHAR,
    -- Metadata
    analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id)
);

-- ============================================================
-- TRANSFER PORTAL
-- ============================================================
CREATE TABLE IF NOT EXISTS transfer_portal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cfbd_player_id VARCHAR,
    player_name VARCHAR NOT NULL,
    season INTEGER NOT NULL,
    position VARCHAR,
    -- Origin
    origin_team_id UUID REFERENCES teams(id),
    origin_team_name VARCHAR,
    -- Destination
    destination_team_id UUID REFERENCES teams(id),
    destination_team_name VARCHAR,
    -- Status
    transfer_date DATE,
    eligibility VARCHAR,
    -- Rating
    stars INTEGER,
    rating NUMERIC,
    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_portal_origin ON transfer_portal(origin_team_id, season);
CREATE INDEX IF NOT EXISTS idx_transfer_portal_dest ON transfer_portal(destination_team_id, season);

-- ============================================================
-- CLV TRACKING (for model evaluation)
-- ============================================================
CREATE TABLE IF NOT EXISTS clv_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER,
    -- Projection info
    projected_spread NUMERIC,
    projected_total NUMERIC,
    projected_at TIMESTAMPTZ,
    -- Market info
    bet_spread NUMERIC,  -- Line at time of hypothetical bet
    bet_total NUMERIC,
    closing_spread NUMERIC,
    closing_total NUMERIC,
    -- CLV
    clv_spread NUMERIC,
    clv_total NUMERIC,
    -- Outcome
    actual_margin INTEGER,
    actual_total INTEGER,
    spread_result VARCHAR,  -- 'win', 'loss', 'push'
    total_result VARCHAR,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_clv_tracking_season ON clv_tracking(season, week);

-- ============================================================
-- GRANTS (for anon access if needed)
-- ============================================================
-- These may need to be run separately depending on your RLS setup
