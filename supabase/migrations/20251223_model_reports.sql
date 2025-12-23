-- Model performance reports table
-- Stores automated weekly analysis results

CREATE TABLE IF NOT EXISTS model_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  sport VARCHAR(10) NOT NULL, -- 'cfb' or 'cbb'

  -- Overall stats
  total_bets INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  pushes INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC(5,4),
  roi NUMERIC(6,4),
  profit_units NUMERIC(8,2),

  -- Comparison to backtest
  backtest_win_rate NUMERIC(5,4),
  vs_backtest VARCHAR(20), -- 'above', 'below', 'equal'
  vs_backtest_significant BOOLEAN DEFAULT FALSE,
  vs_breakeven_pvalue NUMERIC(6,4),

  -- Edge bucket breakdown (JSON)
  edge_buckets JSONB,

  -- Strategy breakdown for CBB
  favorites_record VARCHAR(20),
  favorites_roi NUMERIC(6,4),
  underdogs_record VARCHAR(20),
  underdogs_roi NUMERIC(6,4),

  -- Sample size assessment
  sample_size_adequate BOOLEAN DEFAULT FALSE,
  recommendation TEXT,

  -- Full report text
  report_text TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(report_date, sport)
);

-- Index for quick lookups
CREATE INDEX idx_model_reports_sport_date ON model_reports(sport, report_date DESC);
