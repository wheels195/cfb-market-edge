/**
 * Simulate the /api/games endpoint to debug UI issues
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('=== Simulating /api/games Response ===\n');

  const now = new Date();
  const daysBack = 14;
  const daysAhead = 14;
  const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  console.log('Date range:');
  console.log('  Start:', startDate.toISOString());
  console.log('  End:', endDate.toISOString());

  // Get events (same query as API)
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      status,
      home_team_id,
      away_team_id,
      cfbd_game_id,
      home_team:teams!events_home_team_id_fkey(id, name, cfbd_team_id),
      away_team:teams!events_away_team_id_fkey(id, name, cfbd_team_id)
    `)
    .gte('commence_time', startDate.toISOString())
    .lte('commence_time', endDate.toISOString())
    .order('commence_time', { ascending: true });

  if (eventsError) {
    console.error('Events fetch error:', eventsError);
    return;
  }

  console.log('\nEvents fetched:', events?.length || 0);

  if (!events || events.length === 0) {
    console.log('No events found in date range!');
    return;
  }

  // Show sample events
  console.log('\nSample events:');
  for (const e of events.slice(0, 5)) {
    const home = Array.isArray(e.home_team) ? e.home_team[0] : e.home_team;
    const away = Array.isArray(e.away_team) ? e.away_team[0] : e.away_team;
    console.log(`  ${new Date(e.commence_time).toLocaleDateString()} - ${away?.name || 'NULL'} @ ${home?.name || 'NULL'} (${e.status})`);
  }

  // Count by status
  const scheduled = events.filter(e => e.status === 'scheduled').length;
  const final_ = events.filter(e => e.status === 'final').length;
  console.log(`\nScheduled: ${scheduled}, Final: ${final_}`);

  // Get edges
  const eventIds = events.map(e => e.id);
  const { data: edges } = await supabase
    .from('edges')
    .select('*')
    .in('event_id', eventIds)
    .eq('market_type', 'spread');

  console.log('\nEdges found:', edges?.length || 0);

  // Check game_predictions
  const { data: predictions } = await supabase
    .from('game_predictions')
    .select('event_id, recommended_bet')
    .in('event_id', eventIds);

  console.log('Predictions found:', predictions?.length || 0);

  // Count events with edges
  const eventIdsWithEdges = new Set((edges || []).map(e => e.event_id));
  const eventsWithEdges = events.filter(e => eventIdsWithEdges.has(e.id));
  console.log('Events with edges:', eventsWithEdges.length);

  // The API filters out completed games without predictions
  // Let's simulate that
  const finalWithoutPredictions = events.filter(e => {
    const isCompleted = e.status === 'final';
    const hasPrediction = predictions?.some(p => p.event_id === e.id);
    return isCompleted && !hasPrediction;
  });

  console.log('\nFinal games WITHOUT predictions (would be filtered out):', finalWithoutPredictions.length);

  const gamesAfterFilter = events.filter(e => {
    const isCompleted = e.status === 'final';
    if (isCompleted) {
      const hasPrediction = predictions?.some(p => p.event_id === e.id);
      if (!hasPrediction) return false;
    }
    return true;
  });

  console.log('Games after filter:', gamesAfterFilter.length);
  console.log('  Scheduled:', gamesAfterFilter.filter(e => e.status === 'scheduled').length);
  console.log('  Final (with predictions):', gamesAfterFilter.filter(e => e.status === 'final').length);
}

run().catch(console.error);
