import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== 2025 Data Check ===\n');

  // Elo by week for 2025
  const { data: eloWeeks } = await supabase
    .from('team_elo_snapshots')
    .select('week')
    .eq('season', 2025);

  const weekCounts: Record<number, number> = {};
  for (const row of eloWeeks || []) {
    weekCounts[row.week] = (weekCounts[row.week] || 0) + 1;
  }
  console.log('Elo snapshots by week (2025):');
  for (const week of Object.keys(weekCounts).map(Number).sort((a, b) => a - b)) {
    console.log(`  Week ${week}: ${weekCounts[week]} teams`);
  }

  // SP+ for 2025
  const { data: sp2025, count: spCount } = await supabase
    .from('advanced_team_ratings')
    .select('*', { count: 'exact' })
    .eq('season', 2025)
    .not('sp_overall', 'is', null)
    .limit(5);

  console.log(`\nSP+ ratings for 2025: ${spCount}`);
  if (sp2025 && sp2025.length > 0) {
    console.log('Sample:', sp2025[0].sp_overall, sp2025[0].last_updated);
  }

  // PPA for 2025
  const { count: ppaCount } = await supabase
    .from('advanced_team_ratings')
    .select('*', { count: 'exact', head: true })
    .eq('season', 2025)
    .not('off_ppa', 'is', null);

  console.log(`PPA ratings for 2025: ${ppaCount}`);

  // Check specific teams for today's game
  console.log('\n--- Today\'s Game Teams ---');
  const testTeams = ['Utah State', 'Washington State'];

  for (const teamName of testTeams) {
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('name', teamName)
      .single();

    if (!team) {
      console.log(`${teamName}: NOT FOUND`);
      continue;
    }

    const { data: elo } = await supabase
      .from('team_elo_snapshots')
      .select('elo, week, fetched_at')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .order('week', { ascending: false })
      .limit(1)
      .single();

    const { data: ratings } = await supabase
      .from('advanced_team_ratings')
      .select('sp_overall, off_ppa, def_ppa, last_updated')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .single();

    console.log(`\n${teamName}:`);
    console.log(`  Elo: ${elo?.elo || 'N/A'} (week ${elo?.week || 'N/A'}, fetched ${elo?.fetched_at || 'N/A'})`);
    console.log(`  SP+: ${ratings?.sp_overall || 'N/A'} (updated ${ratings?.last_updated || 'N/A'})`);
    console.log(`  PPA: off=${ratings?.off_ppa?.toFixed(3) || 'N/A'} def=${ratings?.def_ppa?.toFixed(3) || 'N/A'}`);
  }
}

main().catch(console.error);
