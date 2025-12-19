import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function debug() {
  console.log('=== 1. CHECKING EVENTS ===');
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, home_team_name, away_team_name, commence_time, status')
    .gte('commence_time', new Date().toISOString())
    .order('commence_time', { ascending: true })
    .limit(10);

  if (eventsError) {
    console.log('Events error:', eventsError);
  } else {
    console.log(`Found ${events?.length || 0} upcoming events:`);
    for (const e of events || []) {
      console.log(`  ${e.id}: ${e.away_team_name} @ ${e.home_team_name} | ${e.commence_time} | ${e.status}`);
    }
  }

  if (events && events.length > 0) {
    const eventId = events[0].id;
    console.log(`\n=== 2. CHECKING ODDS_TICKS FOR EVENT ${eventId} ===`);

    const { data: ticks, error: ticksError } = await supabase
      .from('odds_ticks')
      .select('*, sportsbooks(name)')
      .eq('event_id', eventId)
      .order('captured_at', { ascending: false })
      .limit(20);

    if (ticksError) {
      console.log('Ticks error:', ticksError);
    } else {
      console.log(`Found ${ticks?.length || 0} ticks:`);
      for (const t of ticks || []) {
        const sb = t.sportsbooks as { name: string } | null;
        console.log(`  ${sb?.name} | ${t.market_type} | side=${t.side} | spread_home=${t.spread_points_home} | total=${t.total_points} | ${t.captured_at}`);
      }
    }

    console.log(`\n=== 3. CHECKING PROJECTIONS FOR EVENT ${eventId} ===`);
    const { data: projections, error: projError } = await supabase
      .from('projections')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (projError) {
      console.log('Projections error:', projError);
    } else {
      console.log(`Found ${projections?.length || 0} projections:`);
      for (const p of projections || []) {
        console.log(`  spread_home=${p.spread_home} | total=${p.total_points} | baseline_total=${p.baseline_total_points} | adj=${p.adjustment_points} | ${p.created_at}`);
      }
    }

    console.log(`\n=== 4. CHECKING EDGES FOR EVENT ${eventId} ===`);
    const { data: edges, error: edgesError } = await supabase
      .from('edges')
      .select('*, sportsbooks(name)')
      .eq('event_id', eventId)
      .limit(10);

    if (edgesError) {
      console.log('Edges error:', edgesError);
    } else {
      console.log(`Found ${edges?.length || 0} edges:`);
      for (const e of edges || []) {
        const sb = e.sportsbooks as { name: string } | null;
        console.log(`  ${sb?.name} | ${e.market_type}`);
        console.log(`    market_spread_home=${e.market_spread_home} | model_spread_home=${e.model_spread_home}`);
        console.log(`    market_total=${e.market_total_points} | model_total=${e.model_total_points}`);
        console.log(`    baseline_total=${e.baseline_total_points} | adj=${e.adjustment_points}`);
        console.log(`    edge=${e.edge_points} | side=${e.recommended_side}`);
      }
    }
  }

  // Check total row counts
  console.log('\n=== 5. TABLE ROW COUNTS ===');
  const { count: eventCount } = await supabase.from('events').select('*', { count: 'exact', head: true });
  const { count: tickCount } = await supabase.from('odds_ticks').select('*', { count: 'exact', head: true });
  const { count: projCount } = await supabase.from('projections').select('*', { count: 'exact', head: true });
  const { count: edgeCount } = await supabase.from('edges').select('*', { count: 'exact', head: true });

  console.log(`  events: ${eventCount}`);
  console.log(`  odds_ticks: ${tickCount}`);
  console.log(`  projections: ${projCount}`);
  console.log(`  edges: ${edgeCount}`);

  // Check scheduled events
  console.log('\n=== 6. SCHEDULED EVENTS ===');
  const { data: scheduled, count: schedCount } = await supabase
    .from('events')
    .select('*', { count: 'exact' })
    .eq('status', 'scheduled');
  console.log(`  Total scheduled: ${schedCount}`);

  // Check if any events have Alabama
  console.log('\n=== 7. ALABAMA EVENTS ===');
  const { data: alabamaEvents } = await supabase
    .from('events')
    .select('id, home_team_name, away_team_name, commence_time, status')
    .or('home_team_name.ilike.%alabama%,away_team_name.ilike.%alabama%')
    .limit(5);

  console.log(`Found ${alabamaEvents?.length || 0} Alabama events:`);
  for (const e of alabamaEvents || []) {
    console.log(`  ${e.id}: ${e.away_team_name} @ ${e.home_team_name} | ${e.status} | ${e.commence_time}`);
  }
}

debug().catch(console.error);
