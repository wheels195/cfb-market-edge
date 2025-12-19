/**
 * Fix stale total edges by setting model_total_points = market_total_points
 *
 * For market-calibrated totals:
 * - model = market line (as baseline)
 * - edge comes only from weather/pace adjustments
 * - without adjustments, edge = 0
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function fixStaleTotals() {
  console.log('Fixing stale total edges...');

  // Get all total edges where model != market (stale)
  const { data: staleEdges, error: fetchError } = await supabase
    .from('edges')
    .select('id, market_total_points, model_total_points')
    .eq('market_type', 'total')
    .neq('model_total_points', supabase.rpc('get_market', {})); // This won't work

  // Actually, we need to do this row by row or with a raw SQL update
  // Let me get all total edges and update them
  const { data: allTotalEdges, error } = await supabase
    .from('edges')
    .select('id, market_total_points, model_total_points, explain')
    .eq('market_type', 'total');

  if (error) {
    console.error('Error fetching edges:', error);
    return;
  }

  console.log('Total edges found:', allTotalEdges?.length);

  let updated = 0;
  let skipped = 0;

  for (const edge of allTotalEdges || []) {
    // Skip if already correct
    if (edge.model_total_points === edge.market_total_points) {
      skipped++;
      continue;
    }

    // Update to set model = market, edge = 0
    const { error: updateError } = await supabase
      .from('edges')
      .update({
        model_total_points: edge.market_total_points,
        edge_points: 0,
        recommended_side: 'none',
        recommended_bet_label: 'No edge (model = market)',
        explain: {
          ...(edge.explain as Record<string, unknown> || {}),
          modelVersion: 'market-calibrated-v2',
          reason: 'Market-calibrated total (no weather/pace adjustments)',
          rawEdge: 0,
          cappedEdge: 0,
          adjustmentBreakdown: {
            conference: 0,
            injuries: 0,
            lineMovement: 0,
            weather: 0,
            situational: 0,
            total: 0
          }
        }
      })
      .eq('id', edge.id);

    if (updateError) {
      console.error(`Error updating edge ${edge.id}:`, updateError);
    } else {
      updated++;
    }
  }

  console.log(`Updated: ${updated}, Skipped (already correct): ${skipped}`);
}

fixStaleTotals();
