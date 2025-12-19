-- Advanced team ratings for model features
-- Stores SP+, Elo, FPI, recruiting, talent, and advanced stats

CREATE TABLE IF NOT EXISTS advanced_team_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,

    -- Composite ratings from CFBD
    cfbd_elo NUMERIC,
    fpi NUMERIC,
    srs NUMERIC,
    sp_overall NUMERIC,
    sp_offense NUMERIC,
    sp_defense NUMERIC,

    -- Recruiting
    recruiting_rank INTEGER,
    recruiting_points NUMERIC,

    -- Talent composite
    talent_rating NUMERIC,

    -- Advanced offensive stats
    off_ppa NUMERIC,              -- Predicted Points Added per play
    off_success_rate NUMERIC,     -- % of plays that are successful
    off_explosiveness NUMERIC,    -- Big play rate
    off_power_success NUMERIC,    -- 3rd/4th & short conversion rate
    off_stuff_rate NUMERIC,       -- % of runs stuffed at line
    off_line_yards NUMERIC,       -- Yards gained at line of scrimmage per rush
    off_havoc NUMERIC,            -- Tackles for loss + pass breakups + forced fumbles

    -- Advanced defensive stats
    def_ppa NUMERIC,              -- Defensive PPA (lower is better)
    def_success_rate NUMERIC,     -- Defensive success rate (lower is better)
    def_explosiveness NUMERIC,    -- Explosive plays allowed (lower is better)
    def_power_success NUMERIC,
    def_stuff_rate NUMERIC,
    def_line_yards NUMERIC,
    def_havoc NUMERIC,            -- Defensive havoc created (higher is better)

    -- Passing/Rushing splits
    off_passing_ppa NUMERIC,
    off_rushing_ppa NUMERIC,
    def_passing_ppa NUMERIC,
    def_rushing_ppa NUMERIC,

    -- Metadata
    last_updated TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, season)
);

CREATE INDEX idx_advanced_ratings_team_season ON advanced_team_ratings(team_id, season);
CREATE INDEX idx_advanced_ratings_sp ON advanced_team_ratings(sp_overall DESC);
CREATE INDEX idx_advanced_ratings_elo ON advanced_team_ratings(cfbd_elo DESC);
