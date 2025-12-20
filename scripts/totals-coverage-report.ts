/**
 * Totals V1 Coverage Report
 *
 * Checks data availability for:
 * - SP+ ratings (season-level from advanced_team_ratings)
 * - Pace data (from team_advanced_stats)
 * - Historical totals (from cfbd_betting_lines)
 *
 * Step 1 of Totals V1 implementation
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface CoverageStats {
  season: number;
  totalGames: number;
  gamesWithTotals: number;
  gamesWithSP: number;
  gamesWithPace: number;
  coveragePercent: {
    totals: number;
    sp: number;
    pace: number;
  };
}

async function checkSPCoverage(): Promise<void> {
  console.log('\n=== SP+ RATINGS COVERAGE ===\n');

  // Check advanced_team_ratings table for SP+ data
  const { data: spData, error: spError } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall, sp_offense, sp_defense')
    .not('sp_overall', 'is', null)
    .order('season', { ascending: true });

  if (spError) {
    console.error('Error fetching SP+ data:', spError);
    return;
  }

  // Group by season
  const bySeason = new Map<number, number>();
  for (const row of spData || []) {
    const count = bySeason.get(row.season) || 0;
    bySeason.set(row.season, count + 1);
  }

  console.log('Teams with SP+ ratings by season:');
  for (const [season, count] of Array.from(bySeason.entries()).sort()) {
    console.log(`  ${season}: ${count} teams`);
  }

  // Show sample SP+ values
  console.log('\nSample SP+ values (2024):');
  const sample2024 = (spData || [])
    .filter(r => r.season === 2024)
    .slice(0, 5);
  for (const row of sample2024) {
    console.log(`  Team ${row.team_id}: Overall=${row.sp_overall?.toFixed(1)}, Off=${row.sp_offense?.toFixed(1)}, Def=${row.sp_defense?.toFixed(1)}`);
  }
}

async function checkPaceCoverage(): Promise<void> {
  console.log('\n=== PACE DATA COVERAGE ===\n');

  // Check team_advanced_stats table for pace data
  const { data: paceData, error: paceError } = await supabase
    .from('team_advanced_stats')
    .select('team_id, season, plays_per_game, pace_rank')
    .not('plays_per_game', 'is', null)
    .order('season', { ascending: true });

  if (paceError) {
    console.error('Error fetching pace data:', paceError);
    return;
  }

  // Group by season
  const bySeason = new Map<number, number>();
  for (const row of paceData || []) {
    const count = bySeason.get(row.season) || 0;
    bySeason.set(row.season, count + 1);
  }

  console.log('Teams with pace data by season:');
  for (const [season, count] of Array.from(bySeason.entries()).sort()) {
    console.log(`  ${season}: ${count} teams`);
  }

  // Show sample pace values
  console.log('\nSample pace values (2024):');
  const sample2024 = (paceData || [])
    .filter(r => r.season === 2024)
    .sort((a, b) => (b.plays_per_game || 0) - (a.plays_per_game || 0))
    .slice(0, 5);
  for (const row of sample2024) {
    console.log(`  Team ${row.team_id}: ${row.plays_per_game?.toFixed(1)} plays/game (rank ${row.pace_rank})`);
  }
}

async function checkTotalsCoverage(): Promise<void> {
  console.log('\n=== HISTORICAL TOTALS COVERAGE ===\n');

  // Check cfbd_betting_lines for totals data
  const { data: totalsData, error: totalsError } = await supabase
    .from('cfbd_betting_lines')
    .select('cfbd_game_id, season, week, total_open, total_close, home_score, away_score')
    .order('season', { ascending: true })
    .order('week', { ascending: true });

  if (totalsError) {
    console.error('Error fetching totals data:', totalsError);
    return;
  }

  // Analyze by season
  const statsBySeason = new Map<number, {
    total: number;
    withOpen: number;
    withClose: number;
    withScores: number;
  }>();

  for (const row of totalsData || []) {
    const stats = statsBySeason.get(row.season) || {
      total: 0,
      withOpen: 0,
      withClose: 0,
      withScores: 0,
    };

    stats.total++;
    if (row.total_open !== null) stats.withOpen++;
    if (row.total_close !== null) stats.withClose++;
    if (row.home_score !== null && row.away_score !== null) stats.withScores++;

    statsBySeason.set(row.season, stats);
  }

  console.log('Games with totals data by season:');
  console.log('Season | Total Games | With Open | With Close | With Scores');
  console.log('-------|-------------|-----------|------------|------------');
  for (const [season, stats] of Array.from(statsBySeason.entries()).sort()) {
    console.log(
      `${season}   | ${stats.total.toString().padStart(11)} | ` +
      `${stats.withOpen.toString().padStart(9)} | ` +
      `${stats.withClose.toString().padStart(10)} | ` +
      `${stats.withScores.toString().padStart(10)}`
    );
  }

  // Show sample totals
  console.log('\nSample totals data (2024):');
  const sample2024 = (totalsData || [])
    .filter(r => r.season === 2024 && r.total_open !== null)
    .slice(0, 5);
  for (const row of sample2024) {
    const actualTotal = row.home_score !== null && row.away_score !== null
      ? row.home_score + row.away_score
      : null;
    console.log(
      `  Week ${row.week}: Open=${row.total_open}, Close=${row.total_close}, Actual=${actualTotal}`
    );
  }
}

async function checkWeeklyDataAvailability(): Promise<void> {
  console.log('\n=== WEEKLY DATA AVAILABILITY (2022-2024) ===\n');
  console.log('Checking if we have week-by-week SP+ and pace data...\n');

  // Check for weekly snapshots tables
  const tables = ['sp_weekly_snapshots', 'pace_weekly_snapshots', 'team_stats_snapshots'];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        console.log(`❌ Table '${table}' does not exist`);
      } else {
        console.log(`⚠️ Table '${table}' error: ${error.message}`);
      }
    } else {
      console.log(`✅ Table '${table}' exists`);

      // Get count by season/week
      const { data: countData } = await supabase
        .from(table)
        .select('season, week', { count: 'exact' });

      if (countData) {
        console.log(`   ${countData.length} rows found`);
      }
    }
  }

  // Check team_elo_snapshots as reference for what weekly data looks like
  console.log('\nReference: team_elo_snapshots (existing weekly data):');
  const { data: eloData, error: eloError } = await supabase
    .from('team_elo_snapshots')
    .select('season, week')
    .order('season')
    .order('week');

  if (!eloError && eloData) {
    const uniqueWeeks = new Set(eloData.map(r => `${r.season}-W${r.week}`));
    const bySeason = new Map<number, Set<number>>();
    for (const row of eloData) {
      if (!bySeason.has(row.season)) bySeason.set(row.season, new Set());
      bySeason.get(row.season)!.add(row.week);
    }

    for (const [season, weeks] of Array.from(bySeason.entries()).sort()) {
      console.log(`  ${season}: Weeks ${Math.min(...weeks)}-${Math.max(...weeks)} (${weeks.size} weeks)`);
    }
  }
}

async function checkJoinability(): Promise<void> {
  console.log('\n=== JOIN CAPABILITY CHECK ===\n');
  console.log('Testing if we can join games with SP+, pace, and totals...\n');

  // Get a sample of games from cfbd_betting_lines
  const { data: games, error: gamesError } = await supabase
    .from('cfbd_betting_lines')
    .select(`
      cfbd_game_id,
      season,
      week,
      total_open,
      total_close,
      home_score,
      away_score
    `)
    .eq('season', 2024)
    .not('total_open', 'is', null)
    .limit(10);

  if (gamesError) {
    console.error('Error fetching games:', gamesError);
    return;
  }

  console.log(`Found ${games?.length || 0} games with totals in 2024`);

  // Note: We need to figure out how to join with teams
  // The cfbd_betting_lines table likely has team names, not team_ids
  console.log('\nNote: To complete the join, we need to:');
  console.log('1. Identify how cfbd_betting_lines links to teams (team names or IDs)');
  console.log('2. Create weekly SP+ snapshots from season-level data OR use preseason values');
  console.log('3. Create weekly pace snapshots from game_advanced_stats');
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║    TOTALS V1 DATA COVERAGE REPORT      ║');
  console.log('╚════════════════════════════════════════╝');

  await checkSPCoverage();
  await checkPaceCoverage();
  await checkTotalsCoverage();
  await checkWeeklyDataAvailability();
  await checkJoinability();

  console.log('\n=== SUMMARY ===\n');
  console.log('Next steps:');
  console.log('1. Create sp_weekly_snapshots table (or verify if we can use season-level SP+)');
  console.log('2. Create pace_weekly_snapshots table from game_advanced_stats');
  console.log('3. Build join query to combine games + totals + SP+ + pace');
  console.log('4. Verify point-in-time semantics (week N-1 data for week N games)');
}

main().catch(console.error);
