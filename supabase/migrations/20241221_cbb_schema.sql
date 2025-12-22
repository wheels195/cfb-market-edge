-- CBB Schema Migration
-- Run this in Supabase SQL Editor

-- 1. CBB Teams table (separate from CFB teams)
CREATE TABLE IF NOT EXISTS cbb_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cbbd_team_id INTEGER UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  abbreviation VARCHAR(20),
  conference VARCHAR(50),
  primary_color VARCHAR(10),
  secondary_color VARCHAR(10),
  venue VARCHAR(100),
  city VARCHAR(50),
  state VARCHAR(5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbb_teams_cbbd_id ON cbb_teams(cbbd_team_id);
CREATE INDEX IF NOT EXISTS idx_cbb_teams_name ON cbb_teams(name);

-- 2. CBB Team Ratings (efficiency-based)
CREATE TABLE IF NOT EXISTS cbb_team_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cbb_teams(id),
  season INTEGER NOT NULL,

  -- Adjusted efficiency ratings (KenPom-style)
  offensive_rating DECIMAL(6,2),
  defensive_rating DECIMAL(6,2),
  net_rating DECIMAL(6,2),

  -- SRS rating
  srs_rating DECIMAL(6,2),

  -- Rankings
  offense_rank INTEGER,
  defense_rank INTEGER,
  net_rank INTEGER,

  captured_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_cbb_ratings_team_season ON cbb_team_ratings(team_id, season);

-- 3. CBB Games table (for historical data from CBBD)
CREATE TABLE IF NOT EXISTS cbb_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cbbd_game_id INTEGER UNIQUE NOT NULL,
  season INTEGER NOT NULL,
  season_type VARCHAR(20) DEFAULT 'regular',

  start_date TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled',
  neutral_site BOOLEAN DEFAULT FALSE,
  conference_game BOOLEAN DEFAULT FALSE,

  home_team_id UUID REFERENCES cbb_teams(id),
  away_team_id UUID REFERENCES cbb_teams(id),
  home_team_name VARCHAR(100),
  away_team_name VARCHAR(100),

  -- Scores
  home_score INTEGER,
  away_score INTEGER,

  venue VARCHAR(100),
  city VARCHAR(50),
  state VARCHAR(10),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbb_games_season ON cbb_games(season);
CREATE INDEX IF NOT EXISTS idx_cbb_games_start_date ON cbb_games(start_date);
CREATE INDEX IF NOT EXISTS idx_cbb_games_cbbd_id ON cbb_games(cbbd_game_id);

-- 4. CBB Betting Lines (from CBBD historical data)
CREATE TABLE IF NOT EXISTS cbb_betting_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES cbb_games(id),
  cbbd_game_id INTEGER NOT NULL,

  provider VARCHAR(50),
  spread_home DECIMAL(5,2),
  spread_open DECIMAL(5,2),
  total DECIMAL(5,2),
  total_open DECIMAL(5,2),
  home_moneyline INTEGER,
  away_moneyline INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(cbbd_game_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cbb_lines_game ON cbb_betting_lines(game_id);

-- 5. CBB Game Predictions (model picks)
CREATE TABLE IF NOT EXISTS cbb_game_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES cbb_games(id),

  -- Model prediction
  model_spread_home DECIMAL(5,2) NOT NULL,
  market_spread_home DECIMAL(5,2) NOT NULL,
  edge_points DECIMAL(5,2) NOT NULL,
  predicted_side VARCHAR(10) NOT NULL,

  -- Ratings used
  home_net_rating DECIMAL(6,2),
  away_net_rating DECIMAL(6,2),

  predicted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Result (filled after game)
  result VARCHAR(10),
  graded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(game_id)
);

CREATE INDEX IF NOT EXISTS idx_cbb_predictions_result ON cbb_game_predictions(result);

-- Grant permissions
GRANT ALL ON cbb_teams TO authenticated;
GRANT ALL ON cbb_team_ratings TO authenticated;
GRANT ALL ON cbb_games TO authenticated;
GRANT ALL ON cbb_betting_lines TO authenticated;
GRANT ALL ON cbb_game_predictions TO authenticated;

GRANT ALL ON cbb_teams TO anon;
GRANT ALL ON cbb_team_ratings TO anon;
GRANT ALL ON cbb_games TO anon;
GRANT ALL ON cbb_betting_lines TO anon;
GRANT ALL ON cbb_game_predictions TO anon;
