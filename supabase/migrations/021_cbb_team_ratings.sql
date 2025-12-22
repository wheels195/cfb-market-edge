-- CBB Team Ratings Table
-- Stores season-end adjusted efficiency ratings from CBBD

CREATE TABLE IF NOT EXISTS cbb_team_ratings (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  conference TEXT,
  offensive_rating NUMERIC(6,2) NOT NULL,
  defensive_rating NUMERIC(6,2) NOT NULL,
  net_rating NUMERIC(6,2) NOT NULL,
  rank_offense INTEGER,
  rank_defense INTEGER,
  rank_net INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(season, team_id)
);

-- Index for lookups by team and season
CREATE INDEX IF NOT EXISTS idx_cbb_team_ratings_season ON cbb_team_ratings(season);
CREATE INDEX IF NOT EXISTS idx_cbb_team_ratings_team ON cbb_team_ratings(team_id);

-- Add comment
COMMENT ON TABLE cbb_team_ratings IS 'Season-end adjusted efficiency ratings from CBBD. Use prior season for predictions (no look-ahead).';
