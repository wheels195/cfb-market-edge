/**
 * Verify edges are working across all upcoming games
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== EDGE VERIFICATION REPORT ===\n');

  // Get all upcoming events with edges
  const { data: events } = await supabase
    .from('events')
    .select(`
      id, commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', new Date().toISOString())
    .order('commence_time', { ascending: true })
    .limit(20);

  if (!events) {
    console.log('No events found');
    return;
  }

  console.log(`Checking ${events.length} upcoming events...\n`);

  let gamesWithTotalEdges = 0;
  let gamesWithAdjustments = 0;
  let gamesWithZeroAdjustment = 0;
  let gamesNoEdges = 0;

  for (const event of events) {
    const home = Array.isArray(event.home_team) ? event.home_team[0] : event.home_team;
    const away = Array.isArray(event.away_team) ? event.away_team[0] : event.away_team;
    const matchup = `${away?.name || 'Unknown'} @ ${home?.name || 'Unknown'}`;

    // Get total edges for this event
    const { data: edges } = await supabase
      .from('edges')
      .select('market_total_points, adjustment_points, model_total_points, recommended_side')
      .eq('event_id', event.id)
      .eq('market_type', 'total');

    if (!edges || edges.length === 0) {
      console.log(`❌ ${matchup}: NO EDGES`);
      gamesNoEdges++;
      continue;
    }

    gamesWithTotalEdges++;
    const edge = edges[0];
    const hasAdjustment = edge.adjustment_points !== 0 && edge.adjustment_points !== null;

    if (hasAdjustment) {
      gamesWithAdjustments++;
      console.log(`✓ ${matchup}: market=${edge.market_total_points}, adj=${edge.adjustment_points?.toFixed(1)}, model=${edge.model_total_points?.toFixed(1)}, rec=${edge.recommended_side}`);
    } else {
      gamesWithZeroAdjustment++;
      console.log(`⚠ ${matchup}: market=${edge.market_total_points}, adj=0 (no pace data?)`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total events checked: ${events.length}`);
  console.log(`Games with total edges: ${gamesWithTotalEdges}`);
  console.log(`  - With adjustments: ${gamesWithAdjustments}`);
  console.log(`  - Zero adjustment: ${gamesWithZeroAdjustment}`);
  console.log(`Games with no edges: ${gamesNoEdges}`);

  // Check spread edges too
  const { data: allEdges } = await supabase
    .from('edges')
    .select('market_type, edge_points')
    .gt('edge_points', 0);

  const spreadEdges = allEdges?.filter(e => e.market_type === 'spread') || [];
  const totalEdges = allEdges?.filter(e => e.market_type === 'total') || [];

  console.log(`\nEdges with positive edge_points:`);
  console.log(`  - Spread edges: ${spreadEdges.length}`);
  console.log(`  - Total edges: ${totalEdges.length}`);

  // Check for any very large adjustments (potential bugs)
  const { data: largeAdj } = await supabase
    .from('edges')
    .select('adjustment_points')
    .not('adjustment_points', 'is', null)
    .or('adjustment_points.gt.10,adjustment_points.lt.-10');

  if (largeAdj && largeAdj.length > 0) {
    console.log(`\n⚠️  WARNING: ${largeAdj.length} edges with adjustment > 10 pts`);
  }
}

main().catch(console.error);
