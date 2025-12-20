/**
 * Fix Elo Sync v2 - Use ONLY event team UUIDs
 *
 * The problem: 696 cfbd_id → UUID mappings exist, but most aren't event teams.
 * The fix: Build mapping ONLY from event teams, sync only those.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

async function main() {
  console.log('=== Fix Elo Sync v2 ===\n');

  // Step 1: Build cfbd_team_id → event_team_uuid mapping (ONLY event teams)
  console.log('Step 1: Building event-only mapping...');

  const { data: homeEvents } = await supabase.from('events').select('home_team_id');
  const { data: awayEvents } = await supabase.from('events').select('away_team_id');

  const eventTeamIds = new Set<string>();
  for (const e of homeEvents || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
  }
  for (const e of awayEvents || []) {
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }
  console.log(`  Event team UUIDs: ${eventTeamIds.size}`);

  // Get team info for ONLY event teams
  const { data: eventTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .in('id', [...eventTeamIds])
    .not('cfbd_team_id', 'is', null);

  // Build cfbd_id -> event_team_uuid (STRICT)
  const cfbdIdToEventUuid = new Map<number, string>();
  for (const t of eventTeams || []) {
    const cfbdId = parseInt(t.cfbd_team_id, 10);
    if (!isNaN(cfbdId)) {
      cfbdIdToEventUuid.set(cfbdId, t.id);
    }
  }
  console.log(`  Event teams with cfbd_team_id: ${cfbdIdToEventUuid.size}`);

  // Get CFBD FBS teams to map school name -> cfbd_id
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();

  const schoolNameToCfbdId = new Map<string, number>();
  for (const t of cfbdTeams) {
    schoolNameToCfbdId.set(t.school.toLowerCase(), t.id);
  }
  console.log(`  CFBD FBS teams: ${cfbdTeams.length}`);

  // Step 2: Clear existing Elo snapshots
  console.log('\nStep 2: Clearing Elo snapshots...');
  await supabase.from('team_elo_snapshots').delete().gte('id', '00000000-0000-0000-0000-000000000000');
  console.log('  Cleared');

  // Step 3: Sync Elo for 2024 only (test first)
  console.log('\nStep 3: Syncing Elo for 2024...');

  let totalInserted = 0;
  let skipped = 0;
  const skippedTeams = new Set<string>();

  for (let week = 0; week <= 16; week++) {
    try {
      const eloRes = await fetch(
        `https://api.collegefootballdata.com/ratings/elo?year=2024&week=${week}`,
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
        // Get cfbd_id from team name
        const cfbdId = schoolNameToCfbdId.get(entry.team.toLowerCase());
        if (cfbdId === undefined) {
          skipped++;
          skippedTeams.add(entry.team);
          continue;
        }

        // Get event team UUID from cfbd_id
        const teamUuid = cfbdIdToEventUuid.get(cfbdId);
        if (!teamUuid) {
          skipped++;
          skippedTeams.add(entry.team);
          continue;
        }

        records.push({
          team_id: teamUuid,
          season: 2024,
          week,
          elo: entry.elo,
          source: 'cfbd',
        });
      }

      if (records.length > 0) {
        const { error, count } = await supabase
          .from('team_elo_snapshots')
          .upsert(records, { onConflict: 'team_id,season,week', count: 'exact' });

        if (!error) {
          console.log(`  W${week}: ${count} teams (skipped ${eloData.length - records.length})`);
          totalInserted += count || 0;
        } else {
          console.log(`  W${week}: ERROR - ${error.message}`);
        }
      }
    } catch (err) {
      // Week doesn't exist
    }
  }

  console.log(`\n  Total: ${totalInserted} records, ${skipped} skipped`);
  console.log(`  Skipped teams: ${skippedTeams.size}`);

  // Step 4: Verify coverage
  console.log('\nStep 4: Verifying coverage...');

  const { data: eloSnaps } = await supabase.from('team_elo_snapshots').select('team_id');
  const eloTeamIds = new Set<string>();
  for (const e of eloSnaps || []) {
    eloTeamIds.add(e.team_id);
  }

  const overlap = [...eventTeamIds].filter(id => eloTeamIds.has(id)).length;
  console.log(`  Elo team UUIDs: ${eloTeamIds.size}`);
  console.log(`  Events ∩ Elo: ${overlap}/${eventTeamIds.size} (${(overlap / eventTeamIds.size * 100).toFixed(1)}%)`);

  // Sample verification
  const { data: sample } = await supabase
    .from('team_elo_snapshots')
    .select('team_id, season, week, elo')
    .eq('season', 2024)
    .eq('week', 5)
    .limit(10);

  console.log('\nSample Elo (2024 W5):');
  for (const s of sample || []) {
    const team = eventTeams?.find(t => t.id === s.team_id);
    console.log(`  ${team?.name} (${s.team_id.substring(0, 8)}...) = ${s.elo}`);
  }
}

main().catch(console.error);
