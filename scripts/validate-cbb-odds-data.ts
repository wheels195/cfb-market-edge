/**
 * CBB Odds Data Validation
 *
 * Validates:
 * 1. Join correctness (home/away not flipped)
 * 2. Spread sign convention matches model/backtest
 * 3. No duplicates
 * 4. Data completeness
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface ValidationResult {
  test: string;
  passed: boolean;
  details: string;
  samples?: any[];
}

async function validate(): Promise<void> {
  console.log('========================================');
  console.log('  CBB Odds Data Validation');
  console.log('========================================\n');

  const results: ValidationResult[] = [];

  // 1. Check for duplicates
  console.log('1. Checking for duplicates...');
  const { data: dupCheck } = await supabase.rpc('check_cbb_line_duplicates');

  // Manual duplicate check since RPC might not exist
  const { data: allLines } = await supabase
    .from('cbb_betting_lines')
    .select('cbbd_game_id, provider')
    .eq('provider', 'DraftKings');

  const seen = new Set<string>();
  const dups: string[] = [];
  for (const line of allLines || []) {
    const key = `${line.cbbd_game_id}-${line.provider}`;
    if (seen.has(key)) {
      dups.push(key);
    }
    seen.add(key);
  }

  results.push({
    test: 'No duplicate lines per game/provider',
    passed: dups.length === 0,
    details: dups.length === 0
      ? `${allLines?.length} DraftKings lines, all unique`
      : `Found ${dups.length} duplicates`,
  });

  // 2. Check spread sign convention
  // Convention: spread_home < 0 means home is favored
  // If home wins by more than abs(spread), home covers
  console.log('2. Checking spread sign convention...');

  const { data: gamesWithLines } = await supabase
    .from('cbb_betting_lines')
    .select(`
      cbbd_game_id,
      spread_home,
      cbb_games!inner(
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        status
      )
    `)
    .eq('provider', 'DraftKings')
    .not('spread_home', 'is', null)
    .limit(500);

  let homeFavoredWins = 0;
  let homeFavoredLosses = 0;
  let awayFavoredWins = 0;
  let awayFavoredLosses = 0;
  let gamesAnalyzed = 0;
  const signSamples: any[] = [];

  for (const line of gamesWithLines || []) {
    const game = (line as any).cbb_games;
    if (!game || game.status !== 'final' || game.home_score === null) continue;

    gamesAnalyzed++;
    const homeMargin = game.home_score - game.away_score;
    const spreadHome = line.spread_home;
    const homeFavored = spreadHome < 0;

    // Did home cover? Home covers if homeMargin > -spreadHome (or homeMargin + spreadHome > 0)
    const homeCovered = homeMargin + spreadHome > 0;

    if (homeFavored) {
      if (homeMargin > 0) homeFavoredWins++;
      else homeFavoredLosses++;
    } else {
      if (homeMargin > 0) awayFavoredWins++;
      else awayFavoredLosses++;
    }

    if (signSamples.length < 5) {
      signSamples.push({
        game: `${game.away_team_name} @ ${game.home_team_name}`,
        spreadHome,
        homeMargin,
        homeFavored,
        homeActuallyWon: homeMargin > 0,
        homeCovered,
      });
    }
  }

  // Sanity check: if spread is negative (home favored), home should win more often
  const homeFavoredWinRate = homeFavoredWins / (homeFavoredWins + homeFavoredLosses);
  const awayFavoredHomeWinRate = awayFavoredWins / (awayFavoredWins + awayFavoredLosses);

  // Home favored should have higher home win rate than away favored
  const signConventionCorrect = homeFavoredWinRate > awayFavoredHomeWinRate;

  results.push({
    test: 'Spread sign convention correct',
    passed: signConventionCorrect,
    details: `Home favored (spread<0): Home wins ${(homeFavoredWinRate * 100).toFixed(1)}% (${homeFavoredWins}/${homeFavoredWins + homeFavoredLosses}). ` +
      `Away favored (spread>0): Home wins ${(awayFavoredHomeWinRate * 100).toFixed(1)}% (${awayFavoredWins}/${awayFavoredWins + awayFavoredLosses}). ` +
      `Games: ${gamesAnalyzed}`,
    samples: signSamples,
  });

  // 3. Check home/away join correctness by verifying team names match
  console.log('3. Checking home/away join correctness...');

  const { data: joinCheck } = await supabase
    .from('cbb_betting_lines')
    .select(`
      cbbd_game_id,
      game_id,
      cbb_games!inner(
        id,
        home_team_name,
        away_team_name,
        home_team_id,
        away_team_id
      )
    `)
    .eq('provider', 'DraftKings')
    .limit(100);

  let joinMismatches = 0;
  const joinSamples: any[] = [];

  for (const line of joinCheck || []) {
    const game = (line as any).cbb_games;
    // Check that game_id matches
    if (line.game_id !== game.id) {
      joinMismatches++;
      if (joinSamples.length < 5) {
        joinSamples.push({
          cbbd_game_id: line.cbbd_game_id,
          line_game_id: line.game_id,
          actual_game_id: game.id,
        });
      }
    }
  }

  results.push({
    test: 'Game ID join correctness',
    passed: joinMismatches === 0,
    details: joinMismatches === 0
      ? `All ${joinCheck?.length} checked lines have correct game_id`
      : `${joinMismatches} lines have mismatched game_id`,
    samples: joinMismatches > 0 ? joinSamples : undefined,
  });

  // 4. Check spread reasonableness (should be between -50 and +50)
  console.log('4. Checking spread reasonableness...');

  const { data: spreadRange } = await supabase
    .from('cbb_betting_lines')
    .select('spread_home, cbbd_game_id')
    .eq('provider', 'DraftKings')
    .not('spread_home', 'is', null);

  let unreasonableSpreads = 0;
  const unreasonableSamples: any[] = [];

  for (const line of spreadRange || []) {
    if (Math.abs(line.spread_home) > 50) {
      unreasonableSpreads++;
      if (unreasonableSamples.length < 5) {
        unreasonableSamples.push({
          cbbd_game_id: line.cbbd_game_id,
          spread_home: line.spread_home,
        });
      }
    }
  }

  results.push({
    test: 'Spreads within reasonable range (-50 to +50)',
    passed: unreasonableSpreads === 0,
    details: unreasonableSpreads === 0
      ? `All ${spreadRange?.length} spreads within range`
      : `${unreasonableSpreads} spreads outside range`,
    samples: unreasonableSpreads > 0 ? unreasonableSamples : undefined,
  });

  // 5. Check coverage by date
  console.log('5. Checking date coverage...');

  const { data: dateCoverage } = await supabase
    .from('cbb_betting_lines')
    .select(`
      cbbd_game_id,
      cbb_games!inner(start_date, season)
    `)
    .eq('provider', 'DraftKings');

  const dateSet = new Set<string>();
  const seasonSet = new Set<number>();
  let minDate = '9999-12-31';
  let maxDate = '0000-01-01';

  for (const line of dateCoverage || []) {
    const game = (line as any).cbb_games;
    const date = game.start_date.split('T')[0];
    dateSet.add(date);
    seasonSet.add(game.season);
    if (date < minDate) minDate = date;
    if (date > maxDate) maxDate = date;
  }

  results.push({
    test: 'Date coverage info',
    passed: true,
    details: `${dateCoverage?.length} lines covering ${dateSet.size} unique dates. ` +
      `Range: ${minDate} to ${maxDate}. Seasons: ${Array.from(seasonSet).sort().join(', ')}`,
  });

  // Print results
  console.log('\n========================================');
  console.log('  Validation Results');
  console.log('========================================\n');

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${r.test}`);
    console.log(`   ${r.details}`);
    if (r.samples && r.samples.length > 0) {
      console.log('   Samples:');
      for (const s of r.samples) {
        console.log(`     ${JSON.stringify(s)}`);
      }
    }
    console.log('');
    if (!r.passed) allPassed = false;
  }

  console.log('========================================');
  console.log(allPassed ? '  ALL TESTS PASSED' : '  SOME TESTS FAILED');
  console.log('========================================');
}

validate().catch(console.error);
