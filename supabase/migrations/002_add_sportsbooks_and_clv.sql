-- Migration 002: Add additional sportsbooks and CLV tracking
-- Adds Pinnacle (sharp benchmark), BetMGM, ESPN Bet, and others

-- Add additional sportsbooks
INSERT INTO sportsbooks (key, name) VALUES
    ('pinnacle', 'Pinnacle'),
    ('betmgm', 'BetMGM'),
    ('espnbet', 'ESPN Bet'),
    ('betrivers', 'BetRivers'),
    ('bovada', 'Bovada'),
    ('betonlineag', 'BetOnline'),
    ('lowvig', 'LowVig'),
    ('hardrockbet', 'Hard Rock Bet'),
    ('ballybet', 'Bally Bet'),
    ('betparx', 'BetParx'),
    ('fliff', 'Fliff')
ON CONFLICT (key) DO NOTHING;

-- Add team location data for travel distance calculations
ALTER TABLE teams ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS conference TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS venue_name TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS elevation_ft INTEGER;

-- Add advanced stats cache table
CREATE TABLE IF NOT EXISTS team_advanced_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER,  -- NULL means season aggregate

    -- Pace metrics
    plays_per_game NUMERIC,
    seconds_per_play NUMERIC,
    pace_rank INTEGER,

    -- Offensive efficiency
    off_success_rate NUMERIC,
    off_explosiveness NUMERIC,
    off_ppa NUMERIC,
    off_passing_ppa NUMERIC,
    off_rushing_ppa NUMERIC,

    -- Defensive efficiency
    def_success_rate NUMERIC,
    def_explosiveness NUMERIC,
    def_ppa NUMERIC,
    def_havoc_rate NUMERIC,
    def_havoc_front_seven NUMERIC,
    def_havoc_db NUMERIC,

    -- Situational
    standard_downs_success_rate NUMERIC,
    passing_downs_success_rate NUMERIC,
    red_zone_success_rate NUMERIC,

    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, season, week)
);

CREATE INDEX idx_team_advanced_stats_team_season ON team_advanced_stats(team_id, season);

-- CLV (Closing Line Value) tracking table
CREATE TABLE IF NOT EXISTS clv_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sportsbook_id UUID NOT NULL REFERENCES sportsbooks(id),
    market_type TEXT NOT NULL CHECK (market_type IN ('spread', 'total')),

    -- The bet that was recommended
    bet_side TEXT NOT NULL,  -- 'home', 'away', 'over', 'under'
    bet_points NUMERIC NOT NULL,  -- spread or total at bet time
    bet_price_american INTEGER NOT NULL,
    bet_timestamp TIMESTAMPTZ NOT NULL,

    -- Closing line
    close_points NUMERIC NOT NULL,  -- spread or total at close
    close_price_american INTEGER NOT NULL,
    close_timestamp TIMESTAMPTZ NOT NULL,

    -- CLV calculation
    clv_points NUMERIC NOT NULL,  -- positive = beat the close
    clv_cents INTEGER,  -- CLV in cents (for juice comparison)

    -- Pinnacle reference (if available)
    pinnacle_close_points NUMERIC,
    pinnacle_clv_points NUMERIC,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id, sportsbook_id, market_type)
);

CREATE INDEX idx_clv_results_event ON clv_results(event_id);
CREATE INDEX idx_clv_results_clv ON clv_results(clv_points DESC);

-- Game context table for situational factors
CREATE TABLE IF NOT EXISTS game_context (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Rest/travel factors
    home_rest_days INTEGER,  -- days since last game
    away_rest_days INTEGER,
    travel_distance_miles NUMERIC,  -- away team travel
    time_zone_change INTEGER,  -- hours of timezone shift

    -- Situational flags
    is_rivalry BOOLEAN DEFAULT FALSE,
    is_revenge_spot BOOLEAN DEFAULT FALSE,  -- lost to this team last year
    is_lookahead_spot BOOLEAN DEFAULT FALSE,  -- big game next week
    is_letdown_spot BOOLEAN DEFAULT FALSE,  -- coming off big win
    is_bowl_game BOOLEAN DEFAULT FALSE,
    is_conference_game BOOLEAN DEFAULT FALSE,

    -- Home team previous game
    home_prev_opponent TEXT,
    home_prev_result TEXT,  -- 'W' or 'L'
    home_prev_margin INTEGER,

    -- Away team previous game
    away_prev_opponent TEXT,
    away_prev_result TEXT,
    away_prev_margin INTEGER,

    -- Next week context
    home_next_opponent TEXT,
    away_next_opponent TEXT,
    home_next_opponent_rank INTEGER,
    away_next_opponent_rank INTEGER,

    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id)
);

CREATE INDEX idx_game_context_event ON game_context(event_id);

-- Elo game-by-game history for recency weighting
CREATE TABLE IF NOT EXISTS elo_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER,

    -- Ratings
    pre_game_elo NUMERIC NOT NULL,
    post_game_elo NUMERIC NOT NULL,
    elo_change NUMERIC NOT NULL,

    -- Game result
    opponent_id UUID REFERENCES teams(id),
    opponent_pre_elo NUMERIC,
    was_home BOOLEAN NOT NULL,
    team_score INTEGER,
    opponent_score INTEGER,
    result TEXT CHECK (result IN ('W', 'L', 'T')),

    -- K-factor used
    k_factor NUMERIC NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, event_id)
);

CREATE INDEX idx_elo_history_team_season ON elo_history(team_id, season, week DESC);
CREATE INDEX idx_elo_history_event ON elo_history(event_id);

-- Update trigger for game_context
CREATE TRIGGER game_context_updated_at
    BEFORE UPDATE ON game_context
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Update trigger for team_advanced_stats
CREATE TRIGGER team_advanced_stats_updated_at
    BEFORE UPDATE ON team_advanced_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
