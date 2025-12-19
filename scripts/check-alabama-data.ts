import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function check() {
  // Get edges with Alabama
  const { data: edges } = await supabase
    .from('edges')
    .select('*, events!inner(home_team_name, away_team_name, commence_time), sportsbooks(name)')
    .or('events.home_team_name.ilike.%alabama%,events.away_team_name.ilike.%alabama%')
    .order('events(commence_time)', { ascending: true })
    .limit(10);

  console.log('=== EDGES FOR ALABAMA ===');
  for (const e of edges || []) {
    const ev = e.events as { home_team_name: string; away_team_name: string };
    const sb = e.sportsbooks as { name: string } | null;
    console.log(`${ev.away_team_name} @ ${ev.home_team_name}`);
    console.log(`  Book: ${sb?.name}, Type: ${e.market_type}`);
    console.log(`  Market: spread=${e.market_spread_home}, total=${e.market_total_points}`);
    console.log(`  Model: spread=${e.model_spread_home}, total=${e.model_total_points}`);
    console.log(`  Edge: ${e.edge_points}, Side: ${e.recommended_side}`);
    console.log('');
  }

  // Check latest odds_ticks for Alabama
  const { data: events } = await supabase
    .from('events')
    .select('id, home_team_name, away_team_name')
    .or('home_team_name.ilike.%alabama%,away_team_name.ilike.%alabama%')
    .eq('status', 'scheduled')
    .limit(1);

  if (events && events[0]) {
    const eventId = events[0].id;
    console.log('=== LATEST ODDS TICKS ===');
    console.log(`Event: ${events[0].away_team_name} @ ${events[0].home_team_name}`);

    const { data: ticks } = await supabase
      .from('odds_ticks')
      .select('*, sportsbooks(name)')
      .eq('event_id', eventId)
      .order('captured_at', { ascending: false })
      .limit(20);

    for (const t of ticks || []) {
      const sb = t.sportsbooks as { name: string } | null;
      console.log(`  ${sb?.name} | ${t.market_type} | side=${t.side} | spread=${t.spread_points_home} | total=${t.total_points} | ${t.captured_at}`);
    }
  }
}

check().catch(console.error);
