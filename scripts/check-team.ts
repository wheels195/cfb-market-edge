import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function main() {
  // Check Alabama event
  const { data: events } = await supabase
    .from('events')
    .select('id, home_team_id, away_team_id, commence_time, status')
    .or('home_team_id.ilike.%alabama%,away_team_id.ilike.%alabama%')
    .eq('status', 'scheduled');

  console.log('Alabama events:', JSON.stringify(events, null, 2));

  // Check by home team name
  const { data: events2 } = await supabase
    .from('events')
    .select(`
      id, status, commence_time,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', new Date().toISOString());

  console.log('\nUpcoming events:', events2?.length);
  const alabamaEvent = events2?.find(e => {
    const home = Array.isArray(e.home_team) ? e.home_team[0] : e.home_team;
    const away = Array.isArray(e.away_team) ? e.away_team[0] : e.away_team;
    return home?.name?.includes('Alabama') || away?.name?.includes('Alabama');
  });

  if (alabamaEvent) {
    console.log('\nAlabama @ Oklahoma found');
    console.log('Event ID:', alabamaEvent.id);

    // Check team IDs
    const { data: event } = await supabase
      .from('events')
      .select('home_team_id, away_team_id')
      .eq('id', alabamaEvent.id)
      .single();
    console.log('\nHome team ID:', event?.home_team_id);
    console.log('Away team ID:', event?.away_team_id);

    // Check stats for both teams - query directly
    if (event) {
      // Get ALL stats for these teams to debug
      const { data: allHomeStats } = await supabase
        .from('team_advanced_stats')
        .select('season, plays_per_game, pace_rank')
        .eq('team_id', event.home_team_id);
      console.log('\nOklahoma all stats:', JSON.stringify(allHomeStats, null, 2));

      const { data: allAwayStats } = await supabase
        .from('team_advanced_stats')
        .select('season, plays_per_game, pace_rank')
        .eq('team_id', event.away_team_id);
      console.log('Alabama all stats:', JSON.stringify(allAwayStats, null, 2));
    }

    // Check one total edge with full explain
    const { data: edges } = await supabase
      .from('edges')
      .select('*')
      .eq('event_id', alabamaEvent.id)
      .eq('market_type', 'total')
      .limit(1);
    if (edges?.length) {
      const edge = edges[0];
      console.log('\nSample total edge:');
      console.log('  market_total:', edge.market_total_points);
      console.log('  baseline_total:', edge.baseline_total_points);
      console.log('  adjustment:', edge.adjustment_points);
      console.log('  model_total:', edge.model_total_points);
      console.log('  explain.adjustmentBreakdown:', JSON.stringify(edge.explain?.adjustmentBreakdown, null, 2));
    }
  } else {
    console.log('\nNo Alabama event found');
  }
}
main();
