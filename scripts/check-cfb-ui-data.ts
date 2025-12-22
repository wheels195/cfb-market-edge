/**
 * Check CFB UI data availability
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('=== CFB UI Data Check ===\n');

  // Get ALL CFB events (case insensitive)
  const { data: events } = await supabase
    .from('events')
    .select('id, commence_time, status, league')
    .or('league.eq.ncaaf,league.eq.NCAAF')
    .gte('commence_time', '2025-12-15')
    .order('commence_time');

  console.log('CFB events Dec 15+:', events?.length || 0);

  // Group by date
  const byDate: Record<string, { scheduled: number; final: number }> = {};
  for (const e of events || []) {
    const d = new Date(e.commence_time).toLocaleDateString();
    if (!byDate[d]) byDate[d] = { scheduled: 0, final: 0 };
    if (e.status === 'scheduled') byDate[d].scheduled++;
    else byDate[d].final++;
  }

  console.log('\nBy date:');
  for (const [date, counts] of Object.entries(byDate)) {
    console.log(`  ${date}: ${counts.scheduled} scheduled, ${counts.final} final`);
  }

  // Check most recent events by created_at
  const { data: recent } = await supabase
    .from('events')
    .select('commence_time, status, created_at')
    .or('league.eq.ncaaf,league.eq.NCAAF')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\nMost recently created events:');
  for (const e of recent || []) {
    console.log(`  Created ${new Date(e.created_at).toLocaleDateString()} - Game ${new Date(e.commence_time).toLocaleDateString()} (${e.status})`);
  }

  // Check edges for upcoming games
  const upcomingIds = (events || []).filter(e => e.status === 'scheduled').map(e => e.id);
  const { data: edges } = await supabase
    .from('edges')
    .select('event_id, market_spread_home, edge_points')
    .in('event_id', upcomingIds.slice(0, 20));

  console.log('\nEdges for upcoming CFB games:', edges?.length || 0);
  if (edges && edges.length > 0) {
    console.log('Sample edge:', edges[0]);
  }

  // Check projections
  const { data: projections } = await supabase
    .from('projections')
    .select('event_id, model_spread_home')
    .in('event_id', upcomingIds.slice(0, 20));

  console.log('Projections for upcoming CFB games:', projections?.length || 0);
}

run().catch(console.error);
