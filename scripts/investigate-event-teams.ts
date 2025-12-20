/**
 * Investigate Event Teams
 *
 * Understand the relationship between:
 * - Team UUIDs used in events
 * - CFBD team IDs
 * - How Odds API names map to CFBD names
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

async function main() {
  console.log('=== Investigating Event Teams ===\n');

  // Get all unique team IDs used in events
  const { data: homeEvents } = await supabase.from('events').select('home_team_id');
  const { data: awayEvents } = await supabase.from('events').select('away_team_id');

  const eventTeamIds = new Set<string>();
  for (const e of homeEvents || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
  }
  for (const e of awayEvents || []) {
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  console.log(`Unique team IDs in events: ${eventTeamIds.size}`);

  // Get all teams used in events
  const { data: eventTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .in('id', [...eventTeamIds]);

  console.log(`Teams found in teams table: ${eventTeams?.length || 0}`);

  // Count how many have cfbd_team_id
  const withCfbdId = eventTeams?.filter(t => t.cfbd_team_id !== null) || [];
  const withoutCfbdId = eventTeams?.filter(t => t.cfbd_team_id === null) || [];

  console.log(`  With cfbd_team_id: ${withCfbdId.length}`);
  console.log(`  Without cfbd_team_id: ${withoutCfbdId.length}`);

  // Show sample of teams without cfbd_team_id
  console.log('\nSample teams WITHOUT cfbd_team_id (first 20):');
  for (const t of withoutCfbdId.slice(0, 20)) {
    console.log(`  "${t.name}" (${t.id.substring(0, 8)}...)`);
  }

  // Get CFBD FBS teams
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();
  console.log(`\nCFBD FBS teams: ${cfbdTeams.length}`);

  // Try to match teams without cfbd_team_id to CFBD teams
  console.log('\nAttempting to match teams to CFBD...');

  // Build CFBD name variations -> id
  const cfbdMatches = new Map<string, { id: number; school: string }>();
  for (const t of cfbdTeams) {
    // Various name forms
    const school = t.school.toLowerCase();
    cfbdMatches.set(school, { id: t.id, school: t.school });

    // With mascot
    if (t.mascot) {
      cfbdMatches.set(`${school} ${t.mascot.toLowerCase()}`, { id: t.id, school: t.school });
    }

    // Abbreviations
    if (t.abbreviation) {
      cfbdMatches.set(t.abbreviation.toLowerCase(), { id: t.id, school: t.school });
    }
  }

  // Try to match
  let matched = 0;
  let unmatched = 0;
  const unmatchedNames: string[] = [];
  const matchUpdates: Array<{ id: string; name: string; cfbd_team_id: number }> = [];

  for (const team of withoutCfbdId) {
    const name = team.name.toLowerCase();

    // Try various matching strategies
    const match =
      cfbdMatches.get(name) ||
      cfbdMatches.get(name.replace(' ', '')) ||
      cfbdMatches.get(name.replace('-', ' ')) ||
      cfbdMatches.get(name.split(' ')[0]); // First word only

    if (match) {
      matched++;
      matchUpdates.push({ id: team.id, name: team.name, cfbd_team_id: match.id });
    } else {
      unmatched++;
      unmatchedNames.push(team.name);
    }
  }

  console.log(`  Matched: ${matched}`);
  console.log(`  Unmatched: ${unmatched}`);

  if (unmatchedNames.length > 0 && unmatchedNames.length <= 30) {
    console.log('\nUnmatched team names:');
    for (const n of unmatchedNames) {
      console.log(`  "${n}"`);
    }
  }

  // Show what would be updated
  console.log('\nSample matches (first 20):');
  for (const m of matchUpdates.slice(0, 20)) {
    console.log(`  "${m.name}" → cfbd_team_id=${m.cfbd_team_id}`);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Event teams: ${eventTeamIds.size}`);
  console.log(`Already have cfbd_team_id: ${withCfbdId.length}`);
  console.log(`Can be matched to CFBD: ${matched}`);
  console.log(`Cannot match (likely FCS/non-FBS): ${unmatched}`);
  console.log(`\nPotential FBS coverage: ${((withCfbdId.length + matched) / eventTeamIds.size * 100).toFixed(1)}%`);
}

main().catch(console.error);
