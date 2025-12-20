/**
 * Diagnose Team UUID Mapping Issues
 *
 * Identifies duplicate teams and mapping problems between:
 * - teams table (Odds API vs CFBD created)
 * - events table (which team IDs are actually used)
 * - team_elo_snapshots
 * - team_stats_snapshots
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== Team UUID Diagnostic ===\n');

  // 1. Get all teams
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id, created_at')
    .order('name');

  console.log(`Total teams in database: ${allTeams?.length || 0}`);

  // 2. Find teams with same cfbd_team_id (duplicates)
  const byCfbdId = new Map<string, any[]>();
  for (const t of allTeams || []) {
    if (t.cfbd_team_id) {
      if (!byCfbdId.has(t.cfbd_team_id)) byCfbdId.set(t.cfbd_team_id, []);
      byCfbdId.get(t.cfbd_team_id)!.push(t);
    }
  }

  const duplicates = [...byCfbdId.entries()].filter(([_, teams]) => teams.length > 1);
  console.log(`\nTeams with duplicate cfbd_team_id: ${duplicates.length}`);

  if (duplicates.length > 0) {
    console.log('\nSample duplicates:');
    for (const [cfbdId, teams] of duplicates.slice(0, 5)) {
      console.log(`  cfbd_team_id ${cfbdId}:`);
      for (const t of teams) {
        console.log(`    - ${t.name} (UUID: ${t.id.substring(0, 8)}...)`);
      }
    }
  }

  // 3. Get team IDs actually used in events
  const { data: eventTeamIds } = await supabase
    .from('events')
    .select('home_team_id, away_team_id');

  const eventTeamIdSet = new Set<string>();
  for (const e of eventTeamIds || []) {
    if (e.home_team_id) eventTeamIdSet.add(e.home_team_id);
    if (e.away_team_id) eventTeamIdSet.add(e.away_team_id);
  }
  console.log(`\nUnique team IDs in events: ${eventTeamIdSet.size}`);

  // 4. Get team IDs in elo_snapshots
  const { data: eloTeamIds } = await supabase
    .from('team_elo_snapshots')
    .select('team_id');

  const eloTeamIdSet = new Set<string>();
  for (const e of eloTeamIds || []) {
    if (e.team_id) eloTeamIdSet.add(e.team_id);
  }
  console.log(`Unique team IDs in elo_snapshots: ${eloTeamIdSet.size}`);

  // 5. Get team IDs in stats_snapshots
  const { data: statsTeamIds } = await supabase
    .from('team_stats_snapshots')
    .select('team_id');

  const statsTeamIdSet = new Set<string>();
  for (const s of statsTeamIds || []) {
    if (s.team_id) statsTeamIdSet.add(s.team_id);
  }
  console.log(`Unique team IDs in stats_snapshots: ${statsTeamIdSet.size}`);

  // 6. Calculate overlaps
  const eventEloOverlap = [...eventTeamIdSet].filter(id => eloTeamIdSet.has(id)).length;
  const eventStatsOverlap = [...eventTeamIdSet].filter(id => statsTeamIdSet.has(id)).length;
  const eloStatsOverlap = [...eloTeamIdSet].filter(id => statsTeamIdSet.has(id)).length;

  console.log(`\n=== Overlap Analysis ===`);
  console.log(`Events ∩ Elo:   ${eventEloOverlap}/${eventTeamIdSet.size} (${(eventEloOverlap / eventTeamIdSet.size * 100).toFixed(1)}%)`);
  console.log(`Events ∩ Stats: ${eventStatsOverlap}/${eventTeamIdSet.size} (${(eventStatsOverlap / eventTeamIdSet.size * 100).toFixed(1)}%)`);
  console.log(`Elo ∩ Stats:    ${eloStatsOverlap}/${eloTeamIdSet.size} (${(eloStatsOverlap / eloTeamIdSet.size * 100).toFixed(1)}%)`);

  // 7. Find which event teams are missing from Elo/Stats
  const eventTeamsMissingElo = [...eventTeamIdSet].filter(id => !eloTeamIdSet.has(id));
  const eventTeamsMissingStats = [...eventTeamIdSet].filter(id => !statsTeamIdSet.has(id));

  console.log(`\nEvent teams missing from Elo: ${eventTeamsMissingElo.length}`);
  console.log(`Event teams missing from Stats: ${eventTeamsMissingStats.length}`);

  // 8. Sample missing teams
  if (eventTeamsMissingStats.length > 0) {
    console.log('\nSample event teams missing from stats:');
    const sampleMissing = eventTeamsMissingStats.slice(0, 10);
    for (const id of sampleMissing) {
      const team = allTeams?.find(t => t.id === id);
      console.log(`  ${team?.name || 'Unknown'} (${id.substring(0, 8)}...) cfbd_id=${team?.cfbd_team_id || 'null'}`);
    }
  }

  // 9. For duplicate cfbd_ids, identify which UUID is used in events
  console.log('\n=== Duplicate Resolution ===');
  let canResolve = 0;
  let needsManual = 0;

  for (const [cfbdId, teams] of duplicates) {
    const usedInEvents = teams.filter(t => eventTeamIdSet.has(t.id));
    if (usedInEvents.length === 1) {
      canResolve++;
    } else if (usedInEvents.length === 0) {
      // Neither used in events - likely FCS/non-FBS
    } else {
      needsManual++;
      console.log(`  cfbd_id ${cfbdId}: ${usedInEvents.length} UUIDs used in events!`);
    }
  }

  console.log(`\nDuplicates resolvable (1 UUID in events): ${canResolve}`);
  console.log(`Duplicates needing manual review: ${needsManual}`);

  // 10. Check if Elo teams have matching cfbd_id in event teams
  console.log('\n=== CFBD ID Mapping Check ===');

  const eventTeamCfbdIds = new Map<string, string>(); // cfbd_id -> event_team_uuid
  for (const id of eventTeamIdSet) {
    const team = allTeams?.find(t => t.id === id);
    if (team?.cfbd_team_id) {
      eventTeamCfbdIds.set(team.cfbd_team_id, id);
    }
  }

  const eloTeamCfbdIds = new Map<string, string>(); // cfbd_id -> elo_team_uuid
  for (const id of eloTeamIdSet) {
    const team = allTeams?.find(t => t.id === id);
    if (team?.cfbd_team_id) {
      eloTeamCfbdIds.set(team.cfbd_team_id, id);
    }
  }

  const statsTeamCfbdIds = new Map<string, string>(); // cfbd_id -> stats_team_uuid
  for (const id of statsTeamIdSet) {
    const team = allTeams?.find(t => t.id === id);
    if (team?.cfbd_team_id) {
      statsTeamCfbdIds.set(team.cfbd_team_id, id);
    }
  }

  // Check cfbd_id overlap
  const eventCfbdSet = new Set(eventTeamCfbdIds.keys());
  const eloCfbdSet = new Set(eloTeamCfbdIds.keys());
  const statsCfbdSet = new Set(statsTeamCfbdIds.keys());

  const eventEloCfbdOverlap = [...eventCfbdSet].filter(id => eloCfbdSet.has(id)).length;
  const eventStatsCfbdOverlap = [...eventCfbdSet].filter(id => statsCfbdSet.has(id)).length;

  console.log(`Event cfbd_ids with Elo data: ${eventEloCfbdOverlap}/${eventCfbdSet.size} (${(eventEloCfbdOverlap / eventCfbdSet.size * 100).toFixed(1)}%)`);
  console.log(`Event cfbd_ids with Stats data: ${eventStatsCfbdOverlap}/${eventCfbdSet.size} (${(eventStatsCfbdOverlap / eventCfbdSet.size * 100).toFixed(1)}%)`);

  // 11. Count how many teams need UUID remapping
  let eloNeedsRemap = 0;
  let statsNeedsRemap = 0;

  for (const cfbdId of eventCfbdSet) {
    const eventUUID = eventTeamCfbdIds.get(cfbdId);
    const eloUUID = eloTeamCfbdIds.get(cfbdId);
    const statsUUID = statsTeamCfbdIds.get(cfbdId);

    if (eloUUID && eloUUID !== eventUUID) eloNeedsRemap++;
    if (statsUUID && statsUUID !== eventUUID) statsNeedsRemap++;
  }

  console.log(`\nElo snapshots needing UUID remap: ${eloNeedsRemap}`);
  console.log(`Stats snapshots needing UUID remap: ${statsNeedsRemap}`);

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('DIAGNOSIS SUMMARY');
  console.log('═'.repeat(60));

  if (duplicates.length > 0) {
    console.log(`\n❌ PROBLEM: ${duplicates.length} teams have duplicate entries with same cfbd_team_id`);
    console.log(`   → Elo and Stats may be written to wrong UUID`);
  }

  if (eventEloOverlap < eventTeamIdSet.size * 0.8) {
    console.log(`\n❌ PROBLEM: Only ${(eventEloOverlap / eventTeamIdSet.size * 100).toFixed(1)}% of event teams have Elo data`);
  }

  if (eventStatsOverlap < eventTeamIdSet.size * 0.5) {
    console.log(`\n❌ PROBLEM: Only ${(eventStatsOverlap / eventTeamIdSet.size * 100).toFixed(1)}% of event teams have Stats data`);
  }

  console.log('\n📋 RECOMMENDED FIX:');
  console.log('   1. Keep team UUIDs that are used in events');
  console.log('   2. Delete duplicate team entries (UUIDs not in events)');
  console.log('   3. Update elo_snapshots to use correct UUIDs');
  console.log('   4. Rebuild stats_snapshots with correct UUIDs');
  console.log('   5. Verify coverage improves to 80%+');
}

main().catch(console.error);
