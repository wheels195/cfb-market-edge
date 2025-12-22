import { createClient } from '@supabase/supabase-js';
import { getCanonicalTeamName } from '../src/lib/team-aliases';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// All bowl teams from the Odds API
const BOWL_TEAMS = [
  'Utah State', 'Washington State', 'Louisville', 'Toledo',
  'Southern Mississippi', 'Western Kentucky', 'Ohio', 'UNLV',
  'California', 'Hawaii', 'Northwestern', 'Central Michigan',
  'Minnesota', 'New Mexico', 'UTSA', 'FIU', 'Pittsburgh',
  'East Carolina', 'Penn State', 'Clemson', 'UConn', 'Army',
  'Georgia Tech', 'BYU', 'Fresno State', 'Miami (OH)',
  'North Texas', 'San Diego State', 'Missouri', 'Virginia',
  'Texas', 'Arizona State', 'Notre Dame', 'Georgia', 'Ohio State',
  'Tennessee', 'Boise State', 'SMU', 'Alabama', 'Ole Miss',
  'South Carolina', 'Illinois', 'Indiana', 'Colorado',
];

async function main() {
  console.log('=== Bowl Team Data Coverage (2025) ===\n');

  const missing: string[] = [];
  const incomplete: string[] = [];
  const complete: string[] = [];

  for (const teamName of BOWL_TEAMS) {
    // Get canonical name (Odds API → DB mapping)
    const canonicalName = getCanonicalTeamName(teamName);

    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('name', canonicalName)
      .single();

    if (!team) {
      missing.push(`${teamName} (→ ${canonicalName}) - NOT IN TEAMS TABLE`);
      continue;
    }

    // Check Elo (should have week > 10 for bowl season)
    const { data: elo } = await supabase
      .from('team_elo_snapshots')
      .select('elo, week')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .order('week', { ascending: false })
      .limit(1)
      .single();

    // Check SP+
    const { data: ratings } = await supabase
      .from('advanced_team_ratings')
      .select('sp_overall, off_ppa')
      .eq('team_id', team.id)
      .eq('season', 2025)
      .single();

    const hasElo = elo && elo.week >= 10;
    const hasSP = ratings && ratings.sp_overall !== null && ratings.sp_overall !== 0;
    const hasPPA = ratings && ratings.off_ppa !== null && ratings.off_ppa !== 0;

    if (hasElo && hasSP && hasPPA) {
      complete.push(teamName);
    } else {
      const issues: string[] = [];
      if (!hasElo) issues.push(`Elo=${elo?.elo || 'N/A'} wk${elo?.week || 0}`);
      if (!hasSP) issues.push(`SP+=${ratings?.sp_overall || 'N/A'}`);
      if (!hasPPA) issues.push(`PPA=${ratings?.off_ppa || 'N/A'}`);
      incomplete.push(`${teamName}: ${issues.join(', ')}`);
    }
  }

  console.log(`COMPLETE (${complete.length}): ${complete.join(', ')}\n`);

  console.log(`INCOMPLETE (${incomplete.length}):`);
  for (const team of incomplete) {
    console.log(`  ${team}`);
  }

  if (missing.length > 0) {
    console.log(`\nMISSING FROM DB (${missing.length}):`);
    for (const team of missing) {
      console.log(`  ${team}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Complete: ${complete.length}/${BOWL_TEAMS.length}`);
  console.log(`Incomplete: ${incomplete.length}/${BOWL_TEAMS.length}`);
  console.log(`Missing: ${missing.length}/${BOWL_TEAMS.length}`);
}

main().catch(console.error);
