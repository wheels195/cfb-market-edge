/**
 * Debug why projections aren't matching
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Get a sample upcoming event
  const { data: events } = await supabase
    .from('events')
    .select(`
      id, commence_time,
      home_team_id, away_team_id,
      home_team:teams!events_home_team_id_fkey(id, name),
      away_team:teams!events_away_team_id_fkey(id, name)
    `)
    .eq('status', 'scheduled')
    .limit(3);

  console.log('Sample upcoming events:');
  for (const e of events || []) {
    console.log(`  ${(e.away_team as any)?.name} @ ${(e.home_team as any)?.name}`);
    console.log(`    Home team ID: ${e.home_team_id}`);
    console.log(`    Away team ID: ${e.away_team_id}`);
  }

  // Get sample SP+ ratings
  const { data: spRatings } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall, teams!inner(name)')
    .not('sp_overall', 'is', null)
    .limit(5);

  console.log('\nSample SP+ ratings:');
  for (const r of spRatings || []) {
    console.log(`  ${(r.teams as any)?.name}: ${r.sp_overall} (${r.season}) - team_id: ${r.team_id}`);
  }

  // Check if event team IDs exist in SP+ ratings
  if (events && events.length > 0) {
    const homeTeamId = events[0].home_team_id;
    const { data: matchingRating } = await supabase
      .from('advanced_team_ratings')
      .select('team_id, season, sp_overall')
      .eq('team_id', homeTeamId)
      .limit(1);

    console.log(`\nDoes home team ${homeTeamId} have SP+ ratings?`);
    console.log(matchingRating);
  }

  // Count teams with SP+ vs teams in events
  const { data: teamsInEvents } = await supabase
    .from('events')
    .select('home_team_id')
    .eq('status', 'scheduled');

  const uniqueTeamIds = [...new Set((teamsInEvents || []).map(e => e.home_team_id))];
  console.log(`\nUnique teams in upcoming events: ${uniqueTeamIds.length}`);

  const { data: teamsWithSP } = await supabase
    .from('advanced_team_ratings')
    .select('team_id')
    .not('sp_overall', 'is', null);

  const spTeamIds = new Set((teamsWithSP || []).map(t => t.team_id));
  console.log(`Teams with SP+ ratings: ${spTeamIds.size}`);

  // Check overlap
  const matching = uniqueTeamIds.filter(id => spTeamIds.has(id));
  console.log(`Teams in events that have SP+: ${matching.length}`);
}

main();
