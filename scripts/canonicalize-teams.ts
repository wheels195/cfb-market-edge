/**
 * Team Canonicalization Migration Script
 *
 * Creates ONE canonical team row per school with:
 * - cfbd_team_id (from CollegeFootballData)
 * - odds_api_name (from The Odds API)
 *
 * Merges duplicate records and re-points all foreign keys.
 *
 * Usage:
 *   npx tsx scripts/canonicalize-teams.ts --audit   # Show planned changes
 *   npx tsx scripts/canonicalize-teams.ts --apply   # Execute migration
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// ODDS API NAME -> CFBD NAME MAPPING
// This is the authoritative mapping for merging Odds API teams into CFBD teams
// =============================================================================
const ODDS_API_TO_CFBD_NAME: Record<string, string> = {
  'Alabama Crimson Tide': 'Alabama',
  'Appalachian State Mountaineers': 'App State',
  'Arizona State Sun Devils': 'Arizona State',
  'Arizona Wildcats': 'Arizona',
  'Army Black Knights': 'Army',
  'BYU Cougars': 'BYU',
  'California Golden Bears': 'California',
  'Central Michigan Chippewas': 'Central Michigan',
  'Cincinnati Bearcats': 'Cincinnati',
  'Clemson Tigers': 'Clemson',
  'Coastal Carolina Chanticleers': 'Coastal Carolina',
  'Duke Blue Devils': 'Duke',
  'East Carolina Pirates': 'East Carolina',
  'Florida International Panthers': 'Florida International',
  'Fresno State Bulldogs': 'Fresno State',
  'Georgia Bulldogs': 'Georgia',
  'Georgia Southern Eagles': 'Georgia Southern',
  'Georgia Tech Yellow Jackets': 'Georgia Tech',
  'Hawaii Rainbow Warriors': "Hawai'i",
  'Houston Cougars': 'Houston',
  'Illinois Fighting Illini': 'Illinois',
  'Indiana Hoosiers': 'Indiana',
  'Iowa Hawkeyes': 'Iowa',
  'James Madison Dukes': 'James Madison',
  'Louisiana Tech Bulldogs': 'Louisiana Tech',
  'Louisville Cardinals': 'Louisville',
  'LSU Tigers': 'LSU',
  'Miami (OH) RedHawks': 'Miami (OH)',
  'Miami Hurricanes': 'Miami',
  'Michigan Wolverines': 'Michigan',
  'Minnesota Golden Gophers': 'Minnesota',
  'Mississippi State Bulldogs': 'Mississippi State',
  'Missouri Tigers': 'Missouri',
  'Navy Midshipmen': 'Navy',
  'Nebraska Cornhuskers': 'Nebraska',
  'New Mexico Lobos': 'New Mexico',
  'North Texas Mean Green': 'North Texas',
  'Northwestern Wildcats': 'Northwestern',
  'Ohio Bobcats': 'Ohio',
  'Ohio State Buckeyes': 'Ohio State',
  'Ole Miss Rebels': 'Ole Miss',
  'Oregon Ducks': 'Oregon',
  'Penn State Nittany Lions': 'Penn State',
  'Pittsburgh Panthers': 'Pittsburgh',
  'Rice Owls': 'Rice',
  'San Diego State Aztecs': 'San Diego State',
  'SMU Mustangs': 'SMU',
  'Southern Mississippi Golden Eagles': 'Southern Miss',
  'TCU Horned Frogs': 'TCU',
  'Tennessee Volunteers': 'Tennessee',
  'Texas A&M Aggies': 'Texas A&M',
  'Texas Longhorns': 'Texas',
  'Texas State Bobcats': 'Texas State',
  'Texas Tech Red Raiders': 'Texas Tech',
  'Toledo Rockets': 'Toledo',
  'Tulane Green Wave': 'Tulane',
  'UConn Huskies': 'UConn',
  'UNLV Rebels': 'UNLV',
  'USC Trojans': 'USC',
  'Utah State Aggies': 'Utah State',
  'Utah Utes': 'Utah',
  'UTSA Roadrunners': 'UTSA',
  'Vanderbilt Commodores': 'Vanderbilt',
  'Virginia Cavaliers': 'Virginia',
  'Wake Forest Demon Deacons': 'Wake Forest',
  'Washington State Cougars': 'Washington State',
  'Western Kentucky Hilltoppers': 'Western Kentucky',
};

interface Team {
  id: string;
  name: string;
  cfbd_team_id: string | null;
  odds_api_name: string | null;
}

interface MergeAction {
  type: 'odds_api_to_cfbd' | 'cfbd_duplicate';
  sourceTeam: Team;
  targetTeam: Team;
  eventsHomeCount: number;
  eventsAwayCount: number;
}

// =============================================================================
// AUDIT MODE
// =============================================================================
async function audit(): Promise<{ actions: MergeAction[]; unmapped: Team[] }> {
  console.log('═'.repeat(70));
  console.log(' AUDIT MODE - No changes will be made');
  console.log('═'.repeat(70));

  // Get all teams
  const { data: allTeams, error } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id, odds_api_name');

  if (error) {
    console.error('Error fetching teams:', error);
    return { actions: [], unmapped: [] };
  }

  // Categorize teams
  const cfbdTeams = allTeams?.filter(t => t.cfbd_team_id) || [];
  const oddsApiOnlyTeams = allTeams?.filter(t => t.odds_api_name && !t.cfbd_team_id) || [];

  console.log(`\n[1] TEAM INVENTORY`);
  console.log(`    Total teams: ${allTeams?.length}`);
  console.log(`    CFBD teams (have cfbd_team_id): ${cfbdTeams.length}`);
  console.log(`    Odds API only (no cfbd_team_id): ${oddsApiOnlyTeams.length}`);

  // Build CFBD name -> team lookup (case insensitive)
  const cfbdByName = new Map<string, Team>();
  for (const team of cfbdTeams) {
    cfbdByName.set(team.name.toLowerCase(), team);
  }

  // Also build by cfbd_team_id for duplicate detection
  const cfbdById = new Map<string, Team[]>();
  for (const team of cfbdTeams) {
    if (!team.cfbd_team_id) continue;
    if (!cfbdById.has(team.cfbd_team_id)) cfbdById.set(team.cfbd_team_id, []);
    cfbdById.get(team.cfbd_team_id)!.push(team);
  }

  const actions: MergeAction[] = [];
  const unmapped: Team[] = [];

  // 1. Find Odds API teams that need merging into CFBD teams
  console.log(`\n[2] ODDS API -> CFBD MERGE CANDIDATES`);

  for (const oddsTeam of oddsApiOnlyTeams) {
    const cfbdName = ODDS_API_TO_CFBD_NAME[oddsTeam.name];

    if (!cfbdName) {
      unmapped.push(oddsTeam);
      continue;
    }

    const cfbdTeam = cfbdByName.get(cfbdName.toLowerCase());

    if (!cfbdTeam) {
      console.log(`    WARNING: No CFBD match for "${oddsTeam.name}" -> "${cfbdName}"`);
      unmapped.push(oddsTeam);
      continue;
    }

    // Count affected events
    const { count: homeCount } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('home_team_id', oddsTeam.id);

    const { count: awayCount } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('away_team_id', oddsTeam.id);

    actions.push({
      type: 'odds_api_to_cfbd',
      sourceTeam: oddsTeam,
      targetTeam: cfbdTeam,
      eventsHomeCount: homeCount || 0,
      eventsAwayCount: awayCount || 0,
    });

    console.log(`    "${oddsTeam.name}" -> "${cfbdTeam.name}" (${(homeCount || 0) + (awayCount || 0)} events)`);
  }

  // 2. Find CFBD duplicates (same cfbd_team_id, multiple rows)
  console.log(`\n[3] CFBD DUPLICATE DETECTION`);

  for (const [cfbdId, teams] of cfbdById) {
    if (teams.length <= 1) continue;

    // Sort by name, first one is canonical
    teams.sort((a, b) => a.name.localeCompare(b.name));
    const canonical = teams[0];

    for (const duplicate of teams.slice(1)) {
      const { count: homeCount } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('home_team_id', duplicate.id);

      const { count: awayCount } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('away_team_id', duplicate.id);

      actions.push({
        type: 'cfbd_duplicate',
        sourceTeam: duplicate,
        targetTeam: canonical,
        eventsHomeCount: homeCount || 0,
        eventsAwayCount: awayCount || 0,
      });

      console.log(`    DUPLICATE cfbd_id=${cfbdId}: "${duplicate.name}" -> "${canonical.name}"`);
    }
  }

  // Summary
  const oddsApiMerges = actions.filter(a => a.type === 'odds_api_to_cfbd');
  const cfbdDuplicates = actions.filter(a => a.type === 'cfbd_duplicate');
  const totalEvents = actions.reduce((sum, a) => sum + a.eventsHomeCount + a.eventsAwayCount, 0);

  console.log(`\n[4] SUMMARY`);
  console.log(`    Odds API teams to merge: ${oddsApiMerges.length}`);
  console.log(`    CFBD duplicates to merge: ${cfbdDuplicates.length}`);
  console.log(`    Total events to re-point: ${totalEvents}`);
  console.log(`    Teams to delete: ${actions.length}`);

  if (unmapped.length > 0) {
    console.log(`\n[5] UNMAPPED TEAMS (need manual mapping or are non-FBS)`);
    for (const t of unmapped) {
      console.log(`    "${t.name}"`);
    }
  }

  // Check post-merge Elo coverage
  console.log(`\n[6] POST-MERGE ELO COVERAGE CHECK`);

  const targetTeamIds = [...new Set(actions.map(a => a.targetTeam.id))];
  const { data: eloCheck } = await supabase
    .from('team_elo_snapshots')
    .select('team_id')
    .in('team_id', targetTeamIds);

  const teamsWithElo = new Set(eloCheck?.map(e => e.team_id) || []);

  let withElo = 0;
  let withoutElo = 0;

  for (const action of actions.filter(a => a.type === 'odds_api_to_cfbd')) {
    if (teamsWithElo.has(action.targetTeam.id)) {
      withElo++;
    } else {
      withoutElo++;
      console.log(`    WARNING: "${action.targetTeam.name}" has no Elo data`);
    }
  }

  console.log(`\n    Target teams with Elo: ${withElo}`);
  console.log(`    Target teams without Elo: ${withoutElo}`);

  return { actions, unmapped };
}

// =============================================================================
// APPLY MODE
// =============================================================================
async function apply(actions: MergeAction[]): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log(' APPLYING MIGRATION');
  console.log('═'.repeat(70));

  let successCount = 0;
  let errorCount = 0;

  for (const action of actions) {
    const { sourceTeam, targetTeam } = action;
    console.log(`\nProcessing: "${sourceTeam.name}" -> "${targetTeam.name}"...`);

    try {
      // 1. Update events.home_team_id
      if (action.eventsHomeCount > 0) {
        const { error } = await supabase
          .from('events')
          .update({ home_team_id: targetTeam.id })
          .eq('home_team_id', sourceTeam.id);

        if (error) throw new Error(`home_team_id: ${error.message}`);
        console.log(`    Updated ${action.eventsHomeCount} home_team_id refs`);
      }

      // 2. Update events.away_team_id
      if (action.eventsAwayCount > 0) {
        const { error } = await supabase
          .from('events')
          .update({ away_team_id: targetTeam.id })
          .eq('away_team_id', sourceTeam.id);

        if (error) throw new Error(`away_team_id: ${error.message}`);
        console.log(`    Updated ${action.eventsAwayCount} away_team_id refs`);
      }

      // 3. If Odds API merge, update canonical team with odds_api_name
      if (action.type === 'odds_api_to_cfbd' && sourceTeam.odds_api_name) {
        const { error } = await supabase
          .from('teams')
          .update({ odds_api_name: sourceTeam.odds_api_name })
          .eq('id', targetTeam.id);

        if (error) throw new Error(`odds_api_name: ${error.message}`);
        console.log(`    Set odds_api_name="${sourceTeam.odds_api_name}" on canonical`);
      }

      // 4. Delete the source team
      const { error: deleteError } = await supabase
        .from('teams')
        .delete()
        .eq('id', sourceTeam.id);

      if (deleteError) throw new Error(`delete: ${deleteError.message}`);
      console.log(`    Deleted source team`);

      console.log(`    ✓ SUCCESS`);
      successCount++;

    } catch (err) {
      console.error(`    ✗ ERROR: ${err}`);
      errorCount++;
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(` MIGRATION COMPLETE`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`    Success: ${successCount}`);
  console.log(`    Errors: ${errorCount}`);
}

// =============================================================================
// VERIFICATION
// =============================================================================
async function verify(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log(' POST-MIGRATION VERIFICATION');
  console.log('═'.repeat(70));

  // 1. Check for remaining Odds API only teams
  const { data: oddsApiOnly, count: oddsApiCount } = await supabase
    .from('teams')
    .select('name', { count: 'exact' })
    .not('odds_api_name', 'is', null)
    .is('cfbd_team_id', null);

  console.log(`\n[1] Remaining Odds API only teams: ${oddsApiCount || 0}`);
  if (oddsApiOnly && oddsApiOnly.length > 0) {
    oddsApiOnly.slice(0, 10).forEach(t => console.log(`    - ${t.name}`));
    if (oddsApiOnly.length > 10) console.log(`    ... and ${oddsApiOnly.length - 10} more`);
  }

  // 2. Check Elo coverage for upcoming events
  const now = new Date().toISOString();
  const { data: upcomingEvents } = await supabase
    .from('events')
    .select('home_team_id, away_team_id, home_team:home_team_id(name), away_team:away_team_id(name)')
    .gte('commence_time', now)
    .limit(50);

  const teamIds = new Set<string>();
  upcomingEvents?.forEach(e => {
    teamIds.add(e.home_team_id);
    teamIds.add(e.away_team_id);
  });

  const { data: eloData } = await supabase
    .from('team_elo_snapshots')
    .select('team_id')
    .in('team_id', [...teamIds]);

  const teamsWithElo = new Set(eloData?.map(e => e.team_id) || []);
  const teamsWithoutElo = [...teamIds].filter(id => !teamsWithElo.has(id));

  console.log(`\n[2] Upcoming events Elo coverage`);
  console.log(`    Teams in upcoming events: ${teamIds.size}`);
  console.log(`    Teams WITH Elo: ${teamsWithElo.size}`);
  console.log(`    Teams WITHOUT Elo: ${teamsWithoutElo.length}`);

  if (teamsWithoutElo.length > 0) {
    console.log(`\n    Teams still missing Elo:`);
    for (const teamId of teamsWithoutElo) {
      const event = upcomingEvents?.find(e => e.home_team_id === teamId || e.away_team_id === teamId);
      const team = event?.home_team_id === teamId ? event?.home_team : event?.away_team;
      console.log(`    - ${(team as any)?.name || teamId}`);
    }
  }

  // 3. Check for orphaned events
  const { data: allTeamIds } = await supabase
    .from('teams')
    .select('id');

  const validTeamIds = new Set(allTeamIds?.map(t => t.id) || []);

  const { data: allEvents } = await supabase
    .from('events')
    .select('id, home_team_id, away_team_id');

  let orphanedEvents = 0;
  for (const e of allEvents || []) {
    if (!validTeamIds.has(e.home_team_id) || !validTeamIds.has(e.away_team_id)) {
      orphanedEvents++;
    }
  }

  console.log(`\n[3] Orphaned events check`);
  console.log(`    Events with invalid team refs: ${orphanedEvents}`);

  // Final status
  const allGood = (oddsApiCount || 0) === 0 && teamsWithoutElo.length === 0 && orphanedEvents === 0;

  console.log(`\n${'═'.repeat(70)}`);
  if (allGood) {
    console.log(' ✓ ALL CHECKS PASSED');
  } else {
    console.log(' ✗ SOME CHECKS FAILED - Review above');
  }
  console.log('═'.repeat(70));
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  const mode = process.argv[2];

  if (mode !== '--audit' && mode !== '--apply') {
    console.log('Team Canonicalization Script');
    console.log('');
    console.log('Usage:');
    console.log('  npx tsx scripts/canonicalize-teams.ts --audit   # Show planned changes');
    console.log('  npx tsx scripts/canonicalize-teams.ts --apply   # Execute migration');
    console.log('');
    console.log('Required env vars: SUPABASE_URL, SUPABASE_ANON_KEY');
    process.exit(1);
  }

  const { actions, unmapped } = await audit();

  if (mode === '--apply') {
    if (actions.length === 0) {
      console.log('\nNo teams to merge. Database is already canonical.');
      return;
    }

    console.log(`\n⚠️  About to merge ${actions.length} teams...`);
    console.log('    Press Ctrl+C within 5 seconds to cancel.\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    await apply(actions);
    await verify();
  } else {
    console.log('\nTo apply these changes, run:');
    console.log('  npx tsx scripts/canonicalize-teams.ts --apply\n');
  }
}

main().catch(console.error);
