/**
 * Check team name matching across data sources
 *
 * Data Pipeline Architecture:
 *
 * UPSTREAM (Data Sources):
 * 1. CFBD API → teams.name (sync-advanced-ratings.ts, sync-sp-2021.ts)
 *    - Uses names like "Georgia", "Ohio State", "Miami (OH)"
 *    - This is our canonical source for CFBD data
 *
 * 2. CFBD Betting Lines → cfbd_betting_lines.home_team/away_team
 *    - Team names stored as strings (not team_ids)
 *    - Should match teams.name if synced from same source
 *
 * 3. Odds API → odds_api_team_name or different mapping
 *    - Uses names like "Georgia Bulldogs", "Ohio State Buckeyes"
 *    - Needs different mapping for live odds
 *
 * DOWNSTREAM (Joins):
 * - Totals backtest: cfbd_betting_lines.home_team → teams.name → team_id → advanced_team_ratings.team_id
 * - Spreads model: Same pattern
 *
 * KEY QUESTION: Do cfbd_betting_lines team names match teams.name?
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== TEAM NAME MATCHING ANALYSIS ===\n');

  // 1. Check teams table structure
  console.log('1. TEAMS TABLE STRUCTURE:');
  const { data: teamSample } = await supabase.from('teams').select('*').limit(3);
  if (teamSample && teamSample.length > 0) {
    console.log('   Columns:', Object.keys(teamSample[0]).join(', '));
    console.log('   Sample:', teamSample[0].name);
  }

  // 2. Check cfbd_betting_lines team name format
  console.log('\n2. CFBD_BETTING_LINES TEAM NAMES:');
  const { data: lines } = await supabase
    .from('cfbd_betting_lines')
    .select('home_team, away_team')
    .eq('season', 2023)
    .limit(10);

  console.log('   Sample matchups:');
  for (const l of lines || []) {
    console.log(`     ${l.away_team} @ ${l.home_team}`);
  }

  // 3. Test name matching
  console.log('\n3. NAME MATCHING TEST (2023 season):');

  // Get all unique team names from betting lines
  const { data: allLines } = await supabase
    .from('cfbd_betting_lines')
    .select('home_team, away_team')
    .eq('season', 2023);

  const lineTeams = new Set<string>();
  for (const l of allLines || []) {
    lineTeams.add(l.home_team);
    lineTeams.add(l.away_team);
  }

  // Get all team names from teams table
  const { data: allTeams } = await supabase.from('teams').select('name');
  const dbTeams = new Set((allTeams || []).map(t => t.name));

  // Find matches and mismatches
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const team of lineTeams) {
    if (dbTeams.has(team)) {
      matched.push(team);
    } else {
      unmatched.push(team);
    }
  }

  console.log(`   Unique teams in betting lines: ${lineTeams.size}`);
  console.log(`   Matched to teams table: ${matched.length}`);
  console.log(`   Unmatched: ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log('\n   UNMATCHED TEAMS:');
    for (const t of unmatched.sort()) {
      console.log(`     - "${t}"`);
    }
  }

  // 4. Check if advanced_team_ratings uses same team_ids
  console.log('\n4. ADVANCED_TEAM_RATINGS CONNECTION:');
  const { count: ratingsCount } = await supabase
    .from('advanced_team_ratings')
    .select('*', { count: 'exact', head: true })
    .eq('season', 2023)
    .not('sp_overall', 'is', null);

  console.log(`   2023 SP+ entries: ${ratingsCount}`);

  // Sample join test
  const testTeam = matched[0];
  const { data: testLookup } = await supabase
    .from('teams')
    .select('id, name')
    .eq('name', testTeam)
    .single();

  if (testLookup) {
    const { data: spLookup } = await supabase
      .from('advanced_team_ratings')
      .select('sp_overall, sp_offense, sp_defense')
      .eq('team_id', testLookup.id)
      .eq('season', 2022) // Prior year for point-in-time
      .single();

    console.log(`   Test: "${testTeam}" → team_id: ${testLookup.id.substring(0, 8)}...`);
    console.log(`   2022 SP+ (for 2023 games): ${spLookup ? 'Found' : 'NOT FOUND'}`);
    if (spLookup) {
      console.log(`     Overall: ${spLookup.sp_overall}, Off: ${spLookup.sp_offense}, Def: ${spLookup.sp_defense}`);
    }
  }

  // 5. Summary and implications
  console.log('\n=== IMPLICATIONS FOR TOTALS MODEL ===');
  console.log(`
  Data Pipeline:
  cfbd_betting_lines.home_team → teams.name → team_id → advanced_team_ratings.team_id
                                                     ↓
                               (JOIN on prior season for point-in-time SP+)

  Current Status:
  - ${matched.length}/${lineTeams.size} teams in betting lines match teams table
  - ${unmatched.length} teams need mapping or will be excluded from backtest

  Impact:
  - Games with unmatched teams will have NULL SP+ data
  - Backtest coverage depends on team name matching
  `);

  if (unmatched.length > 0) {
    console.log('  ACTION REQUIRED: Add mappings for unmatched teams or verify spelling');
  } else {
    console.log('  ✓ All team names match - pipeline is connected');
  }
}

main().catch(console.error);
