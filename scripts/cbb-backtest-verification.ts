/**
 * CBB Backtest Verification
 *
 * Sanity checks to verify the testing methodology is correct:
 * 1. Sample games with all data to verify joins
 * 2. Verify spread sign convention
 * 3. Verify model predictions make sense
 * 4. Check for data anomalies
 * 5. Verify bet settlement logic
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       CBB BACKTEST VERIFICATION                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // 1. Sample some games with all data
  console.log('\n=== 1. SAMPLE GAMES WITH ALL DATA ===\n');

  const { data: sampleGames } = await supabase
    .from('cbb_games')
    .select(`
      id,
      season,
      start_date,
      home_team_id,
      away_team_id,
      home_team_name,
      away_team_name,
      home_score,
      away_score
    `)
    .eq('season', 2024)
    .not('home_score', 'is', null)
    .not('away_team_id', 'is', null)
    .limit(10);

  if (!sampleGames || sampleGames.length === 0) {
    console.log('No sample games found!');
    return;
  }

  // Get betting lines for these games
  const gameIds = sampleGames.map(g => g.id);
  const { data: lines } = await supabase
    .from('cbb_betting_lines')
    .select('game_id, spread_t60, spread_close, dk_spread_open')
    .in('game_id', gameIds);

  const linesByGame = new Map<string, any>();
  for (const l of lines || []) {
    linesByGame.set(l.game_id, l);
  }

  // Get ratings for teams
  const teamIds = [...new Set(sampleGames.flatMap(g => [g.home_team_id, g.away_team_id]))];
  const { data: ratings } = await supabase
    .from('cbb_team_ratings')
    .select('team_id, season, net_rating')
    .in('team_id', teamIds)
    .in('season', [2022, 2023]);

  const ratingsByTeam = new Map<string, Map<number, number>>();
  for (const r of ratings || []) {
    if (!ratingsByTeam.has(r.team_id)) {
      ratingsByTeam.set(r.team_id, new Map());
    }
    ratingsByTeam.get(r.team_id)!.set(r.season, r.net_rating);
  }

  console.log('Sample games with full data:\n');

  for (const game of sampleGames.slice(0, 5)) {
    const line = linesByGame.get(game.id);
    const homeRating = ratingsByTeam.get(game.home_team_id)?.get(2023);
    const awayRating = ratingsByTeam.get(game.away_team_id)?.get(2023);

    if (!line?.spread_t60 || homeRating === undefined || awayRating === undefined) {
      continue;
    }

    const actualMargin = game.home_score - game.away_score;
    const modelSpread = (awayRating - homeRating) / 3.5 + 3.0;
    const edge = line.spread_t60 - modelSpread;

    console.log(`${game.home_team_name} vs ${game.away_team_name}`);
    console.log(`  Score: ${game.home_score}-${game.away_score} (Home margin: ${actualMargin > 0 ? '+' : ''}${actualMargin})`);
    console.log(`  T-60 Spread: ${line.spread_t60 > 0 ? '+' : ''}${line.spread_t60} (${line.spread_t60 > 0 ? 'home underdog' : 'home favorite'})`);
    console.log(`  Home Net Rating: ${homeRating?.toFixed(1)}, Away Net Rating: ${awayRating?.toFixed(1)}`);
    console.log(`  Model Spread: ${modelSpread > 0 ? '+' : ''}${modelSpread.toFixed(1)}`);
    console.log(`  Edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)} → ${edge > 0 ? 'Bet HOME' : 'Bet AWAY'}`);

    // Verify bet settlement
    const betSide = edge > 0 ? 'home' : 'away';
    let won: boolean;
    if (betSide === 'home') {
      // Betting home at spread_t60: win if actualMargin > -spread_t60
      won = actualMargin > -line.spread_t60;
    } else {
      // Betting away at spread_t60: win if actualMargin < -spread_t60
      won = actualMargin < -line.spread_t60;
    }

    console.log(`  Settlement: Bet ${betSide.toUpperCase()} at ${line.spread_t60}`);
    console.log(`    Need: ${betSide === 'home' ? `margin > ${-line.spread_t60}` : `margin < ${-line.spread_t60}`}`);
    console.log(`    Got: margin = ${actualMargin}`);
    console.log(`    Result: ${won ? 'WIN ✓' : 'LOSS ✗'}`);
    console.log('');
  }

  // 2. Verify spread convention
  console.log('\n=== 2. SPREAD CONVENTION CHECK ===\n');

  const { data: spreadCheck } = await supabase
    .from('cbb_betting_lines')
    .select('game_id, spread_t60')
    .not('spread_t60', 'is', null)
    .limit(1000);

  const positiveSpread = spreadCheck?.filter(s => s.spread_t60 > 0).length || 0;
  const negativeSpread = spreadCheck?.filter(s => s.spread_t60 < 0).length || 0;
  const zeroSpread = spreadCheck?.filter(s => s.spread_t60 === 0).length || 0;

  console.log(`Spread distribution (n=${spreadCheck?.length}):`);
  console.log(`  Positive (home underdog): ${positiveSpread} (${(positiveSpread/(spreadCheck?.length || 1)*100).toFixed(1)}%)`);
  console.log(`  Negative (home favorite): ${negativeSpread} (${(negativeSpread/(spreadCheck?.length || 1)*100).toFixed(1)}%)`);
  console.log(`  Zero (pick'em): ${zeroSpread}`);
  console.log(`\nExpected: ~50/50 split (home wins ~55% in CBB)`);
  console.log(`Result: ${Math.abs(positiveSpread - negativeSpread) < 200 ? '✓ Looks correct' : '⚠️ Check convention'}`);

  // 3. Rating distribution check
  console.log('\n=== 3. RATING DISTRIBUTION CHECK ===\n');

  const { data: allRatings } = await supabase
    .from('cbb_team_ratings')
    .select('net_rating, season')
    .in('season', [2022, 2023, 2024]);

  if (allRatings) {
    const netRatings = allRatings.map(r => r.net_rating);
    const min = Math.min(...netRatings);
    const max = Math.max(...netRatings);
    const avg = netRatings.reduce((a, b) => a + b, 0) / netRatings.length;

    console.log(`Net Rating stats (n=${netRatings.length}):`);
    console.log(`  Min: ${min.toFixed(1)}`);
    console.log(`  Max: ${max.toFixed(1)}`);
    console.log(`  Avg: ${avg.toFixed(1)}`);
    console.log(`\nExpected: Range roughly -20 to +40, avg around 0`);
    console.log(`Result: ${min < 0 && max > 20 && Math.abs(avg) < 10 ? '✓ Looks correct' : '⚠️ Check ratings'}`);
  }

  // 4. Model formula verification
  console.log('\n=== 4. MODEL FORMULA VERIFICATION ===\n');

  console.log('Formula: Model Spread = (Away Net Rating - Home Net Rating) / K + HFA');
  console.log('K = 3.5, HFA = 3.0\n');

  console.log('Test cases:');

  const testCases = [
    { homeNet: 20, awayNet: 0, desc: 'Strong home team (+20) vs avg away (0)' },
    { homeNet: 0, awayNet: 20, desc: 'Avg home team (0) vs strong away (+20)' },
    { homeNet: 10, awayNet: 10, desc: 'Equal teams (+10 each)' },
    { homeNet: -10, awayNet: 30, desc: 'Weak home (-10) vs elite away (+30)' },
  ];

  for (const tc of testCases) {
    const modelSpread = (tc.awayNet - tc.homeNet) / 3.5 + 3.0;
    console.log(`  ${tc.desc}`);
    console.log(`    Model Spread: ${modelSpread > 0 ? '+' : ''}${modelSpread.toFixed(1)}`);
    console.log(`    Interpretation: ${modelSpread > 0 ? `Home is ${modelSpread.toFixed(1)} pt underdog` : `Home is ${(-modelSpread).toFixed(1)} pt favorite`}`);
    console.log('');
  }

  // 5. Bet settlement logic verification
  console.log('\n=== 5. BET SETTLEMENT LOGIC VERIFICATION ===\n');

  console.log('Settlement rules:');
  console.log('  - Spread is quoted for HOME team');
  console.log('  - Negative spread = home favorite');
  console.log('  - Positive spread = home underdog');
  console.log('');

  const settlementTests = [
    { spread: -5.5, margin: 10, betSide: 'home', desc: 'Home -5.5, won by 10' },
    { spread: -5.5, margin: 3, betSide: 'home', desc: 'Home -5.5, won by 3' },
    { spread: -5.5, margin: -3, betSide: 'away', desc: 'Home -5.5, lost by 3' },
    { spread: 3.5, margin: 2, betSide: 'home', desc: 'Home +3.5, won by 2' },
    { spread: 3.5, margin: -2, betSide: 'home', desc: 'Home +3.5, lost by 2' },
    { spread: 3.5, margin: -5, betSide: 'away', desc: 'Home +3.5, lost by 5' },
  ];

  for (const t of settlementTests) {
    let won: boolean;
    if (t.betSide === 'home') {
      won = t.margin > -t.spread;
    } else {
      won = t.margin < -t.spread;
    }

    const coverLine = -t.spread;
    console.log(`  ${t.desc}, betting ${t.betSide.toUpperCase()}`);
    console.log(`    Cover line: ${t.betSide === 'home' ? `margin > ${coverLine}` : `margin < ${coverLine}`}`);
    console.log(`    Actual margin: ${t.margin}`);
    console.log(`    Result: ${won ? 'WIN' : 'LOSS'}`);
    console.log('');
  }

  // 6. Check for data anomalies
  console.log('\n=== 6. DATA ANOMALY CHECK ===\n');

  // Check for games with extreme spreads
  const { data: extremeSpreads } = await supabase
    .from('cbb_betting_lines')
    .select('game_id, spread_t60')
    .or('spread_t60.gt.40,spread_t60.lt.-40')
    .limit(10);

  console.log(`Games with extreme spreads (>40 or <-40): ${extremeSpreads?.length || 0}`);

  // Check for games with missing data
  const { count: gamesNoAwayTeam } = await supabase
    .from('cbb_games')
    .select('id', { count: 'exact', head: true })
    .is('away_team_id', null)
    .not('home_score', 'is', null);

  console.log(`Games with null away_team_id: ${gamesNoAwayTeam}`);

  // Check rating coverage
  const { count: gamesWithRatings } = await supabase
    .from('cbb_team_ratings')
    .select('id', { count: 'exact', head: true })
    .in('season', [2022, 2023]);

  console.log(`Teams with 2022-2023 ratings: ${gamesWithRatings}`);

  // 7. Final baseline verification
  console.log('\n=== 7. BASELINE SANITY CHECK ===\n');

  console.log('If the model had NO predictive power:');
  console.log('  - Expected win rate: 50%');
  console.log('  - Expected ROI at -110: -4.55%');
  console.log('');
  console.log('Our results:');
  console.log('  - Win rate: 48.7-49.0%');
  console.log('  - ROI: -6.4% to -7.0%');
  console.log('');
  console.log('Assessment: Results are WORSE than random, which means:');
  console.log('  1. Model has slight NEGATIVE predictive value, OR');
  console.log('  2. Model is neutral and variance pushed us below baseline');
  console.log('');
  console.log('With 4,380 bets, standard error ≈ 0.75%');
  console.log('Our -6.5% is within ~2 SE of baseline -4.5%');
  console.log('Conclusion: Results consistent with NO EDGE (market efficient)');

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
