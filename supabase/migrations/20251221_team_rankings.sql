-- Team rankings table for AP/Coaches poll rankings
CREATE TABLE IF NOT EXISTS team_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id),
  cfbd_team_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  season_type TEXT NOT NULL DEFAULT 'regular',
  poll TEXT NOT NULL, -- 'AP Top 25', 'Coaches Poll', etc.
  rank INTEGER NOT NULL,
  points INTEGER,
  first_place_votes INTEGER,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cfbd_team_id, season, week, season_type, poll)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_team_rankings_lookup
ON team_rankings(cfbd_team_id, season, season_type, poll);

CREATE INDEX IF NOT EXISTS idx_team_rankings_team
ON team_rankings(team_id, season);
