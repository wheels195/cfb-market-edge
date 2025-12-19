/**
 * Delete old edges that don't have market-calibrated data
 * (edges where explain.adjustmentBreakdown is null)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Checking for old non-calibrated edges...\n');

  // Count edges without adjustmentBreakdown (old format)
  const { data: oldEdges } = await supabase
    .from('edges')
    .select('id, event_id, market_type, edge_points')
    .is('explain->adjustmentBreakdown', null);

  console.log(`Found ${oldEdges?.length || 0} edges without adjustmentBreakdown (old format)`);

  if (!oldEdges || oldEdges.length === 0) {
    console.log('No old edges to clean up');
    return;
  }

  // Show breakdown
  const spreads = oldEdges.filter(e => e.market_type === 'spread');
  const totals = oldEdges.filter(e => e.market_type === 'total');
  console.log(`  - Spread edges: ${spreads.length}`);
  console.log(`  - Total edges: ${totals.length}`);

  // Show some examples of bad edges
  const badEdges = oldEdges.filter(e => Math.abs(e.edge_points) > 5);
  console.log(`\nEdges with |edge| > 5 points: ${badEdges.length}`);

  // Delete old edges
  console.log('\nDeleting old edges...');
  const { error, count } = await supabase
    .from('edges')
    .delete()
    .is('explain->adjustmentBreakdown', null);

  if (error) {
    console.error('Delete failed:', error.message);
  } else {
    console.log(`Deleted ${count || 'unknown'} old edges`);
  }

  // Verify
  const { count: remaining } = await supabase
    .from('edges')
    .select('*', { count: 'exact', head: true });
  console.log(`\nRemaining edges: ${remaining}`);
}

main().catch(console.error);
