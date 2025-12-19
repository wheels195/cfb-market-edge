-- Migration 009: Complete totals setup with constraints and indexes
-- Run this in Supabase Dashboard > SQL Editor

-- 1) Add baseline_total_points and adjustment_points columns
ALTER TABLE edges ADD COLUMN IF NOT EXISTS baseline_total_points NUMERIC;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS adjustment_points NUMERIC DEFAULT 0;

-- 2) Add comments for documentation
COMMENT ON COLUMN edges.baseline_total_points IS 'Market total used as baseline (equals market_total_points for totals)';
COMMENT ON COLUMN edges.adjustment_points IS 'Total adjustments applied (weather + pace). model_total_points = baseline + adjustment';

-- 3) Backfill existing total edges
UPDATE edges
SET
  baseline_total_points = market_total_points,
  adjustment_points = COALESCE(model_total_points - market_total_points, 0)
WHERE market_type = 'total'
  AND baseline_total_points IS NULL;

-- 4) Add CHECK constraint for sanity (hard safety limit)
-- This prevents obviously bad data from being stored
ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_adjustment_points_check;
ALTER TABLE edges ADD CONSTRAINT edges_adjustment_points_check
  CHECK (adjustment_points IS NULL OR abs(adjustment_points) <= 30);

-- 5) Add index for querying by adjustment size
CREATE INDEX IF NOT EXISTS idx_edges_adjustment_points ON edges(adjustment_points)
WHERE market_type = 'total';

-- 6) Add index on events.commence_time for cleanup queries
CREATE INDEX IF NOT EXISTS idx_events_commence_time ON events(commence_time);

-- 7) Add index for cleanup: events by status and commence_time
CREATE INDEX IF NOT EXISTS idx_events_status_commence_time ON events(status, commence_time);

-- Verify the migration
SELECT
  'edges columns' as check_type,
  COUNT(*) as total_edges,
  COUNT(baseline_total_points) as with_baseline,
  COUNT(adjustment_points) as with_adjustment
FROM edges
WHERE market_type = 'total';
