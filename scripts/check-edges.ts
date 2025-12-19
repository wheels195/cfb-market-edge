import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  // Get the NEWEST total edges by updated_at
  const { data: edges } = await supabase
    .from('edges')
    .select('id, event_id, market_type, model_total_points, market_total_points, edge_points, created_at, as_of, updated_at, explain')
    .eq('market_type', 'total')
    .order('updated_at', { ascending: false })
    .limit(5);

  console.log('=== Most Recently UPDATED Total Edges ===');
  for (const e of edges || []) {
    console.log(JSON.stringify({
      model: e.model_total_points,
      market: e.market_total_points,
      edge: e.edge_points,
      updated_at: e.updated_at,
      as_of: e.as_of,
      explain_model_version: (e.explain as Record<string, unknown>)?.modelVersion,
      explain_adjustments: (e.explain as Record<string, unknown>)?.adjustmentBreakdown
    }, null, 2));
  }

  // Also check if there are any totals with model != 55
  const { data: nonFifty } = await supabase
    .from('edges')
    .select('model_total_points, market_total_points, edge_points')
    .eq('market_type', 'total')
    .neq('model_total_points', 55)
    .limit(5);

  console.log('\n=== Total edges where model != 55 ===');
  console.log(JSON.stringify(nonFifty, null, 2));
}

check();
