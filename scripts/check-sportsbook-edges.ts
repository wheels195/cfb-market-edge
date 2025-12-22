/**
 * Check sportsbook filtering for edges
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('=== Checking Sportsbook Edge Filtering ===\n');

  // Get sportsbooks
  const { data: sportsbooks } = await supabase
    .from('sportsbooks')
    .select('id, key, name');

  console.log('Sportsbooks:');
  for (const sb of sportsbooks || []) {
    console.log(`  ${sb.key}: ${sb.name} (${sb.id})`);
  }

  // Get scheduled event IDs
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'scheduled')
    .gte('commence_time', '2025-12-20')
    .limit(20);

  const eventIds = events?.map(e => e.id) || [];
  console.log('\nScheduled events (Dec 20+):', eventIds.length);

  // Get edges grouped by sportsbook
  const { data: edges } = await supabase
    .from('edges')
    .select('event_id, sportsbook_id, market_spread_home, edge_points')
    .in('event_id', eventIds);

  console.log('Total edges for these events:', edges?.length || 0);

  // Group by sportsbook
  const bySportsbook: Record<string, number> = {};
  for (const e of edges || []) {
    const key = e.sportsbook_id;
    bySportsbook[key] = (bySportsbook[key] || 0) + 1;
  }

  console.log('\nEdges by sportsbook ID:');
  const sportsbookMap = new Map((sportsbooks || []).map(s => [s.id, s.key]));
  for (const [id, count] of Object.entries(bySportsbook)) {
    console.log(`  ${sportsbookMap.get(id) || id}: ${count}`);
  }

  // Check if DraftKings/Bovada have edges
  const dkId = sportsbooks?.find(s => s.key === 'draftkings')?.id;
  const bovadaId = sportsbooks?.find(s => s.key === 'bovada')?.id;

  console.log('\nDraftKings ID:', dkId);
  console.log('Bovada ID:', bovadaId);

  const dkEdges = edges?.filter(e => e.sportsbook_id === dkId).length || 0;
  const bovadaEdges = edges?.filter(e => e.sportsbook_id === bovadaId).length || 0;

  console.log('\nDK edges:', dkEdges);
  console.log('Bovada edges:', bovadaEdges);

  // Show sample edges
  if (edges && edges.length > 0) {
    console.log('\nSample edges:');
    for (const e of edges.slice(0, 5)) {
      console.log(`  ${sportsbookMap.get(e.sportsbook_id) || e.sportsbook_id}: spread ${e.market_spread_home}, edge ${e.edge_points?.toFixed(2)}`);
    }
  }
}

run().catch(console.error);
