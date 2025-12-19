/**
 * Debug team name mismatches between Odds API and CFBD
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  // Get teams from events (Odds API names)
  const { data: eventsTeams } = await supabase
    .from('teams')
    .select('id, name')
    .order('name');

  console.log('Teams in database (from Odds API):');
  const teamNames = (eventsTeams || []).map(t => t.name).slice(0, 20);
  console.log(teamNames.join(', '));

  // Get SP+ team names from CFBD (stored in advanced_team_ratings via team lookup)
  const { data: spTeams } = await supabase
    .from('advanced_team_ratings')
    .select('teams!inner(name)')
    .not('sp_overall', 'is', null);

  const spTeamNames = [...new Set((spTeams || []).map(t => (t.teams as any).name))].sort();
  console.log(`\nTeams with SP+ ratings: ${spTeamNames.length}`);
  console.log(spTeamNames.slice(0, 20).join(', '));

  // Find examples that don't match
  console.log('\n=== COMPARING NAMES ===');

  // Example: Alabama
  const alabamaOdds = eventsTeams?.find(t => t.name.toLowerCase().includes('alabama'));
  const alabamaCFBD = spTeamNames.find(n => n.toLowerCase().includes('alabama'));
  console.log(`\nAlabama in Odds API: "${alabamaOdds?.name}"`);
  console.log(`Alabama in CFBD: "${alabamaCFBD}"`);

  // Ohio State
  const osuOdds = eventsTeams?.find(t => t.name.toLowerCase().includes('ohio state'));
  const osuCFBD = spTeamNames.find(n => n.toLowerCase().includes('ohio state'));
  console.log(`\nOhio State in Odds API: "${osuOdds?.name}"`);
  console.log(`Ohio State in CFBD: "${osuCFBD}"`);
}

main();
