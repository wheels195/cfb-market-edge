/**
 * Check what CFB games need T-60 sync
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CFB T-60 Sync Requirements ===\n');

  // Check cfbd_betting_lines full coverage by season
  const { data: allGames } = await supabase
    .from('cfbd_betting_lines')
    .select('season, week, spread_close, home_score')
    .not('home_score', 'is', null);

  const bySeason: Record<number, { total: number; withClose: number }> = {};
  for (const g of allGames || []) {
    if (!bySeason[g.season]) {
      bySeason[g.season] = { total: 0, withClose: 0 };
    }
    bySeason[g.season].total++;
    if (g.spread_close !== null) {
      bySeason[g.season].withClose++;
    }
  }

  console.log('cfbd_betting_lines by season (games with scores):');
  let totalGames = 0;
  let totalWithClose = 0;
  for (const s of Object.keys(bySeason).sort()) {
    const stats = bySeason[Number(s)];
    console.log(`  Season ${s}: ${stats.total} games, ${stats.withClose} with close spread`);
    totalGames += stats.total;
    totalWithClose += stats.withClose;
  }
  console.log(`  Total: ${totalGames} games, ${totalWithClose} with close`);

  // Check columns
  const { data: sample } = await supabase
    .from('cfbd_betting_lines')
    .select('*')
    .limit(1);

  console.log('\ncfbd_betting_lines columns:');
  if (sample?.[0]) {
    console.log('  ' + Object.keys(sample[0]).join(', '));
  }

  // Check if there's a T-60 column already
  const hasT60 = sample?.[0] && 'spread_t60' in sample[0];
  console.log(`\nHas spread_t60 column: ${hasT60}`);

  // Calculate API cost estimate
  // Need to query by date, ~8 dates per week, ~15 weeks per season, 3 seasons
  const estimatedDates = 15 * 8 * 3; // ~360 unique dates
  const estimatedCredits = estimatedDates * 10; // 10 credits per historical call

  console.log('\n=== Sync Estimate ===');
  console.log(`Games needing T-60: ${totalWithClose} (games with close spread)`);
  console.log(`Estimated unique dates: ~${estimatedDates}`);
  console.log(`Estimated API credits: ~${estimatedCredits}`);

  // Check unique dates in the data
  const { data: dateData } = await supabase
    .from('cfbd_betting_lines')
    .select('season, week')
    .not('spread_close', 'is', null)
    .not('home_score', 'is', null);

  const uniqueSeasonWeeks = new Set<string>();
  for (const row of dateData || []) {
    uniqueSeasonWeeks.add(`${row.season}-W${row.week}`);
  }

  console.log(`\nActual unique season-weeks with close spreads: ${uniqueSeasonWeeks.size}`);

  // We need game start times to calculate T-60
  // Check if we have that data
  console.log('\n=== Data Requirements ===');
  console.log('To sync T-60, we need:');
  console.log('1. Game start times (kickoff) for each game');
  console.log('2. Team name mapping to match Odds API responses');
  console.log('3. Historical Odds API queries at T-60 before each kickoff');
}

main().catch(console.error);
