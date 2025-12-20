/**
 * Debug Elo coverage - check what team IDs are in Elo vs events
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function debug() {
  console.log('=== Debug Elo Coverage ===\n');

  // Count Elo snapshots by season
  const { data: eloBySeason } = await supabase
    .from('team_elo_snapshots')
    .select('season, team_id');

  const countBySeason: Record<number, number> = {};
  const teamsBySeason: Record<number, Set<string>> = {};

  for (const s of eloBySeason || []) {
    countBySeason[s.season] = (countBySeason[s.season] || 0) + 1;
    if (!teamsBySeason[s.season]) teamsBySeason[s.season] = new Set();
    teamsBySeason[s.season].add(s.team_id);
  }

  console.log('Elo snapshots by season:');
  for (const season of Object.keys(countBySeason).sort()) {
    const s = parseInt(season);
    console.log(`  ${season}: ${countBySeason[s]} records, ${teamsBySeason[s]?.size} unique teams`);
  }

  // Get team IDs used in events
  const { data: events } = await supabase
    .from('events')
    .select('home_team_id, away_team_id')
    .limit(5000);

  const eventTeamIds = new Set<string>();
  for (const e of events || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }
  console.log(`\nUnique team IDs in events: ${eventTeamIds.size}`);

  // Check overlap for 2024
  const eloTeamIds2024 = teamsBySeason[2024] || new Set();
  const overlap = [...eventTeamIds].filter(id => eloTeamIds2024.has(id));
  console.log(`Team IDs in both 2024 Elo AND events: ${overlap.length}`);

  // Sample teams in events but NOT in Elo
  const eventOnlyIds = [...eventTeamIds].filter(id => !eloTeamIds2024.has(id));
  console.log(`Team IDs in events but NOT in 2024 Elo: ${eventOnlyIds.length}`);

  // Get names for sample
  const { data: teams } = await supabase.from('teams').select('id, name, cfbd_team_id');
  const teamMap = new Map(teams?.map(t => [t.id, t]) || []);

  console.log('\nSample event teams missing 2024 Elo:');
  for (const id of eventOnlyIds.slice(0, 10)) {
    const t = teamMap.get(id);
    console.log(`  - ${t?.name || 'Unknown'} (cfbd: ${t?.cfbd_team_id || 'null'})`);
  }

  // Check if these teams are FBS
  console.log('\nSample event teams WITH 2024 Elo:');
  for (const id of overlap.slice(0, 10)) {
    const t = teamMap.get(id);
    console.log(`  - ${t?.name || 'Unknown'} (cfbd: ${t?.cfbd_team_id || 'null'})`);
  }
}

debug().catch(console.error);
