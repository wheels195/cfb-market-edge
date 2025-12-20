/**
 * Sync 2021 SP+ ratings from CFBD to advanced_team_ratings
 *
 * This fills the gap for using 2021 SP+ as point-in-time data for 2022 games
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

interface CFBDSPRating {
  year: number;
  team: string;
  conference: string;
  rating: number;
  ranking: number;
  offense: {
    ranking: number;
    rating: number;
  };
  defense: {
    ranking: number;
    rating: number;
  };
}

async function getAllTeams(): Promise<Map<string, string>> {
  // Use same logic as sync-advanced-ratings.ts - match on teams.name
  const teamMap = new Map<string, string>();
  let offset = 0;

  while (true) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .range(offset, offset + 999);

    if (!teams || teams.length === 0) break;
    for (const t of teams) {
      teamMap.set(t.name, t.id);
    }
    offset += teams.length;
    if (teams.length < 1000) break;
  }

  return teamMap;
}

async function main() {
  console.log('=== Syncing 2021 SP+ Ratings ===\n');

  // Get all teams first (same as sync-advanced-ratings.ts)
  console.log('Loading teams...');
  const teamMap = await getAllTeams();
  console.log(`Found ${teamMap.size} teams`);

  // Fetch from CFBD
  const resp = await fetch(`https://apinext.collegefootballdata.com/ratings/sp?year=2021`, {
    headers: { 'Authorization': `Bearer ${CFBD_API_KEY}` }
  });

  if (!resp.ok) {
    console.error('CFBD API error:', resp.status);
    return;
  }

  const spRatings: CFBDSPRating[] = await resp.json();
  console.log(`Fetched ${spRatings.length} SP+ ratings from CFBD`);

  // Check existing 2021 data
  const { count: existing } = await supabase
    .from('advanced_team_ratings')
    .select('*', { count: 'exact', head: true })
    .eq('season', 2021)
    .not('sp_overall', 'is', null);

  console.log(`Existing 2021 SP+ entries: ${existing}`);

  // Map team names to team_ids and prepare inserts
  const rows: Array<{
    team_id: string;
    season: number;
    sp_overall: number;
    sp_offense: number;
    sp_defense: number;
  }> = [];

  let matched = 0;
  const unmatched: string[] = [];

  for (const sp of spRatings) {
    // Skip nationalAverages
    if (sp.team === 'nationalAverages') continue;

    const teamId = teamMap.get(sp.team);

    if (teamId) {
      rows.push({
        team_id: teamId,
        season: 2021,
        sp_overall: sp.rating,
        sp_offense: sp.offense?.rating || 0,
        sp_defense: sp.defense?.rating || 0,
      });
      matched++;
    } else {
      unmatched.push(sp.team);
    }
  }

  console.log(`\nMatched: ${matched}, Unmatched: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log('Unmatched teams:', unmatched.slice(0, 10).join(', '));
  }

  // Upsert to advanced_team_ratings
  if (rows.length > 0) {
    // Upsert (insert or update on conflict)
    const { error } = await supabase
      .from('advanced_team_ratings')
      .upsert(rows, { onConflict: 'team_id,season' });

    if (error) {
      console.error('Upsert error:', error.message);
    } else {
      console.log(`\nUpserted ${rows.length} 2021 SP+ ratings`);
    }
  }

  // Verify
  const { count: final } = await supabase
    .from('advanced_team_ratings')
    .select('*', { count: 'exact', head: true })
    .eq('season', 2021)
    .not('sp_overall', 'is', null);

  console.log(`\nFinal 2021 SP+ count: ${final}`);

  // Show sample
  const { data: sample } = await supabase
    .from('advanced_team_ratings')
    .select(`
      team_id,
      season,
      sp_overall,
      sp_offense,
      sp_defense,
      teams!inner(name)
    `)
    .eq('season', 2021)
    .not('sp_overall', 'is', null)
    .order('sp_overall', { ascending: false })
    .limit(5);

  console.log('\nTop 5 2021 SP+ entries:');
  for (const s of sample || []) {
    const teams = s.teams as { name: string }[] | null;
    const teamName = teams?.[0]?.name || 'Unknown';
    console.log(`  ${teamName}: ${s.sp_overall?.toFixed(1)} (Off: ${s.sp_offense?.toFixed(1)}, Def: ${s.sp_defense?.toFixed(1)})`);
  }
}

main().catch(console.error);
