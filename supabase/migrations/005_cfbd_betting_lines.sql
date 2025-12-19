-- CFBD Betting Lines with Opening Spreads
CREATE TABLE IF NOT EXISTS cfbd_betting_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cfbd_game_id BIGINT NOT NULL,
  season INT NOT NULL,
  week INT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_score INT,
  away_score INT,
  spread_open NUMERIC(6,2),
  spread_close NUMERIC(6,2),
  total_open NUMERIC(6,2),
  total_close NUMERIC(6,2),
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cfbd_game_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cfbd_lines_season ON cfbd_betting_lines(season);
CREATE INDEX IF NOT EXISTS idx_cfbd_lines_game ON cfbd_betting_lines(cfbd_game_id);

-- CFBD Elo Ratings
CREATE TABLE IF NOT EXISTS cfbd_elo_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  season INT NOT NULL,
  team_name TEXT NOT NULL,
  conference TEXT,
  elo INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, team_name)
);

CREATE INDEX IF NOT EXISTS idx_cfbd_elo_season ON cfbd_elo_ratings(season);
