-- Add baseline_total_points and adjustment_points columns to edges table
-- This separates the market baseline from the model's adjusted value

-- Add new columns
ALTER TABLE edges ADD COLUMN IF NOT EXISTS baseline_total_points NUMERIC;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS adjustment_points NUMERIC DEFAULT 0;

-- Comment on columns for documentation
COMMENT ON COLUMN edges.baseline_total_points IS 'Market total used as baseline (equals market_total_points for totals)';
COMMENT ON COLUMN edges.adjustment_points IS 'Total adjustments applied (weather + pace). model_total_points = baseline + adjustment';

-- Backfill existing total edges:
-- baseline = market, adjustment = model - market (or 0 if model = market)
UPDATE edges
SET
  baseline_total_points = market_total_points,
  adjustment_points = COALESCE(model_total_points - market_total_points, 0)
WHERE market_type = 'total';

-- Add index for querying by adjustment size
CREATE INDEX IF NOT EXISTS idx_edges_adjustment_points ON edges(adjustment_points)
WHERE market_type = 'total';
