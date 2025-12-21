-- Create game_predictions table to store locked model predictions at game time
-- This preserves what our model said so we can track historical performance

CREATE TABLE IF NOT EXISTS game_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  sportsbook_id UUID REFERENCES sportsbooks(id),

  -- Market data at game time
  closing_spread_home DECIMAL(5,1),
  closing_total DECIMAL(5,1),
  closing_price_american INTEGER,

  -- Model prediction at game time
  model_spread_home DECIMAL(5,1),
  model_total DECIMAL(5,1),
  model_version_id UUID REFERENCES model_versions(id),

  -- Edge calculation
  edge_points DECIMAL(5,2),
  recommended_side VARCHAR(10), -- 'home', 'away', 'over', 'under'
  recommended_bet TEXT, -- e.g., "Army +6.5"

  -- Result (filled in after game completes)
  bet_result VARCHAR(10), -- 'win', 'loss', 'push'

  -- Metadata
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(event_id, sportsbook_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_game_predictions_event_id ON game_predictions(event_id);
CREATE INDEX IF NOT EXISTS idx_game_predictions_locked_at ON game_predictions(locked_at);

-- Enable RLS
ALTER TABLE game_predictions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated reads
CREATE POLICY "Allow public read access" ON game_predictions
  FOR SELECT USING (true);
