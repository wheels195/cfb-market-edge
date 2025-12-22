-- Add TRUE DK opening spread columns
-- Separate from existing spread_open (which was T-15 data)

ALTER TABLE cbb_betting_lines
ADD COLUMN IF NOT EXISTS dk_spread_open NUMERIC(5,1),
ADD COLUMN IF NOT EXISTS dk_spread_open_ts TIMESTAMPTZ;

-- Add index for games needing open sync
CREATE INDEX IF NOT EXISTS idx_cbb_betting_lines_needs_open_sync
ON cbb_betting_lines (cbbd_game_id)
WHERE dk_spread_open IS NULL AND execution_timing IS NOT NULL;

COMMENT ON COLUMN cbb_betting_lines.dk_spread_open IS 'True DK opening spread (earliest available snapshot)';
COMMENT ON COLUMN cbb_betting_lines.dk_spread_open_ts IS 'Timestamp when opening spread was captured';
