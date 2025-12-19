import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Get SP+ ratings with team names
  const { data: ratings } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall, teams!inner(name)')
    .eq('season', 2024)
    .not('sp_overall', 'is', null)
    .order('sp_overall', { ascending: false })
    .limit(20);

  console.log('Top SP+ teams (2024):');
  for (const r of ratings || []) {
    console.log(`  ${(r.teams as any).name}: ${r.sp_overall} (team_id: ${r.team_id.substring(0, 8)}...)`);
  }

  // Check Army specifically
  console.log('\n\nChecking Army:');
  const { data: armyRatings } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall, teams!inner(name)')
    .ilike('teams.name', '%army%');

  console.log(armyRatings);

  // Check events for Army
  console.log('\n\nArmy in events:');
  const { data: armyEvents } = await supabase
    .from('events')
    .select('id, home_team_id, home_team:teams!events_home_team_id_fkey(name)')
    .limit(100);

  const armyEvent = armyEvents?.find(e => (e.home_team as any)?.name?.toLowerCase().includes('army'));
  console.log(armyEvent);
}

main();
