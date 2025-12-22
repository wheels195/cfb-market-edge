-- CBB Ratings Season End
-- Stores CBBD season-end adjusted efficiency ratings
-- For V1 model: use PRIOR season ratings only (no look-ahead)

CREATE TABLE IF NOT EXISTS cbb_ratings_season_end (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  cbbd_team_id INTEGER NOT NULL,  -- CBBD's team ID
  team_name TEXT NOT NULL,
  conference TEXT,
  off_rating NUMERIC(6,2) NOT NULL,
  def_rating NUMERIC(6,2) NOT NULL,
  net_rating NUMERIC(6,2) NOT NULL,
  rank_off INTEGER,
  rank_def INTEGER,
  rank_net INTEGER,
  synced_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(season, cbbd_team_id)
);

CREATE INDEX IF NOT EXISTS idx_cbb_ratings_season_end_season
  ON cbb_ratings_season_end(season);
CREATE INDEX IF NOT EXISTS idx_cbb_ratings_season_end_team
  ON cbb_ratings_season_end(cbbd_team_id);
CREATE INDEX IF NOT EXISTS idx_cbb_ratings_season_end_team_name
  ON cbb_ratings_season_end(team_name);

COMMENT ON TABLE cbb_ratings_season_end IS
  'CBBD season-end ratings. V1 model uses prior season (N-1) for games in season N.';
