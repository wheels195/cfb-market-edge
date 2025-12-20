-- Weekly team stats snapshots for walk-forward backtesting
-- Stores cumulative stats through each week for proper point-in-time lookups

CREATE TABLE IF NOT EXISTS team_stats_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,  -- Week 0 = preseason (no stats), Week N = stats through week N

    -- Games played through this week
    games_played INTEGER NOT NULL DEFAULT 0,

    -- Offensive efficiency (cumulative averages)
    off_ppa NUMERIC,              -- Offensive PPA per play (EPA/play equivalent)
    off_success_rate NUMERIC,     -- Offensive success rate
    off_explosiveness NUMERIC,    -- Explosive play rate

    -- Defensive efficiency (cumulative averages, lower = better)
    def_ppa NUMERIC,              -- Defensive PPA per play allowed
    def_success_rate NUMERIC,     -- Defensive success rate allowed
    def_explosiveness NUMERIC,    -- Explosive plays allowed rate

    -- Pace metrics
    total_plays INTEGER,          -- Total offensive plays through this week
    plays_per_game NUMERIC,       -- Pace: plays per game

    -- Source tracking
    source VARCHAR(50) DEFAULT 'cfbd_ppa',
    last_updated TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(team_id, season, week)
);

CREATE INDEX idx_team_stats_team_season_week ON team_stats_snapshots(team_id, season, week);
CREATE INDEX idx_team_stats_season_week ON team_stats_snapshots(season, week);
