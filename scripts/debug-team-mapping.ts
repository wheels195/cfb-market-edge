/**
 * Debug team ID mapping between events and Elo snapshots
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function debug() {
  console.log('=== Team Mapping Debug ===\n');

  // Get teams from teams table
  const { data: teams } = await supabase.from('teams').select('id, name, cfbd_team_id');
  console.log(`Teams in 'teams' table: ${teams?.length}`);

  // Get unique team IDs used in events
  const { data: events } = await supabase.from('events').select('home_team_id, away_team_id').limit(1000);
  const eventTeamIds = new Set<string>();
  for (const e of events || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }
  console.log(`Unique team IDs in events: ${eventTeamIds.size}`);

  // Get unique team IDs in Elo snapshots
  const { data: eloSnaps } = await supabase.from('team_elo_snapshots').select('team_id');
  const eloTeamIds = new Set(eloSnaps?.map(s => s.team_id) || []);
  console.log(`Unique team IDs in Elo snapshots: ${eloTeamIds.size}`);

  // Find overlap
  const overlap = [...eventTeamIds].filter(id => eloTeamIds.has(id));
  console.log(`\nOverlap (teams with both events AND Elo): ${overlap.length}`);

  // Sample teams in events but NOT in Elo
  const eventOnly = [...eventTeamIds].filter(id => !eloTeamIds.has(id));
  console.log(`\nTeams in events but missing Elo: ${eventOnly.length}`);

  // Look up names for first 10
  if (eventOnly.length > 0) {
    console.log('\nSample teams missing Elo:');
    for (const id of eventOnly.slice(0, 10)) {
      const team = teams?.find(t => t.id === id);
      console.log(`  - ${team?.name || 'Unknown'} (ID: ${id}, CFBD: ${team?.cfbd_team_id || 'null'})`);
    }
  }

  // Check sample Elo teams
  console.log('\nSample teams WITH Elo:');
  for (const id of [...eloTeamIds].slice(0, 10)) {
    const team = teams?.find(t => t.id === id);
    console.log(`  - ${team?.name || 'Unknown'} (ID: ${id}, CFBD: ${team?.cfbd_team_id || 'null'})`);
  }

  // Check the Elo sync source
  const { data: eloSample } = await supabase
    .from('team_elo_snapshots')
    .select('*')
    .limit(5);
  console.log('\nSample Elo snapshots:');
  for (const snap of eloSample || []) {
    const team = teams?.find(t => t.id === snap.team_id);
    console.log(`  ${team?.name || 'Unknown'} S${snap.season} W${snap.week}: ${snap.elo}`);
  }

  // Check if CFBD team IDs are populated in teams table
  const teamsWithCfbd = teams?.filter(t => t.cfbd_team_id) || [];
  console.log(`\nTeams with CFBD team ID populated: ${teamsWithCfbd.length}/${teams?.length}`);
}

debug().catch(console.error);
