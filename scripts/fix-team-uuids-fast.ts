/**
 * Fast Team UUID Fix - Part 2
 *
 * Continues from where the first script left off:
 * - Events: Done (898 updated)
 * - Elo: Done (1139 updated, 2873 merged)
 * - Stats: Needs fixing
 * - Orphan cleanup: Needs doing
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function buildCanonicalMapping(): Promise<Map<string, string>> {
  console.log('Building canonical UUID mapping...');

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

  // Build mapping: aliasId -> canonicalId
  const mapping = new Map<string, string>();

  for (const [cfbdId, teams] of byCfbdId) {
    if (teams.length <= 1) continue;

    // Sort by event count descending, then by name length
    teams.sort((a, b) => {
      if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
      return a.name.length - b.name.length;
    });

    const canonicalId = teams[0].id;
    for (const t of teams.slice(1)) {
      mapping.set(t.id, canonicalId);
    }
  }

  console.log(`  Found ${mapping.size} alias → canonical mappings\n`);
  return mapping;
}

async function fixStatsSnapshotsBulk(mapping: Map<string, string>) {
  console.log('Fixing stats_snapshots (bulk approach)...');

  // Get all stats snapshots
  let allStats: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('team_stats_snapshots')
      .select('id, team_id, season, week')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allStats = allStats.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`  Loaded ${allStats.length} stats snapshots`);

  // Find which need updating
  const needsUpdate: Array<{ id: string; newTeamId: string }> = [];
  const toDelete: string[] = [];

  // Group by new team_id + season + week to find conflicts
  const byKey = new Map<string, any[]>();

  for (const stat of allStats) {
    const canonicalId = mapping.get(stat.team_id) || stat.team_id;
    const key = `${canonicalId}-${stat.season}-${stat.week}`;

    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ ...stat, canonicalId });
  }

  // Decide what to keep
  for (const [key, stats] of byKey) {
    if (stats.length === 1) {
      const stat = stats[0];
      if (stat.team_id !== stat.canonicalId) {
        needsUpdate.push({ id: stat.id, newTeamId: stat.canonicalId });
      }
    } else {
      // Multiple stats for same canonical + season + week
      // Keep the one that's already canonical, delete others
      const alreadyCanonical = stats.find(s => s.team_id === s.canonicalId);
      if (alreadyCanonical) {
        for (const s of stats) {
          if (s.id !== alreadyCanonical.id) toDelete.push(s.id);
        }
      } else {
        // None is canonical - keep first, update it, delete rest
        needsUpdate.push({ id: stats[0].id, newTeamId: stats[0].canonicalId });
        for (const s of stats.slice(1)) toDelete.push(s.id);
      }
    }
  }

  console.log(`  Need to update: ${needsUpdate.length}, delete: ${toDelete.length}`);

  // Delete first
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    await supabase.from('team_stats_snapshots').delete().in('id', batch);
  }
  console.log(`  Deleted ${toDelete.length} duplicates`);

  // Update in batches
  let updated = 0;
  for (const { id, newTeamId } of needsUpdate) {
    const { error } = await supabase
      .from('team_stats_snapshots')
      .update({ team_id: newTeamId })
      .eq('id', id);
    if (!error) updated++;
  }
  console.log(`  Updated ${updated} snapshots\n`);
}

async function deleteOrphanedTeams(mapping: Map<string, string>) {
  console.log('Deleting orphaned team entries...');

  const aliasIds = [...mapping.keys()];
  let deleted = 0;

  for (const aliasId of aliasIds) {
    // Check if still used
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
      const { error } = await supabase.from('teams').delete().eq('id', aliasId);
      if (!error) deleted++;
    }
  }

  console.log(`  Deleted ${deleted} orphaned teams\n`);
}

async function verifyCoverage() {
  console.log('=== Coverage Verification ===\n');

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

  console.log(`Unique team IDs in events: ${eventTeamIds.size}`);
  console.log(`Unique team IDs in elo_snapshots: ${eloTeamIds.size}`);
  console.log(`Unique team IDs in stats_snapshots: ${statsTeamIds.size}`);
  console.log(`\nEvents ∩ Elo:   ${eventEloOverlap}/${eventTeamIds.size} (${(eventEloOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);
  console.log(`Events ∩ Stats: ${eventStatsOverlap}/${eventTeamIds.size} (${(eventStatsOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);

  // Count teams in database
  const { count } = await supabase.from('teams').select('id', { count: 'exact', head: true });
  console.log(`\nTotal teams remaining: ${count}`);
}

async function main() {
  console.log('=== Fast Team UUID Fix (Part 2) ===\n');

  const mapping = await buildCanonicalMapping();

  await fixStatsSnapshotsBulk(mapping);
  await deleteOrphanedTeams(mapping);
  await verifyCoverage();

  console.log('\n✅ Fix complete!');
}

main().catch(console.error);
