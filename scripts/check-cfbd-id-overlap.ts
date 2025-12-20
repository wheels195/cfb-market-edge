/**
 * Check cfbd_team_id overlap between events and FBS
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

async function main() {
  // Get event teams with cfbd_team_id
  const { data: homeEvents } = await supabase.from('events').select('home_team_id');
  const { data: awayEvents } = await supabase.from('events').select('away_team_id');

  const eventTeamIds = new Set<string>();
  for (const e of homeEvents || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
  }
  for (const e of awayEvents || []) {
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  const { data: eventTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .in('id', [...eventTeamIds]);

  // Get FBS cfbd_ids
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();

  const fbsCfbdIds = new Set<number>();
  const fbsIdToSchool = new Map<number, string>();
  for (const t of cfbdTeams) {
    fbsCfbdIds.add(t.id);
    fbsIdToSchool.set(t.id, t.school);
  }

  // Compare
  const eventCfbdIds = new Map<number, string>();
  for (const t of eventTeams || []) {
    if (t.cfbd_team_id) {
      const cfbdId = parseInt(t.cfbd_team_id, 10);
      eventCfbdIds.set(cfbdId, t.name);
    }
  }

  const inBoth = [...eventCfbdIds.keys()].filter(id => fbsCfbdIds.has(id));
  const eventOnly = [...eventCfbdIds.keys()].filter(id => !fbsCfbdIds.has(id));
  const fbsOnly = [...fbsCfbdIds].filter(id => !eventCfbdIds.has(id));

  console.log(`Event teams with cfbd_id: ${eventCfbdIds.size}`);
  console.log(`FBS teams: ${fbsCfbdIds.size}`);
  console.log(`\nIn both (FBS ∩ Events): ${inBoth.length}`);
  console.log(`Event-only (FCS/non-FBS): ${eventOnly.length}`);
  console.log(`FBS-only (not in events): ${fbsOnly.length}`);

  // Show FBS teams NOT in events
  console.log('\nFBS teams NOT in events (first 20):');
  for (const id of fbsOnly.slice(0, 20)) {
    console.log(`  ${fbsIdToSchool.get(id)} (cfbd_id=${id})`);
  }

  // Show event teams that ARE FBS
  console.log('\nEvent teams that ARE FBS (sample):');
  for (const id of inBoth.slice(0, 10)) {
    console.log(`  ${eventCfbdIds.get(id)} (cfbd_id=${id}) = ${fbsIdToSchool.get(id)}`);
  }
}

main().catch(console.error);
