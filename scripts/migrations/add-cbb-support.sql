-- Migration: Add College Basketball Support
-- This extends the existing schema to support CBB alongside CFB

-- 1. Add CBBD team ID to teams table (for CBB team mapping)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS cbbd_team_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_teams_cbbd_id ON teams(cbbd_team_id);

-- 2. Add sport column to differentiate CFB vs CBB teams
ALTER TABLE teams ADD COLUMN IF NOT EXISTS sport VARCHAR(10) DEFAULT 'cfb';
UPDATE teams SET sport = 'cfb' WHERE sport IS NULL;

-- 3. Create CBB team ratings table (efficiency-based, not Elo)
CREATE TABLE IF NOT EXISTS cbb_team_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  season INTEGER NOT NULL,
  week INTEGER, -- Week of season (optional, for point-in-time)

  -- Adjusted efficiency ratings (KenPom-style)
  offensive_rating DECIMAL(6,2), -- Points per 100 possessions offense
  defensive_rating DECIMAL(6,2), -- Points per 100 possessions defense
  net_rating DECIMAL(6,2),       -- Offensive - Defensive

  -- SRS rating
  srs_rating DECIMAL(6,2),

  -- Rankings
  offense_rank INTEGER,
  defense_rank INTEGER,
  net_rank INTEGER,

  -- Tempo (possessions per game)
  tempo DECIMAL(5,2),

  captured_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, season, week)
);

CREATE INDEX IF NOT EXISTS idx_cbb_ratings_team_season ON cbb_team_ratings(team_id, season);
CREATE INDEX IF NOT EXISTS idx_cbb_ratings_season_week ON cbb_team_ratings(season, week);

-- 4. Create CBB betting lines table (historical from CBBD)
CREATE TABLE IF NOT EXISTS cbb_betting_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cbbd_game_id INTEGER NOT NULL,
  event_id UUID REFERENCES events(id), -- Links to our events table if matched
  season INTEGER NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,

  home_team_id UUID REFERENCES teams(id),
  away_team_id UUID REFERENCES teams(id),
  home_team_name VARCHAR(100),
  away_team_name VARCHAR(100),

  -- Final scores (for backtesting)
  home_score INTEGER,
  away_score INTEGER,

  -- Lines from CBBD (typically consensus/ESPN BET)
  provider VARCHAR(50),
  spread_home DECIMAL(5,2),        -- Home spread (negative = home favored)
  spread_open DECIMAL(5,2),        -- Opening spread
  total DECIMAL(5,2),              -- Over/under line
  total_open DECIMAL(5,2),         -- Opening total
  home_moneyline INTEGER,
  away_moneyline INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(cbbd_game_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cbb_lines_season ON cbb_betting_lines(season);
CREATE INDEX IF NOT EXISTS idx_cbb_lines_game_id ON cbb_betting_lines(cbbd_game_id);
CREATE INDEX IF NOT EXISTS idx_cbb_lines_start_date ON cbb_betting_lines(start_date);

-- 5. Create CBB game predictions table (for tracking model picks)
CREATE TABLE IF NOT EXISTS cbb_game_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  cbbd_game_id INTEGER,

  -- Model prediction at bet time
  model_spread_home DECIMAL(5,2) NOT NULL,
  market_spread_home DECIMAL(5,2) NOT NULL,
  edge_points DECIMAL(5,2) NOT NULL,
  predicted_side VARCHAR(10) NOT NULL, -- 'home' or 'away'

  -- Rating inputs used
  home_net_rating DECIMAL(6,2),
  away_net_rating DECIMAL(6,2),
  home_offensive_rating DECIMAL(6,2),
  home_defensive_rating DECIMAL(6,2),
  away_offensive_rating DECIMAL(6,2),
  away_defensive_rating DECIMAL(6,2),

  -- Timestamps
  predicted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Result (filled in after game)
  home_score INTEGER,
  away_score INTEGER,
  actual_margin INTEGER, -- home_score - away_score
  result VARCHAR(10), -- 'WIN', 'LOSS', 'PUSH'
  graded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_cbb_predictions_event ON cbb_game_predictions(event_id);
CREATE INDEX IF NOT EXISTS idx_cbb_predictions_result ON cbb_game_predictions(result);

-- 6. Add comment explaining the dual-sport support
COMMENT ON COLUMN teams.sport IS 'Sport: cfb (college football) or cbb (college basketball)';
COMMENT ON COLUMN teams.cbbd_team_id IS 'College Basketball Data API team ID';
COMMENT ON TABLE cbb_team_ratings IS 'Efficiency-based ratings for CBB teams (KenPom-style)';
COMMENT ON TABLE cbb_betting_lines IS 'Historical betting lines from CBBD for backtesting';
COMMENT ON TABLE cbb_game_predictions IS 'Model predictions for CBB games';
