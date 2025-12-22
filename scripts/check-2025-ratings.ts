/**
 * Check 2025 ratings data used by T-60 model
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  // Get ALL distinct weeks for 2025 Elo
  const { data: allElos } = await supabase
    .from('team_elo_snapshots')
    .select('week')
    .eq('season', 2025);

  const uniqueWeeks = [...new Set(allElos?.map(w => w.week))].sort((a, b) => a - b);
  console.log('=== 2025 Elo Weeks Available ===');
  console.log('All weeks:', uniqueWeeks.join(', '));
  console.log('Latest week:', Math.max(...uniqueWeeks));
  console.log('Total Elo entries:', allElos?.length);

  // Count teams per week
  const weekCounts: Record<number, number> = {};
  allElos?.forEach(e => {
    weekCounts[e.week] = (weekCounts[e.week] || 0) + 1;
  });
  console.log('\nTeams per week (last 5):');
  for (const w of uniqueWeeks.slice(-5)) {
    console.log(`  Week ${w}: ${weekCounts[w]} teams`);
  }

  // Check sample bowl teams
  const bowlTeams = ['Ohio State', 'Texas', 'Penn State', 'Notre Dame', 'Georgia', 'Army', 'Northwestern', 'Clemson', 'Michigan'];

  console.log('\n=== Sample Bowl Team 2025 Ratings ===');
  console.log('Team                | Elo (wk) | SP+    | Off PPA | Def PPA');
  console.log('--------------------|----------|--------|---------|--------');

  for (const teamName of bowlTeams) {
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('name', teamName)
      .single();

    if (!team) continue;

    const { data: elo } = await supabase
      .from('team_elo_snapshots')
      .select('week, elo')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .order('week', { ascending: false })
      .limit(1)
      .single();

    const { data: ratings } = await supabase
      .from('advanced_team_ratings')
      .select('sp_overall, off_ppa, def_ppa')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .single();

    const eloStr = elo?.elo?.toString() || 'N/A';
    const weekStr = elo?.week?.toString() || '?';
    const spStr = ratings?.sp_overall?.toFixed(1) || 'N/A';
    const offPPAStr = ratings?.off_ppa?.toFixed(3) || 'N/A';
    const defPPAStr = ratings?.def_ppa?.toFixed(3) || 'N/A';

    console.log(
      `${teamName.padEnd(20)}| ${eloStr.padStart(5)} (${weekStr.padStart(2)}) | ${spStr.padStart(6)} | ${offPPAStr.padStart(7)} | ${defPPAStr.padStart(7)}`
    );
  }

  console.log('\n=== Data Sources for T-60 Model ===');
  console.log('1. Elo: Latest week snapshot for 2025 (currently week ' + Math.max(...uniqueWeeks) + ')');
  console.log('2. SP+: Season-level 2025 ratings from CFBD API');
  console.log('3. PPA: Season-level 2025 ratings from CFBD API');
}

main().catch(console.error);
