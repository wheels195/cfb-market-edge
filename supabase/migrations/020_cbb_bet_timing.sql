-- CBB Bet Timing Schema Update
--
-- Execution price: T-60 DK spread (primary), T-30 (fallback)
-- Closing line stored separately for CLV diagnostics only
--
-- All modeling and backtests use execution_spread

-- Add new columns for bet timing
ALTER TABLE cbb_betting_lines
ADD COLUMN IF NOT EXISTS spread_t60 NUMERIC(5,1),
ADD COLUMN IF NOT EXISTS spread_t30 NUMERIC(5,1),
ADD COLUMN IF NOT EXISTS spread_close NUMERIC(5,1),
ADD COLUMN IF NOT EXISTS execution_timing TEXT CHECK (execution_timing IN ('t60', 't30')),
ADD COLUMN IF NOT EXISTS captured_at_t60 TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS captured_at_t30 TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS captured_at_close TIMESTAMPTZ;

-- Add computed column for execution spread (T-60 preferred, T-30 fallback)
-- This is the spread used for all modeling and backtests
COMMENT ON COLUMN cbb_betting_lines.spread_t60 IS 'DK spread at T-60 minutes (primary execution price)';
COMMENT ON COLUMN cbb_betting_lines.spread_t30 IS 'DK spread at T-30 minutes (fallback execution price)';
COMMENT ON COLUMN cbb_betting_lines.spread_close IS 'DK spread at close (CLV diagnostics only)';
COMMENT ON COLUMN cbb_betting_lines.execution_timing IS 'Which timing was used: t60 (primary) or t30 (fallback)';

-- Migrate existing data: current spread_home becomes spread_close (was captured at ~T-15)
-- Mark as needing re-sync for proper T-60/T-30 capture
UPDATE cbb_betting_lines
SET spread_close = spread_home,
    execution_timing = NULL  -- NULL indicates needs re-sync
WHERE spread_t60 IS NULL AND spread_t30 IS NULL;

-- Create index for efficient querying of games needing re-sync
CREATE INDEX IF NOT EXISTS idx_cbb_betting_lines_needs_resync
ON cbb_betting_lines (cbbd_game_id)
WHERE execution_timing IS NULL;

-- Create view for backtest-ready data (only games with valid execution spread)
CREATE OR REPLACE VIEW cbb_backtest_lines AS
SELECT
    bl.id,
    bl.game_id,
    bl.cbbd_game_id,
    bl.provider,
    COALESCE(bl.spread_t60, bl.spread_t30) AS execution_spread,
    bl.execution_timing,
    bl.spread_t60,
    bl.spread_t30,
    bl.spread_close,
    bl.captured_at_t60,
    bl.captured_at_t30,
    bl.captured_at_close,
    g.start_date,
    g.home_team_id,
    g.away_team_id,
    g.home_team_name,
    g.away_team_name,
    g.home_score,
    g.away_score,
    g.season
FROM cbb_betting_lines bl
JOIN cbb_games g ON g.id = bl.game_id
WHERE bl.provider = 'DraftKings'
  AND bl.execution_timing IS NOT NULL;
