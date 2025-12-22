-- CBB Elo Production Schema
--
-- Supports in-season Elo rating system for college basketball
-- Strategy: Bet underdogs when spread >= 10 pts and model edge 2.5-5 pts

-- 1. CBB Elo Snapshots - stores current Elo ratings per team per season
CREATE TABLE IF NOT EXISTS cbb_elo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cbb_teams(id),
  season INTEGER NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  elo NUMERIC(8,2) NOT NULL DEFAULT 1500,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_cbb_elo_snapshots_team_season ON cbb_elo_snapshots(team_id, season);
CREATE INDEX IF NOT EXISTS idx_cbb_elo_snapshots_season ON cbb_elo_snapshots(season);

COMMENT ON TABLE cbb_elo_snapshots IS 'Current Elo ratings for CBB teams, updated after each game';
COMMENT ON COLUMN cbb_elo_snapshots.elo IS 'Current Elo rating (1500 baseline)';
COMMENT ON COLUMN cbb_elo_snapshots.games_played IS 'Games played in current season';

-- 2. Update cbb_game_predictions to support Elo model
ALTER TABLE cbb_game_predictions
ADD COLUMN IF NOT EXISTS home_elo NUMERIC(8,2),
ADD COLUMN IF NOT EXISTS away_elo NUMERIC(8,2),
ADD COLUMN IF NOT EXISTS home_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS away_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS spread_size NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS is_underdog_bet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qualifies_for_bet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qualification_reason TEXT,
ADD COLUMN IF NOT EXISTS bet_result VARCHAR(10);

COMMENT ON COLUMN cbb_game_predictions.home_elo IS 'Home team Elo rating at prediction time';
COMMENT ON COLUMN cbb_game_predictions.away_elo IS 'Away team Elo rating at prediction time';
COMMENT ON COLUMN cbb_game_predictions.home_games_played IS 'Home team games played at prediction time';
COMMENT ON COLUMN cbb_game_predictions.away_games_played IS 'Away team games played at prediction time';
COMMENT ON COLUMN cbb_game_predictions.spread_size IS 'Absolute value of market spread';
COMMENT ON COLUMN cbb_game_predictions.is_underdog_bet IS 'True if recommended bet is on underdog';
COMMENT ON COLUMN cbb_game_predictions.qualifies_for_bet IS 'True if game meets all bet criteria';
COMMENT ON COLUMN cbb_game_predictions.qualification_reason IS 'Human-readable reason (e.g., "Kentucky +14, 3.2pt edge")';
COMMENT ON COLUMN cbb_game_predictions.bet_result IS 'win/loss/push after grading';

-- 3. Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cbb_predictions_qualifies ON cbb_game_predictions(qualifies_for_bet) WHERE qualifies_for_bet = TRUE;
CREATE INDEX IF NOT EXISTS idx_cbb_predictions_bet_result ON cbb_game_predictions(bet_result) WHERE bet_result IS NOT NULL;

-- 4. CBB Odds table for live odds polling (if not exists)
-- This stores real-time odds from The Odds API
CREATE TABLE IF NOT EXISTS cbb_odds_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  sportsbook TEXT NOT NULL,
  spread_home NUMERIC(5,2),
  spread_away NUMERIC(5,2),
  total NUMERIC(5,2),
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  payload_hash TEXT,
  UNIQUE(event_id, sportsbook, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_cbb_odds_ticks_event ON cbb_odds_ticks(event_id);
CREATE INDEX IF NOT EXISTS idx_cbb_odds_ticks_commence ON cbb_odds_ticks(commence_time);

COMMENT ON TABLE cbb_odds_ticks IS 'Real-time odds snapshots from The Odds API';

-- 5. Grant permissions
GRANT ALL ON cbb_elo_snapshots TO authenticated;
GRANT ALL ON cbb_elo_snapshots TO anon;
GRANT ALL ON cbb_odds_ticks TO authenticated;
GRANT ALL ON cbb_odds_ticks TO anon;
