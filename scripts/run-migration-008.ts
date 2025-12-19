/**
 * Run migration 008 - Add baseline_total_points and adjustment_points columns
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Running migration 008: Adding baseline_total_points and adjustment_points columns...\n');

  // Check if columns already exist
  const { data: existingEdge } = await supabase
    .from('edges')
    .select('id, baseline_total_points, adjustment_points')
    .limit(1);

  if (existingEdge && existingEdge.length > 0) {
    const sample = existingEdge[0];
    if ('baseline_total_points' in sample) {
      console.log('✓ Columns already exist! Migration was previously applied.');
      console.log('  Sample edge:', JSON.stringify(sample, null, 2));
      return;
    }
  }

  console.log('Columns do not exist yet. Please run this SQL in Supabase Dashboard:');
  console.log('');
  console.log('='.repeat(80));
  console.log(`
-- Migration 008: Add baseline_total_points and adjustment_points columns

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
`);
  console.log('='.repeat(80));
}

runMigration().catch(console.error);
