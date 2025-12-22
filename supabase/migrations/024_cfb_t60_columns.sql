-- Add columns for T-60 execution validation
-- start_date: Game kickoff time for computing T-60 timestamp
-- spread_t60: DK spread at 60 minutes before kickoff

ALTER TABLE cfbd_betting_lines
ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;

ALTER TABLE cfbd_betting_lines
ADD COLUMN IF NOT EXISTS spread_t60 NUMERIC(6,2);

-- Also add total_t60 for future use
ALTER TABLE cfbd_betting_lines
ADD COLUMN IF NOT EXISTS total_t60 NUMERIC(6,2);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_cfbd_lines_start_date ON cfbd_betting_lines(start_date);
