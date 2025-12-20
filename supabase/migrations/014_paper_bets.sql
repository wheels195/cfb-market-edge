-- Paper Bets table for forward testing
-- Tracks paper bets with full logging for validation

CREATE TABLE IF NOT EXISTS paper_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event reference
  event_id UUID REFERENCES events(id),

  -- Bet details
  side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away')),
  market_type VARCHAR(20) NOT NULL DEFAULT 'spread',

  -- Lines at bet time
  market_spread_home NUMERIC(5,1) NOT NULL,
  spread_price_american INTEGER NOT NULL,

  -- Model data at bet time
  model_spread_home NUMERIC(5,1) NOT NULL,
  edge_points NUMERIC(5,2) NOT NULL,
  abs_edge NUMERIC(5,2) NOT NULL,

  -- Ranking info
  week_rank INTEGER, -- 1-10 for top 10 bets

  -- Stake
  units NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  stake_amount NUMERIC(10,2) NOT NULL DEFAULT 100.0,

  -- Closing line (filled after game starts)
  closing_spread_home NUMERIC(5,1),
  closing_price_american INTEGER,
  clv_points NUMERIC(5,2), -- Closing line value

  -- Result (filled after game ends)
  result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push', 'pending')),
  home_score INTEGER,
  away_score INTEGER,
  profit_loss NUMERIC(10,2),

  -- Metadata
  bet_placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  game_started_at TIMESTAMPTZ,
  game_ended_at TIMESTAMPTZ,

  -- Season/week for grouping
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'settled')),

  -- Notes
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_paper_bets_event ON paper_bets(event_id);
CREATE INDEX idx_paper_bets_season_week ON paper_bets(season, week);
CREATE INDEX idx_paper_bets_status ON paper_bets(status);
CREATE INDEX idx_paper_bets_result ON paper_bets(result);
CREATE INDEX idx_paper_bets_placed_at ON paper_bets(bet_placed_at);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_paper_bets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER paper_bets_updated_at
  BEFORE UPDATE ON paper_bets
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_bets_updated_at();

-- Summary view for dashboard
CREATE OR REPLACE VIEW paper_bets_summary AS
SELECT
  season,
  week,
  COUNT(*) as total_bets,
  COUNT(*) FILTER (WHERE result = 'win') as wins,
  COUNT(*) FILTER (WHERE result = 'loss') as losses,
  COUNT(*) FILTER (WHERE result = 'push') as pushes,
  COUNT(*) FILTER (WHERE result = 'pending') as pending,
  SUM(stake_amount) as total_staked,
  SUM(profit_loss) FILTER (WHERE result IN ('win', 'loss')) as total_profit,
  ROUND(
    (SUM(profit_loss) FILTER (WHERE result IN ('win', 'loss')) /
     NULLIF(SUM(stake_amount) FILTER (WHERE result IN ('win', 'loss')), 0)) * 100,
    2
  ) as roi_pct,
  ROUND(AVG(clv_points) FILTER (WHERE clv_points IS NOT NULL), 2) as avg_clv
FROM paper_bets
GROUP BY season, week
ORDER BY season DESC, week DESC;

-- Running totals view
CREATE OR REPLACE VIEW paper_bets_running AS
SELECT
  id,
  bet_placed_at,
  season,
  week,
  side,
  market_spread_home,
  model_spread_home,
  edge_points,
  closing_spread_home,
  clv_points,
  result,
  stake_amount,
  profit_loss,
  SUM(profit_loss) OVER (ORDER BY bet_placed_at) as cumulative_pnl,
  SUM(stake_amount) OVER (ORDER BY bet_placed_at) as cumulative_staked
FROM paper_bets
WHERE result IN ('win', 'loss')
ORDER BY bet_placed_at;
