/**
 * Fix Team UUID Mapping
 *
 * This script:
 * 1. For each cfbd_team_id with duplicates, picks the canonical UUID (most used in events)
 * 2. Updates all events to use the canonical UUID
 * 3. Updates all elo_snapshots to use the canonical UUID
 * 4. Updates all stats_snapshots to use the canonical UUID
 * 5. Merges results to use the canonical UUID
 * 6. Deletes orphaned team entries
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TeamDuplicate {
  cfbdId: string;
  teams: Array<{ id: string; name: string; eventCount: number }>;
  canonicalId: string;
  aliasIds: string[];
}

async function findDuplicates(): Promise<TeamDuplicate[]> {
  console.log('Finding duplicate teams...');

  // Get all teams
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id');

  // Get event counts per team
  const { data: homeEvents } = await supabase.from('events').select('home_team_id');
  const { data: awayEvents } = await supabase.from('events').select('away_team_id');

  const eventCounts = new Map<string, number>();
  for (const e of homeEvents || []) {
    eventCounts.set(e.home_team_id, (eventCounts.get(e.home_team_id) || 0) + 1);
  }
  for (const e of awayEvents || []) {
    eventCounts.set(e.away_team_id, (eventCounts.get(e.away_team_id) || 0) + 1);
  }

  // Group by cfbd_team_id
  const byCfbdId = new Map<string, Array<{ id: string; name: string; eventCount: number }>>();
  for (const t of allTeams || []) {
    if (!t.cfbd_team_id) continue;
    if (!byCfbdId.has(t.cfbd_team_id)) byCfbdId.set(t.cfbd_team_id, []);
    byCfbdId.get(t.cfbd_team_id)!.push({
      id: t.id,
      name: t.name,
      eventCount: eventCounts.get(t.id) || 0,
    });
  }

  // Find duplicates and pick canonical
  const duplicates: TeamDuplicate[] = [];
  for (const [cfbdId, teams] of byCfbdId) {
    if (teams.length <= 1) continue;

    // Sort by event count descending, then by name length (prefer shorter names)
    teams.sort((a, b) => {
      if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
      return a.name.length - b.name.length;
    });

    const canonicalId = teams[0].id;
    const aliasIds = teams.slice(1).map(t => t.id);

    duplicates.push({ cfbdId, teams, canonicalId, aliasIds });
  }

  console.log(`Found ${duplicates.length} duplicate cfbd_team_ids\n`);
  return duplicates;
}

async function fixEvents(duplicates: TeamDuplicate[]): Promise<number> {
  console.log('Fixing events table...');
  let updated = 0;

  for (const dup of duplicates) {
    for (const aliasId of dup.aliasIds) {
      // Update home_team_id
      const { data: homeUpdated, error: homeErr } = await supabase
        .from('events')
        .update({ home_team_id: dup.canonicalId })
        .eq('home_team_id', aliasId)
        .select('id');

      if (homeUpdated) updated += homeUpdated.length;

      // Update away_team_id
      const { data: awayUpdated, error: awayErr } = await supabase
        .from('events')
        .update({ away_team_id: dup.canonicalId })
        .eq('away_team_id', aliasId)
        .select('id');

      if (awayUpdated) updated += awayUpdated.length;
    }
  }

  console.log(`  Updated ${updated} event references\n`);
  return updated;
}

async function fixEloSnapshots(duplicates: TeamDuplicate[]): Promise<number> {
  console.log('Fixing elo_snapshots table...');
  let updated = 0;
  let merged = 0;

  for (const dup of duplicates) {
    for (const aliasId of dup.aliasIds) {
      // First check for conflicts (same team_id + season + week)
      const { data: aliasRows } = await supabase
        .from('team_elo_snapshots')
        .select('id, season, week, elo')
        .eq('team_id', aliasId);

      for (const row of aliasRows || []) {
        // Check if canonical already has this season/week
        const { data: existing } = await supabase
          .from('team_elo_snapshots')
          .select('id')
          .eq('team_id', dup.canonicalId)
          .eq('season', row.season)
          .eq('week', row.week)
          .single();

        if (existing) {
          // Delete the alias row (canonical takes precedence)
          await supabase.from('team_elo_snapshots').delete().eq('id', row.id);
          merged++;
        } else {
          // Update to canonical
          await supabase
            .from('team_elo_snapshots')
            .update({ team_id: dup.canonicalId })
            .eq('id', row.id);
          updated++;
        }
      }
    }
  }

  console.log(`  Updated ${updated} elo_snapshots, merged/deleted ${merged}\n`);
  return updated;
}

async function fixStatsSnapshots(duplicates: TeamDuplicate[]): Promise<number> {
  console.log('Fixing stats_snapshots table...');
  let updated = 0;
  let merged = 0;

  for (const dup of duplicates) {
    for (const aliasId of dup.aliasIds) {
      // First check for conflicts
      const { data: aliasRows } = await supabase
        .from('team_stats_snapshots')
        .select('id, season, week')
        .eq('team_id', aliasId);

      for (const row of aliasRows || []) {
        // Check if canonical already has this season/week
        const { data: existing } = await supabase
          .from('team_stats_snapshots')
          .select('id')
          .eq('team_id', dup.canonicalId)
          .eq('season', row.season)
          .eq('week', row.week)
          .single();

        if (existing) {
          // Delete the alias row
          await supabase.from('team_stats_snapshots').delete().eq('id', row.id);
          merged++;
        } else {
          // Update to canonical
          await supabase
            .from('team_stats_snapshots')
            .update({ team_id: dup.canonicalId })
            .eq('id', row.id);
          updated++;
        }
      }
    }
  }

  console.log(`  Updated ${updated} stats_snapshots, merged/deleted ${merged}\n`);
  return updated;
}

async function fixResults(duplicates: TeamDuplicate[]): Promise<number> {
  console.log('Checking results table...');

  // Results reference events, not teams directly
  // But let's verify the events they reference now have canonical team IDs
  const { count } = await supabase.from('results').select('id', { count: 'exact', head: true });
  console.log(`  Results table has ${count} rows (linked via event_id, no direct fix needed)\n`);
  return 0;
}

async function deleteOrphanedTeams(duplicates: TeamDuplicate[]): Promise<number> {
  console.log('Deleting orphaned team entries...');
  let deleted = 0;

  for (const dup of duplicates) {
    for (const aliasId of dup.aliasIds) {
      // Check if this team ID is still used anywhere
      const { data: eventsUsing } = await supabase
        .from('events')
        .select('id')
        .or(`home_team_id.eq.${aliasId},away_team_id.eq.${aliasId}`)
        .limit(1);

      const { data: eloUsing } = await supabase
        .from('team_elo_snapshots')
        .select('id')
        .eq('team_id', aliasId)
        .limit(1);

      const { data: statsUsing } = await supabase
        .from('team_stats_snapshots')
        .select('id')
        .eq('team_id', aliasId)
        .limit(1);

      if (!eventsUsing?.length && !eloUsing?.length && !statsUsing?.length) {
        // Safe to delete
        const { error } = await supabase.from('teams').delete().eq('id', aliasId);
        if (!error) deleted++;
      }
    }
  }

  console.log(`  Deleted ${deleted} orphaned team entries\n`);
  return deleted;
}

async function verifyCoverage() {
  console.log('Verifying coverage after fix...\n');

  // Get event team IDs
  const { data: events } = await supabase.from('events').select('home_team_id, away_team_id');
  const eventTeamIds = new Set<string>();
  for (const e of events || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  // Get elo team IDs
  const { data: eloRows } = await supabase.from('team_elo_snapshots').select('team_id');
  const eloTeamIds = new Set<string>();
  for (const e of eloRows || []) {
    if (e.team_id) eloTeamIds.add(e.team_id);
  }

  // Get stats team IDs
  const { data: statsRows } = await supabase.from('team_stats_snapshots').select('team_id');
  const statsTeamIds = new Set<string>();
  for (const s of statsRows || []) {
    if (s.team_id) statsTeamIds.add(s.team_id);
  }

  const eventEloOverlap = [...eventTeamIds].filter(id => eloTeamIds.has(id)).length;
  const eventStatsOverlap = [...eventTeamIds].filter(id => statsTeamIds.has(id)).length;

  console.log('=== Coverage After Fix ===');
  console.log(`Unique team IDs in events: ${eventTeamIds.size}`);
  console.log(`Unique team IDs in elo_snapshots: ${eloTeamIds.size}`);
  console.log(`Unique team IDs in stats_snapshots: ${statsTeamIds.size}`);
  console.log(`Events ∩ Elo:   ${eventEloOverlap}/${eventTeamIds.size} (${(eventEloOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);
  console.log(`Events ∩ Stats: ${eventStatsOverlap}/${eventTeamIds.size} (${(eventStatsOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);
}

async function main() {
  console.log('=== Fixing Team UUID Mapping ===\n');

  // Step 1: Find all duplicates
  const duplicates = await findDuplicates();

  if (duplicates.length === 0) {
    console.log('No duplicates found. Nothing to fix.');
    return;
  }

  // Show sample of what will be merged
  console.log('Sample merges (first 5):');
  for (const dup of duplicates.slice(0, 5)) {
    console.log(`  cfbd_id ${dup.cfbdId}:`);
    console.log(`    Canonical: ${dup.teams[0].name} (${dup.teams[0].eventCount} events)`);
    for (const t of dup.teams.slice(1)) {
      console.log(`    → Alias: ${t.name} (${t.eventCount} events) will be merged`);
    }
  }
  console.log();

  // Step 2: Fix events
  await fixEvents(duplicates);

  // Step 3: Fix elo_snapshots
  await fixEloSnapshots(duplicates);

  // Step 4: Fix stats_snapshots
  await fixStatsSnapshots(duplicates);

  // Step 5: Fix results (verify)
  await fixResults(duplicates);

  // Step 6: Delete orphaned teams
  await deleteOrphanedTeams(duplicates);

  // Step 7: Verify coverage
  await verifyCoverage();

  console.log('\n✅ Team UUID fix complete!');
}

main().catch(console.error);
