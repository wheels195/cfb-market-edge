/**
 * Debug Elo Sync Matching
 *
 * Figure out why Elo sync isn't finding event teams
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

async function main() {
  console.log('=== Debug Elo Sync Matching ===\n');

  // Get event team IDs and their cfbd_team_ids
  const { data: homeEvents } = await supabase.from('events').select('home_team_id');
  const { data: awayEvents } = await supabase.from('events').select('away_team_id');

  const eventTeamIds = new Set<string>();
  for (const e of homeEvents || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
  }
  for (const e of awayEvents || []) {
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  console.log(`Unique event team IDs: ${eventTeamIds.size}`);

  // Get team info for event teams
  const { data: eventTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .in('id', [...eventTeamIds]);

  // Build event team UUID -> cfbd_team_id map
  const eventUuidToCfbdId = new Map<string, number>();
  for (const t of eventTeams || []) {
    if (t.cfbd_team_id) {
      eventUuidToCfbdId.set(t.id, parseInt(t.cfbd_team_id, 10));
    }
  }
  console.log(`Event teams with cfbd_team_id: ${eventUuidToCfbdId.size}`);

  // Get CFBD FBS teams
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();
  console.log(`CFBD FBS teams: ${cfbdTeams.length}`);

  // Build cfbd_id -> school name map
  const cfbdIdToSchool = new Map<number, string>();
  for (const t of cfbdTeams) {
    cfbdIdToSchool.set(t.id, t.school);
  }

  // Get sample Elo data to see what team names are returned
  const eloRes = await fetch(
    `https://api.collegefootballdata.com/ratings/elo?year=2024&week=1`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } }
  );
  const eloData = await eloRes.json();
  console.log(`\nSample Elo data (2024 W1): ${eloData.length} teams`);

  // Check which Elo team names we can map to event teams
  let canMap = 0;
  let cannotMap = 0;
  const unmapped: string[] = [];

  // Build mapping: school name (from Elo API) -> event team UUID
  // This is what the sync needs to do

  // First, get all teams with cfbd_team_id
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  // Build cfbd_id -> team UUID, preferring event teams
  const cfbdIdToUuid = new Map<number, string>();
  for (const t of allTeams || []) {
    const cfbdId = parseInt(t.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;

    if (eventTeamIds.has(t.id)) {
      // Always prefer event team UUID
      cfbdIdToUuid.set(cfbdId, t.id);
    } else if (!cfbdIdToUuid.has(cfbdId)) {
      cfbdIdToUuid.set(cfbdId, t.id);
    }
  }
  console.log(`CFBD ID → UUID mappings: ${cfbdIdToUuid.size}`);

  // Check how many Elo teams we can map
  for (const elo of eloData) {
    const teamName = elo.team.toLowerCase();

    // Find CFBD ID from team name
    let cfbdId: number | undefined;
    for (const [id, school] of cfbdIdToSchool) {
      if (school.toLowerCase() === teamName) {
        cfbdId = id;
        break;
      }
    }

    if (cfbdId !== undefined && cfbdIdToUuid.has(cfbdId)) {
      const uuid = cfbdIdToUuid.get(cfbdId)!;
      if (eventTeamIds.has(uuid)) {
        canMap++;
      } else {
        // Mapped but not to event team
        cannotMap++;
        unmapped.push(`${elo.team} (cfbd=${cfbdId}, uuid not in events)`);
      }
    } else if (cfbdId !== undefined) {
      cannotMap++;
      unmapped.push(`${elo.team} (cfbd=${cfbdId}, no uuid mapping)`);
    } else {
      cannotMap++;
      unmapped.push(`${elo.team} (no cfbd match)`);
    }
  }

  console.log(`\nElo teams that map to event teams: ${canMap}/${eloData.length}`);
  console.log(`Elo teams that don't map: ${cannotMap}`);

  if (unmapped.length > 0 && unmapped.length <= 20) {
    console.log('\nUnmapped Elo teams:');
    for (const u of unmapped) {
      console.log(`  ${u}`);
    }
  }

  // Now check: what cfbd_ids are in events but not in elo mappings?
  const eventCfbdIds = new Set([...eventUuidToCfbdId.values()]);
  const eloCfbdIds = new Set<number>();
  for (const elo of eloData) {
    for (const [id, school] of cfbdIdToSchool) {
      if (school.toLowerCase() === elo.team.toLowerCase()) {
        eloCfbdIds.add(id);
        break;
      }
    }
  }

  const eventNotInElo = [...eventCfbdIds].filter(id => !eloCfbdIds.has(id));
  const eloNotInEvent = [...eloCfbdIds].filter(id => !eventCfbdIds.has(id));

  console.log(`\nEvent cfbd_ids not in Elo: ${eventNotInElo.length}`);
  console.log(`Elo cfbd_ids not in Event: ${eloNotInEvent.length}`);

  // Show sample event teams that aren't in Elo
  if (eventNotInElo.length > 0) {
    console.log('\nSample event teams not in Elo (first 10):');
    for (const cfbdId of eventNotInElo.slice(0, 10)) {
      const team = eventTeams?.find(t => parseInt(t.cfbd_team_id, 10) === cfbdId);
      const cfbdName = cfbdIdToSchool.get(cfbdId);
      console.log(`  cfbd_id=${cfbdId}: "${team?.name}" (CFBD: "${cfbdName || 'not in FBS'}")`);
    }
  }

  // Check actual Elo snapshots
  const { data: eloSnapshots } = await supabase
    .from('team_elo_snapshots')
    .select('team_id, season, week, elo')
    .eq('season', 2024)
    .eq('week', 1)
    .limit(10);

  console.log('\nActual Elo snapshots in DB (2024 W1):');
  for (const snap of eloSnapshots || []) {
    const team = allTeams?.find(t => t.id === snap.team_id);
    const isEventTeam = eventTeamIds.has(snap.team_id);
    console.log(`  ${team?.name} (${snap.team_id.substring(0, 8)}...) event=${isEventTeam} elo=${snap.elo}`);
  }
}

main().catch(console.error);
