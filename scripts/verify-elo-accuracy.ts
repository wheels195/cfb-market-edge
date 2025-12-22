/**
 * Verify Elo Accuracy - Compare Week 0 vs Week 16
 *
 * Checks if week 16 Elo is actually updated or defaulting to preseason.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  // Key bowl teams to check
  const teamNames = [
    'Ohio State', 'Texas', 'Penn State', 'Notre Dame', 'Georgia',
    'Oregon', 'Army', 'Indiana', 'Boise State', 'Arizona State',
    'Tennessee', 'Miami', 'Clemson', 'Michigan'
  ];

  console.log('=== Comparing Week 0 (Preseason) vs Week 16 Elo ===\n');
  console.log('Team                | Week 0 Elo | Week 16 Elo | Change');
  console.log('--------------------|------------|-------------|-------');

  for (const name of teamNames) {
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('name', name)
      .single();

    if (!team) {
      console.log(`${name.padEnd(20)}| NOT FOUND`);
      continue;
    }

    // Get week 0 (preseason) Elo
    const { data: week0 } = await supabase
      .from('team_elo_snapshots')
      .select('elo')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .eq('week', 0)
      .single();

    // Get week 16 Elo
    const { data: week16 } = await supabase
      .from('team_elo_snapshots')
      .select('elo')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .eq('week', 16)
      .single();

    const elo0 = week0?.elo;
    const elo16 = week16?.elo;

    if (elo0 === undefined || elo16 === undefined) {
      console.log(`${name.padEnd(20)}| ${elo0 ?? 'N/A'.padStart(10)} | ${elo16 ?? 'N/A'.padStart(11)} | MISSING`);
      continue;
    }

    const change = elo16 - elo0;
    const changeStr = change >= 0 ? `+${change}` : `${change}`;
    const isSame = elo0 === elo16 ? ' ⚠️ SAME!' : '';

    console.log(
      `${name.padEnd(20)}| ${String(elo0).padStart(10)} | ${String(elo16).padStart(11)} | ${changeStr}${isSame}`
    );
  }

  // Check if week 16 values are all identical (sign of bug)
  console.log('\n=== Week 16 Elo Diversity Check ===');

  const { data: week16All } = await supabase
    .from('team_elo_snapshots')
    .select('elo')
    .eq('season', 2025)
    .eq('week', 16)
    .limit(50);

  if (week16All) {
    const uniqueElos = new Set(week16All.map(e => e.elo));
    console.log(`Unique Elo values in 50-team sample: ${uniqueElos.size}`);
    console.log('If this is 1, all teams have same Elo (BUG!)');
    console.log('Min Elo:', Math.min(...week16All.map(e => e.elo)));
    console.log('Max Elo:', Math.max(...week16All.map(e => e.elo)));
  }

  // Check week 0 vs week 16 for exact matches
  console.log('\n=== Checking for Week 0 = Week 16 (Unchanged) ===');

  const { data: allWeek0 } = await supabase
    .from('team_elo_snapshots')
    .select('team_id, elo')
    .eq('season', 2025)
    .eq('week', 0);

  const { data: allWeek16 } = await supabase
    .from('team_elo_snapshots')
    .select('team_id, elo')
    .eq('season', 2025)
    .eq('week', 16);

  if (allWeek0 && allWeek16) {
    const week0Map = new Map(allWeek0.map(e => [e.team_id, e.elo]));
    let sameCount = 0;
    let diffCount = 0;

    for (const w16 of allWeek16) {
      const w0Elo = week0Map.get(w16.team_id);
      if (w0Elo === w16.elo) {
        sameCount++;
      } else {
        diffCount++;
      }
    }

    console.log(`Teams with SAME Elo (week 0 = week 16): ${sameCount}`);
    console.log(`Teams with DIFFERENT Elo: ${diffCount}`);

    if (sameCount > diffCount) {
      console.log('\n⚠️  WARNING: Most teams have unchanged Elo - possible bug!');
    } else {
      console.log('\n✅ Elo values are properly updated from preseason to week 16');
    }
  }
}

main().catch(console.error);
