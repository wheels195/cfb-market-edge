/**
 * Debug script to trace where model_total_points = 55 is coming from
 */
import { createClient } from '@supabase/supabase-js';
import { generateTotalProjection, DEFAULT_COEFFICIENTS } from '../src/lib/models/market-calibrated-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function debug() {
  // Get all total edges
  const { data: edges } = await supabase
    .from('edges')
    .select('id, market_total_points, model_total_points, edge_points')
    .eq('market_type', 'total');

  console.log('=== Total Edges Summary ===');
  console.log('Count:', edges?.length);

  let countZeroEdge = 0;
  let countModel55 = 0;
  let countModelMatchesMarket = 0;

  for (const edge of edges || []) {
    // Simulate market-calibrated
    const mcProjection = generateTotalProjection(
      edge.market_total_points,
      { combinedPaceAdjustment: 0, weatherTotalImpact: 0, isIndoor: false },
      DEFAULT_COEFFICIENTS
    );

    if (mcProjection.cappedEdge === 0) countZeroEdge++;
    if (edge.model_total_points === 55) countModel55++;
    if (edge.model_total_points === edge.market_total_points) countModelMatchesMarket++;
  }

  console.log('Edges where market-calibrated returns edge=0:', countZeroEdge);
  console.log('Edges where model_total_points=55:', countModel55);
  console.log('Edges where model matches market:', countModelMatchesMarket);

  // Check spread edges - were they updated?
  const { data: spreadEdges } = await supabase
    .from('edges')
    .select('explain')
    .eq('market_type', 'spread')
    .not('explain', 'is', null)
    .limit(3);

  console.log('\n=== Spread Edge Explain Field ===');
  for (const e of spreadEdges || []) {
    console.log('modelVersion:', (e.explain as Record<string, unknown>)?.modelVersion);
  }

  // The bug is: if edge = 0 from market-calibrated, we return early
  // But we should still update model_total_points to reflect market-calibrated value
  console.log('\n=== Bug Diagnosis ===');
  console.log('When market-calibrated returns edge=0 (no weather/pace adjustments),');
  console.log('processTotalEdge returns early WITHOUT updating the edge.');
  console.log('This leaves model_total_points at its old value (55 from projections table).');
  console.log('');
  console.log('FIX: processTotalEdge should ALWAYS update the model_total_points');
  console.log('to the market-calibrated value, even when edge=0.');
  console.log('The edge should be 0 (model = market), not 55 vs market.');
}

debug();
