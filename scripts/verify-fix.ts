import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function verify() {
  // Get all total edges
  const { data: edges } = await supabase
    .from('edges')
    .select('id, market_total_points, model_total_points, edge_points, explain, updated_at')
    .eq('market_type', 'total')
    .order('updated_at', { ascending: false })
    .limit(10);

  console.log('=== Recently Updated Total Edges ===');
  let count55 = 0;
  let countMatchesMarket = 0;
  let hasModelVersion = 0;

  for (const e of edges || []) {
    console.log({
      market: e.market_total_points,
      model: e.model_total_points,
      edge: e.edge_points,
      modelVersion: (e.explain as Record<string, unknown>)?.modelVersion,
      updated: e.updated_at
    });

    if (e.model_total_points === 55) count55++;
    if (e.model_total_points === e.market_total_points) countMatchesMarket++;
    if ((e.explain as Record<string, unknown>)?.modelVersion) hasModelVersion++;
  }

  console.log('\n=== Summary (first 10) ===');
  console.log('Still showing 55:', count55);
  console.log('Model matches market:', countMatchesMarket);
  console.log('Has modelVersion in explain:', hasModelVersion);

  // Get overall stats
  const { data: allEdges } = await supabase
    .from('edges')
    .select('model_total_points, market_total_points')
    .eq('market_type', 'total');

  let totalCount55 = 0;
  let totalMatchesMarket = 0;
  const uniqueModelValues = new Set<number>();

  for (const e of allEdges || []) {
    if (e.model_total_points === 55) totalCount55++;
    if (e.model_total_points === e.market_total_points) totalMatchesMarket++;
    uniqueModelValues.add(e.model_total_points);
  }

  console.log('\n=== Overall Stats (all total edges) ===');
  console.log('Total edges:', allEdges?.length);
  console.log('Still showing 55:', totalCount55);
  console.log('Model matches market:', totalMatchesMarket);
  console.log('Unique model values:', [...uniqueModelValues].sort((a, b) => a - b).slice(0, 20));
}

verify();
