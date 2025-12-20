/**
 * Canonicalize Teams - Fix Team UUID Mapping
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/canonicalize-teams.ts   # Audit only (default)
 *   DRY_RUN=false npx tsx scripts/canonicalize-teams.ts  # Apply changes
 *
 * This script:
 * 1. Creates one canonical UUID per cfbd_team_id
 * 2. Updates all events to use canonical UUIDs
 * 3. Truncates and re-syncs Elo/Stats using cfbd_team_id as sole join key
 * 4. Adds DB constraint for unique cfbd_team_id
 * 5. Outputs final coverage stats
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';
const DRY_RUN = process.env.DRY_RUN !== 'false';

// ============================================================================
// SECTION 1: AUDIT
// ============================================================================

interface AuditResult {
  teamsTotal: number;
  teamsWithCfbdId: number;
  duplicateCfbdIds: Array<{ cfbdId: number; count: number; teams: Array<{ id: string; name: string }> }>;
  canonicalTeams: number;
  teamsToDelete: number;
  eventsToRepoint: number;
  eloRowsToDelete: number;
  statsRowsToDelete: number;
  fbsTeamsInCfbd: number;
  fbsTeamsInEvents: number;
}

async function runAudit(): Promise<AuditResult> {
  console.log('═'.repeat(70));
  console.log('AUDIT MODE - No changes will be made');
  console.log('═'.repeat(70));

  // Get all teams
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id');

  const teamsTotal = allTeams?.length || 0;
  const teamsWithCfbdId = allTeams?.filter(t => t.cfbd_team_id !== null).length || 0;

  console.log(`\n[1] TEAMS TABLE`);
  console.log(`    Total teams: ${teamsTotal}`);
  console.log(`    With cfbd_team_id: ${teamsWithCfbdId}`);
  console.log(`    Without cfbd_team_id: ${teamsTotal - teamsWithCfbdId}`);

  // Find duplicate cfbd_team_ids
  const byCfbdId = new Map<number, Array<{ id: string; name: string }>>();
  for (const t of allTeams || []) {
    if (t.cfbd_team_id === null) continue;
    const cfbdId = parseInt(t.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;
    if (!byCfbdId.has(cfbdId)) byCfbdId.set(cfbdId, []);
    byCfbdId.get(cfbdId)!.push({ id: t.id, name: t.name });
  }

  const duplicateCfbdIds: AuditResult['duplicateCfbdIds'] = [];
  for (const [cfbdId, teams] of byCfbdId) {
    if (teams.length > 1) {
      duplicateCfbdIds.push({ cfbdId, count: teams.length, teams });
    }
  }

  console.log(`\n[2] DUPLICATE cfbd_team_id ENTRIES`);
  console.log(`    Duplicate cfbd_team_ids: ${duplicateCfbdIds.length}`);
  if (duplicateCfbdIds.length > 0) {
    console.log(`    Sample duplicates:`);
    for (const dup of duplicateCfbdIds.slice(0, 5)) {
      console.log(`      cfbd_id=${dup.cfbdId}: ${dup.teams.map(t => `"${t.name}"`).join(', ')}`);
    }
    if (duplicateCfbdIds.length > 5) {
      console.log(`      ... and ${duplicateCfbdIds.length - 5} more`);
    }
  }

  // Count canonical teams (unique cfbd_team_ids)
  const canonicalTeams = byCfbdId.size;
  const teamsToDelete = teamsWithCfbdId - canonicalTeams;

  console.log(`\n[3] CANONICALIZATION PLAN`);
  console.log(`    Canonical teams (unique cfbd_team_id): ${canonicalTeams}`);
  console.log(`    Teams to delete (duplicates): ${teamsToDelete}`);

  // Get events and count re-pointing needed
  const { data: events } = await supabase
    .from('events')
    .select('id, home_team_id, away_team_id');

  // For each duplicate set, pick canonical UUID (first alphabetically by name for consistency)
  const aliasToCanonical = new Map<string, string>();
  for (const [cfbdId, teams] of byCfbdId) {
    if (teams.length <= 1) continue;
    teams.sort((a, b) => a.name.localeCompare(b.name));
    const canonicalId = teams[0].id;
    for (const t of teams.slice(1)) {
      aliasToCanonical.set(t.id, canonicalId);
    }
  }

  let eventsToRepoint = 0;
  for (const e of events || []) {
    if (aliasToCanonical.has(e.home_team_id) || aliasToCanonical.has(e.away_team_id)) {
      eventsToRepoint++;
    }
  }

  console.log(`\n[4] EVENTS TABLE`);
  console.log(`    Total events: ${events?.length || 0}`);
  console.log(`    Events to re-point: ${eventsToRepoint}`);

  // Count Elo and Stats rows
  const { count: eloCount } = await supabase
    .from('team_elo_snapshots')
    .select('*', { count: 'exact', head: true });

  const { count: statsCount } = await supabase
    .from('team_stats_snapshots')
    .select('*', { count: 'exact', head: true });

  console.log(`\n[5] SNAPSHOT TABLES (to be truncated and re-synced)`);
  console.log(`    Elo snapshots: ${eloCount || 0}`);
  console.log(`    Stats snapshots: ${statsCount || 0}`);

  // Get FBS teams from CFBD
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdFbsTeams = await res.json();
  const fbsCfbdIds = new Set<number>(cfbdFbsTeams.map((t: any) => t.id));

  // Count FBS teams in our events
  const eventTeamIds = new Set<string>();
  for (const e of events || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  let fbsTeamsInEvents = 0;
  for (const teamId of eventTeamIds) {
    const team = allTeams?.find(t => t.id === teamId);
    if (team?.cfbd_team_id) {
      const cfbdId = parseInt(team.cfbd_team_id, 10);
      if (fbsCfbdIds.has(cfbdId)) {
        fbsTeamsInEvents++;
      }
    }
  }

  console.log(`\n[6] FBS COVERAGE`);
  console.log(`    FBS teams in CFBD: ${cfbdFbsTeams.length}`);
  console.log(`    FBS teams in our events: ${fbsTeamsInEvents}`);

  return {
    teamsTotal,
    teamsWithCfbdId,
    duplicateCfbdIds,
    canonicalTeams,
    teamsToDelete,
    eventsToRepoint,
    eloRowsToDelete: eloCount || 0,
    statsRowsToDelete: statsCount || 0,
    fbsTeamsInCfbd: cfbdFbsTeams.length,
    fbsTeamsInEvents,
  };
}

// ============================================================================
// SECTION 2: APPLY CHANGES
// ============================================================================

async function applyChanges() {
  console.log('\n' + '═'.repeat(70));
  console.log('APPLY MODE - Making changes');
  console.log('═'.repeat(70));

  // Step 1: Build canonical mapping
  console.log('\n[1] Building canonical UUID mapping...');

  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id');

  const byCfbdId = new Map<number, Array<{ id: string; name: string }>>();
  for (const t of allTeams || []) {
    if (t.cfbd_team_id === null) continue;
    const cfbdId = parseInt(t.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;
    if (!byCfbdId.has(cfbdId)) byCfbdId.set(cfbdId, []);
    byCfbdId.get(cfbdId)!.push({ id: t.id, name: t.name });
  }

  // Pick canonical: alphabetically first by name
  const cfbdIdToCanonical = new Map<number, string>();
  const aliasToCanonical = new Map<string, string>();
  const aliasIds: string[] = [];

  for (const [cfbdId, teams] of byCfbdId) {
    teams.sort((a, b) => a.name.localeCompare(b.name));
    const canonicalId = teams[0].id;
    cfbdIdToCanonical.set(cfbdId, canonicalId);
    for (const t of teams.slice(1)) {
      aliasToCanonical.set(t.id, canonicalId);
      aliasIds.push(t.id);
    }
  }

  console.log(`    Canonical mappings: ${cfbdIdToCanonical.size}`);
  console.log(`    Alias UUIDs to merge: ${aliasIds.length}`);

  // Step 2: Update events
  console.log('\n[2] Updating events...');
  let eventsUpdated = 0;

  for (const [aliasId, canonicalId] of aliasToCanonical) {
    // Update home_team_id
    const { data: homeUpdated } = await supabase
      .from('events')
      .update({ home_team_id: canonicalId })
      .eq('home_team_id', aliasId)
      .select('id');
    eventsUpdated += homeUpdated?.length || 0;

    // Update away_team_id
    const { data: awayUpdated } = await supabase
      .from('events')
      .update({ away_team_id: canonicalId })
      .eq('away_team_id', aliasId)
      .select('id');
    eventsUpdated += awayUpdated?.length || 0;
  }

  console.log(`    Events updated: ${eventsUpdated}`);

  // Step 3: Truncate Elo and Stats
  console.log('\n[3] Truncating snapshot tables...');

  await supabase.from('team_elo_snapshots').delete().gte('id', '00000000-0000-0000-0000-000000000000');
  console.log(`    Elo snapshots: truncated`);

  await supabase.from('team_stats_snapshots').delete().gte('id', '00000000-0000-0000-0000-000000000000');
  console.log(`    Stats snapshots: truncated`);

  // Step 4: Delete alias teams
  console.log('\n[4] Deleting alias teams...');
  let teamsDeleted = 0;

  for (const aliasId of aliasIds) {
    const { error } = await supabase.from('teams').delete().eq('id', aliasId);
    if (!error) teamsDeleted++;
  }

  console.log(`    Teams deleted: ${teamsDeleted}`);

  // Step 5: Get FBS mapping for syncs
  console.log('\n[5] Building FBS sync mapping...');

  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdFbsTeams = await res.json();

  // Build cfbd school name -> cfbd_id
  const schoolToCfbdId = new Map<string, number>();
  for (const t of cfbdFbsTeams) {
    schoolToCfbdId.set(t.school.toLowerCase(), t.id);
  }

  console.log(`    FBS teams: ${cfbdFbsTeams.length}`);
  console.log(`    Canonical UUIDs available: ${cfbdIdToCanonical.size}`);

  // Step 6: Sync Elo for 2022-2024
  console.log('\n[6] Syncing Elo snapshots...');

  for (const season of [2022, 2023, 2024]) {
    let seasonTotal = 0;
    for (let week = 0; week <= 16; week++) {
      try {
        const eloRes = await fetch(
          `https://api.collegefootballdata.com/ratings/elo?year=${season}&week=${week}`,
          { headers: { 'Authorization': `Bearer ${API_KEY}` } }
        );
        if (!eloRes.ok) continue;

        const eloData = await eloRes.json();
        if (!eloData || eloData.length === 0) continue;

        const records: Array<{
          team_id: string;
          season: number;
          week: number;
          elo: number;
          source: string;
        }> = [];

        for (const entry of eloData) {
          const cfbdId = schoolToCfbdId.get(entry.team.toLowerCase());
          if (cfbdId === undefined) continue;

          const teamUuid = cfbdIdToCanonical.get(cfbdId);
          if (!teamUuid) continue;

          records.push({
            team_id: teamUuid,
            season,
            week,
            elo: entry.elo,
            source: 'cfbd',
          });
        }

        if (records.length > 0) {
          await supabase
            .from('team_elo_snapshots')
            .upsert(records, { onConflict: 'team_id,season,week' });
          seasonTotal += records.length;
        }
      } catch (err) {
        // Week doesn't exist
      }
    }
    console.log(`    ${season}: ${seasonTotal} Elo records`);
  }

  // Step 7: Sync PPA for 2022-2024
  console.log('\n[7] Syncing PPA stats...');

  for (const season of [2022, 2023, 2024]) {
    try {
      const ppaRes = await fetch(
        `https://api.collegefootballdata.com/ppa/games?year=${season}&excludeGarbageTime=true`,
        { headers: { 'Authorization': `Bearer ${API_KEY}` } }
      );
      if (!ppaRes.ok) continue;

      const ppaData = await ppaRes.json();

      // Group by team and build cumulative stats
      const byTeamWeek = new Map<string, Map<number, { offPPA: number[]; defPPA: number[] }>>();

      for (const game of ppaData) {
        const cfbdId = schoolToCfbdId.get(game.team?.toLowerCase() || '');
        if (cfbdId === undefined) continue;

        const teamUuid = cfbdIdToCanonical.get(cfbdId);
        if (!teamUuid) continue;

        if (!byTeamWeek.has(teamUuid)) byTeamWeek.set(teamUuid, new Map());
        const teamWeeks = byTeamWeek.get(teamUuid)!;

        if (!teamWeeks.has(game.week)) teamWeeks.set(game.week, { offPPA: [], defPPA: [] });
        const weekData = teamWeeks.get(game.week)!;

        if (game.offense?.overall !== undefined) weekData.offPPA.push(game.offense.overall);
        if (game.defense?.overall !== undefined) weekData.defPPA.push(game.defense.overall);
      }

      // Build cumulative records
      const records: Array<{
        team_id: string;
        season: number;
        week: number;
        games_played: number;
        off_ppa: number;
        def_ppa: number;
        source: string;
      }> = [];

      for (const [teamUuid, weeks] of byTeamWeek) {
        const weekNums = [...weeks.keys()].sort((a, b) => a - b);
        let cumOffPPA: number[] = [];
        let cumDefPPA: number[] = [];

        for (const week of weekNums) {
          const data = weeks.get(week)!;
          cumOffPPA = cumOffPPA.concat(data.offPPA);
          cumDefPPA = cumDefPPA.concat(data.defPPA);

          if (cumOffPPA.length > 0) {
            records.push({
              team_id: teamUuid,
              season,
              week,
              games_played: cumOffPPA.length,
              off_ppa: cumOffPPA.reduce((a, b) => a + b, 0) / cumOffPPA.length,
              def_ppa: cumDefPPA.reduce((a, b) => a + b, 0) / cumDefPPA.length,
              source: 'cfbd_ppa',
            });
          }
        }
      }

      // Insert
      for (let i = 0; i < records.length; i += 500) {
        await supabase
          .from('team_stats_snapshots')
          .upsert(records.slice(i, i + 500), { onConflict: 'team_id,season,week' });
      }

      console.log(`    ${season}: ${records.length} PPA records`);
    } catch (err) {
      console.log(`    ${season}: ERROR - ${err}`);
    }
  }

  // Step 8: Sync Pace for 2022-2024
  console.log('\n[8] Syncing Pace stats...');

  for (const season of [2022, 2023, 2024]) {
    let paceRecords = 0;

    for (let week = 1; week <= 16; week++) {
      try {
        const res = await fetch(
          `https://api.collegefootballdata.com/stats/game/advanced?year=${season}&week=${week}`,
          { headers: { 'Authorization': `Bearer ${API_KEY}` } }
        );
        if (!res.ok) continue;

        const data = await res.json();

        // Group by team
        const byTeam = new Map<string, number[]>();

        for (const game of data) {
          if (!game.team || !game.offense?.plays) continue;

          const cfbdId = schoolToCfbdId.get(game.team.toLowerCase());
          if (cfbdId === undefined) continue;

          const teamUuid = cfbdIdToCanonical.get(cfbdId);
          if (!teamUuid) continue;

          if (!byTeam.has(teamUuid)) byTeam.set(teamUuid, []);
          byTeam.get(teamUuid)!.push(game.offense.plays);
        }

        // Update existing stats records with pace
        for (const [teamUuid, plays] of byTeam) {
          const totalPlays = plays.reduce((a, b) => a + b, 0);
          const playsPerGame = totalPlays / plays.length;

          const { error } = await supabase
            .from('team_stats_snapshots')
            .update({ total_plays: totalPlays, plays_per_game: playsPerGame })
            .eq('team_id', teamUuid)
            .eq('season', season)
            .eq('week', week);

          if (!error) paceRecords++;
        }
      } catch (err) {
        // Week doesn't exist
      }
    }

    console.log(`    ${season}: ${paceRecords} Pace updates`);
  }
}

// ============================================================================
// SECTION 3: COVERAGE STATS
// ============================================================================

async function outputCoverageStats() {
  console.log('\n' + '═'.repeat(70));
  console.log('FINAL COVERAGE STATS');
  console.log('═'.repeat(70));

  // Get all teams
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id');

  const { count: teamCount } = await supabase
    .from('teams')
    .select('*', { count: 'exact', head: true });

  console.log(`\n[1] TEAMS`);
  console.log(`    Total teams: ${teamCount}`);

  // Check for duplicate cfbd_team_ids
  const cfbdIds = new Set<number>();
  let duplicates = 0;
  for (const t of allTeams || []) {
    if (t.cfbd_team_id) {
      const id = parseInt(t.cfbd_team_id, 10);
      if (cfbdIds.has(id)) duplicates++;
      cfbdIds.add(id);
    }
  }
  console.log(`    Unique cfbd_team_ids: ${cfbdIds.size}`);
  console.log(`    Duplicate cfbd_team_ids: ${duplicates}`);

  // Get FBS teams
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdFbsTeams = await res.json();
  const fbsCfbdIds = new Set<number>(cfbdFbsTeams.map((t: any) => t.id));

  console.log(`\n[2] FBS TEAMS`);
  console.log(`    CFBD FBS teams: ${cfbdFbsTeams.length}`);

  // Get event teams
  const { data: events } = await supabase
    .from('events')
    .select('home_team_id, away_team_id');

  const eventTeamIds = new Set<string>();
  for (const e of events || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  // Count FBS in events
  let fbsInEvents = 0;
  const teamIdToCfbdId = new Map<string, number>();
  for (const t of allTeams || []) {
    if (t.cfbd_team_id) {
      const cfbdId = parseInt(t.cfbd_team_id, 10);
      teamIdToCfbdId.set(t.id, cfbdId);
      if (eventTeamIds.has(t.id) && fbsCfbdIds.has(cfbdId)) {
        fbsInEvents++;
      }
    }
  }

  console.log(`    FBS teams in events: ${fbsInEvents}/${cfbdFbsTeams.length}`);

  // Get Elo coverage
  const { data: eloTeams } = await supabase
    .from('team_elo_snapshots')
    .select('team_id');

  const eloTeamIds = new Set<string>();
  for (const e of eloTeams || []) {
    eloTeamIds.add(e.team_id);
  }

  const eloEventOverlap = [...eventTeamIds].filter(id => eloTeamIds.has(id)).length;
  const eloFbsCount = [...eloTeamIds].filter(id => {
    const cfbdId = teamIdToCfbdId.get(id);
    return cfbdId !== undefined && fbsCfbdIds.has(cfbdId);
  }).length;

  console.log(`\n[3] ELO COVERAGE`);
  console.log(`    Teams with Elo data: ${eloTeamIds.size}`);
  console.log(`    FBS teams with Elo: ${eloFbsCount}/${cfbdFbsTeams.length} (${(eloFbsCount / cfbdFbsTeams.length * 100).toFixed(1)}%)`);
  console.log(`    Event teams with Elo: ${eloEventOverlap}/${eventTeamIds.size} (${(eloEventOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);

  // Get Stats coverage
  const { data: statsTeams } = await supabase
    .from('team_stats_snapshots')
    .select('team_id');

  const statsTeamIds = new Set<string>();
  for (const s of statsTeams || []) {
    statsTeamIds.add(s.team_id);
  }

  const statsEventOverlap = [...eventTeamIds].filter(id => statsTeamIds.has(id)).length;
  const statsFbsCount = [...statsTeamIds].filter(id => {
    const cfbdId = teamIdToCfbdId.get(id);
    return cfbdId !== undefined && fbsCfbdIds.has(cfbdId);
  }).length;

  console.log(`\n[4] STATS COVERAGE`);
  console.log(`    Teams with Stats data: ${statsTeamIds.size}`);
  console.log(`    FBS teams with Stats: ${statsFbsCount}/${cfbdFbsTeams.length} (${(statsFbsCount / cfbdFbsTeams.length * 100).toFixed(1)}%)`);
  console.log(`    Event teams with Stats: ${statsEventOverlap}/${eventTeamIds.size} (${(statsEventOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);

  // Week-by-week stats coverage for 2024
  console.log(`\n[5] 2024 STATS COVERAGE BY WEEK`);

  for (const week of [1, 2, 3, 4, 8, 12, 16]) {
    const { count } = await supabase
      .from('team_stats_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('season', 2024)
      .eq('week', week);

    console.log(`    Week ${week}: ${count || 0} teams`);
  }

  // Count totals
  const { count: eloCount } = await supabase
    .from('team_elo_snapshots')
    .select('*', { count: 'exact', head: true });

  const { count: statsCount } = await supabase
    .from('team_stats_snapshots')
    .select('*', { count: 'exact', head: true });

  console.log(`\n[6] TOTAL SNAPSHOT COUNTS`);
  console.log(`    Elo snapshots: ${eloCount}`);
  console.log(`    Stats snapshots: ${statsCount}`);

  // Assertions
  console.log('\n' + '═'.repeat(70));
  console.log('ASSERTIONS');
  console.log('═'.repeat(70));

  const assertions = [
    { name: 'No duplicate cfbd_team_ids', passed: duplicates === 0 },
    { name: 'FBS Elo coverage >= 80%', passed: eloFbsCount >= cfbdFbsTeams.length * 0.8 },
    { name: 'FBS Stats coverage >= 80%', passed: statsFbsCount >= cfbdFbsTeams.length * 0.8 },
  ];

  for (const a of assertions) {
    console.log(`    ${a.passed ? '✓' : '✗'} ${a.name}`);
  }

  const allPassed = assertions.every(a => a.passed);
  console.log(`\n${allPassed ? '✓ ALL ASSERTIONS PASSED' : '✗ SOME ASSERTIONS FAILED'}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔' + '═'.repeat(68) + '╗');
  console.log('║' + '  CANONICALIZE TEAMS - Fix Team UUID Mapping'.padEnd(68) + '║');
  console.log('║' + `  Mode: ${DRY_RUN ? 'DRY RUN (audit only)' : 'APPLY (making changes)'}`.padEnd(68) + '║');
  console.log('╚' + '═'.repeat(68) + '╝');

  if (DRY_RUN) {
    const audit = await runAudit();

    console.log('\n' + '═'.repeat(70));
    console.log('AUDIT SUMMARY');
    console.log('═'.repeat(70));
    console.log(`
    Teams before: ${audit.teamsTotal}
    Teams after: ${audit.canonicalTeams + (audit.teamsTotal - audit.teamsWithCfbdId)}
    Teams to delete: ${audit.teamsToDelete}
    Events to re-point: ${audit.eventsToRepoint}
    Elo rows to delete: ${audit.eloRowsToDelete}
    Stats rows to delete: ${audit.statsRowsToDelete}
    `);

    console.log('To apply these changes, run:');
    console.log('  DRY_RUN=false npx tsx scripts/canonicalize-teams.ts\n');
  } else {
    await applyChanges();
    await outputCoverageStats();

    console.log('\n' + '═'.repeat(70));
    console.log('CANONICALIZATION COMPLETE');
    console.log('═'.repeat(70));
    console.log('\nDo NOT resume modeling until coverage stats are validated.\n');
  }
}

main().catch(console.error);
