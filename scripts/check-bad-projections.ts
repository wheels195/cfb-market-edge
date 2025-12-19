import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Checking why projections are off...\n');

  // Check Air Force's rating
  const { data: airforce } = await supabase
    .from('teams')
    .select('id, name')
    .ilike('name', '%air force%')
    .single();

  console.log('Air Force team:', airforce);

  if (airforce) {
    const { data: rating } = await supabase
      .from('team_ratings_history')
      .select('*')
      .eq('team_id', airforce.id)
      .eq('season', 2023)
      .eq('week', 0);

    console.log('\nAir Force 2023 preseason rating:', rating);
  }

  // Check Robert Morris (likely has no rating)
  const { data: rm } = await supabase
    .from('teams')
    .select('id, name')
    .ilike('name', '%robert morris%');

  console.log('\nRobert Morris teams:', rm);

  // Check what teams have no game data
  const { data: teamsWithGames } = await supabase
    .from('game_advanced_stats')
    .select('team_id')
    .eq('season', 2023);

  const teamsWithGameSet = new Set((teamsWithGames || []).map(t => t.team_id));

  // Check a few FCS teams
  const fcsTeams = ['Long Island', 'Delaware State', 'Merrimack', 'Bucknell', 'Campbell'];
  for (const name of fcsTeams) {
    const { data: team } = await supabase
      .from('teams')
      .select('id, name')
      .ilike('name', `%${name}%`);

    for (const t of team || []) {
      const hasGames = teamsWithGameSet.has(t.id);
      console.log(`\n${t.name}: ${hasGames ? 'HAS game data' : 'NO game data'}`);

      // Get their rating
      const { data: rating } = await supabase
        .from('team_ratings_history')
        .select('overall_rating')
        .eq('team_id', t.id)
        .eq('season', 2023)
        .eq('week', 0)
        .single();

      console.log(`  Preseason rating: ${rating?.overall_rating || 'N/A'}`);
    }
  }

  // Count teams with game data vs without
  const { count: totalTeams } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal teams: ${totalTeams}`);
  console.log(`Teams with 2023 game data: ${teamsWithGameSet.size}`);
}

main().catch(console.error);
