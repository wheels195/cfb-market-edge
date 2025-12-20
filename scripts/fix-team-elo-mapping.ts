/**
 * Fix Elo snapshots to use the correct team IDs
 *
 * Problem: Teams from Odds API and CFBD have different UUIDs but same cfbd_team_id
 * Solution: Update Elo snapshots to point to the Odds API team (which events use)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function fix() {
  console.log('=== Fixing Elo Snapshot Team Mapping ===\n');

  // Get all teams
  const { data: teams } = await supabase.from('teams').select('id, name, cfbd_team_id');
  if (!teams) {
    console.error('No teams found');
    return;
  }

  console.log(`Total teams: ${teams.length}`);

  // Group teams by cfbd_team_id to find duplicates
  const byCfbdId: Record<number, typeof teams> = {};
  for (const team of teams) {
    if (team.cfbd_team_id) {
      if (!byCfbdId[team.cfbd_team_id]) byCfbdId[team.cfbd_team_id] = [];
      byCfbdId[team.cfbd_team_id].push(team);
    }
  }

  // Find duplicates
  const duplicates = Object.entries(byCfbdId).filter(([_, t]) => t.length > 1);
  console.log(`Teams with duplicate CFBD IDs: ${duplicates.length}`);

  if (duplicates.length > 0) {
    console.log('\nSample duplicates:');
    for (const [cfbdId, dups] of duplicates.slice(0, 5)) {
      console.log(`  CFBD ${cfbdId}:`);
      for (const d of dups) {
        console.log(`    - ${d.name} (${d.id})`);
      }
    }
  }

  // Get unique team IDs used in events (these are the canonical ones)
  const { data: eventSample } = await supabase
    .from('events')
    .select('home_team_id, away_team_id')
    .limit(5000);

  const eventTeamIds = new Set<string>();
  for (const e of eventSample || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }
  console.log(`\nUnique team IDs in events: ${eventTeamIds.size}`);

  // For each CFBD ID, pick the team that's used in events as canonical
  const canonicalByCfbdId: Record<number, string> = {};
  for (const [cfbdId, dups] of Object.entries(byCfbdId)) {
    // Prefer the team that's in events
    const eventTeam = dups.find(t => eventTeamIds.has(t.id));
    if (eventTeam) {
      canonicalByCfbdId[parseInt(cfbdId)] = eventTeam.id;
    } else {
      // Use the first one if none are in events
      canonicalByCfbdId[parseInt(cfbdId)] = dups[0].id;
    }
  }

  console.log(`Canonical team mappings: ${Object.keys(canonicalByCfbdId).length}`);

  // Get all Elo snapshots
  const { data: eloSnaps } = await supabase.from('team_elo_snapshots').select('id, team_id');
  console.log(`\nElo snapshots: ${eloSnaps?.length}`);

  // Build team_id -> cfbd_team_id lookup
  const teamToCfbd: Record<string, number> = {};
  for (const team of teams) {
    if (team.cfbd_team_id) {
      teamToCfbd[team.id] = team.cfbd_team_id;
    }
  }

  // Find Elo snapshots that need updating
  let needsUpdate = 0;
  let correct = 0;
  const updates: { id: string; newTeamId: string }[] = [];

  for (const snap of eloSnaps || []) {
    const cfbdId = teamToCfbd[snap.team_id];
    if (!cfbdId) {
      console.log(`Warning: No CFBD ID for team ${snap.team_id}`);
      continue;
    }

    const canonical = canonicalByCfbdId[cfbdId];
    if (canonical && canonical !== snap.team_id) {
      needsUpdate++;
      updates.push({ id: snap.id, newTeamId: canonical });
    } else {
      correct++;
    }
  }

  console.log(`\nElo snapshots with correct team ID: ${correct}`);
  console.log(`Elo snapshots needing update: ${needsUpdate}`);

  if (updates.length > 0) {
    console.log('\nUpdating Elo snapshots...');

    // Batch update in chunks
    const chunkSize = 100;
    let updated = 0;

    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);

      for (const upd of chunk) {
        const { error } = await supabase
          .from('team_elo_snapshots')
          .update({ team_id: upd.newTeamId })
          .eq('id', upd.id);

        if (error) {
          console.error(`Error updating ${upd.id}: ${error.message}`);
        } else {
          updated++;
        }
      }

      console.log(`  Updated ${Math.min(i + chunkSize, updates.length)}/${updates.length}`);
    }

    console.log(`\nDone! Updated ${updated} Elo snapshots.`);
  } else {
    console.log('\nNo updates needed.');
  }
}

fix().catch(console.error);
