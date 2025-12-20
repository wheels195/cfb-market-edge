/**
 * Totals V1 Model Summary and Final Evaluation
 *
 * Consolidates findings from Phase 2 tests and runs final holdout evaluation.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TotalsGame {
  season: number;
  week: number;
  total_open: number;
  actual_total: number;
  sp_sum: number | null;
}

async function getGames(seasons: number[]): Promise<TotalsGame[]> {
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

  // SP+ by season
  const spBySeason = new Map<number, Map<string, { off: number; def: number }>>();
  for (const season of [2021, 2022, 2023]) {
    const { data } = await supabase
      .from('advanced_team_ratings')
      .select('team_id, sp_offense, sp_defense')
      .eq('season', season)
      .not('sp_overall', 'is', null);

    const spMap = new Map<string, { off: number; def: number }>();
    for (const row of data || []) {
      spMap.set(row.team_id, { off: row.sp_offense || 0, def: row.sp_defense || 0 });
    }
    spBySeason.set(season, spMap);
  }

  const games: TotalsGame[] = [];

  for (const season of seasons) {
    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null);

    const priorSP = spBySeason.get(season - 1);

    for (const line of lines || []) {
      const homeId = teamMap.get(line.home_team);
      const awayId = teamMap.get(line.away_team);

      const homeSP = homeId && priorSP ? priorSP.get(homeId) : null;
      const awaySP = awayId && priorSP ? priorSP.get(awayId) : null;

      let spSum: number | null = null;
      if (homeSP && awaySP) {
        spSum = homeSP.off + homeSP.def + awaySP.off + awaySP.def;
      }

      games.push({
        season: line.season,
        week: line.week,
        total_open: line.total_open,
        actual_total: line.home_score + line.away_score,
        sp_sum: spSum,
      });
    }
  }

  return games;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 MODEL SUMMARY AND FINAL EVALUATION                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Summary of Phase 2 findings
  console.log('=== PHASE 2 FINDINGS SUMMARY ===\n');

  console.log('Test 1: Pace-only model');
  console.log('  Result: r = -0.004 (no signal)');
  console.log('  Conclusion: Pace alone does not predict totals deviations\n');

  console.log('Test 2: SP+ × Pace interaction');
  console.log('  Key finding: Low SP+ + High Pace → 59.8% over rate (+2.0 avg delta)');
  console.log('  Key finding: High SP+ + High Pace → 44.6% over rate (-1.3 avg delta)');
  console.log('  Conclusion: Markets overestimate high-SP+ matchups\n');

  console.log('Test 3: Total-range conditioning');
  console.log('  Key finding: Very Low (<40) → 66.7% over rate (small sample)');
  console.log('  Key finding: High (60-65) → 40.6% over rate (+13.3% ROI under)');
  console.log('  Conclusion: High totals overshoot, but range strategies overfit\n');

  console.log('Test 4: Early vs Late season split');
  console.log('  Key finding: SP+ high → under works in both regimes');
  console.log('  Early (1-4): 64.3% win rate, +22.7% ROI (42 bets)');
  console.log('  Late (5+): 57.7% win rate, +10.1% ROI (52 bets)');
  console.log('  Conclusion: High SP+ → Under is the most stable signal\n');

  // Frozen model parameters
  console.log('=== FROZEN MODEL PARAMETERS ===\n');

  const FROZEN_CONFIG = {
    model_name: 'TOTALS_V1',
    frozen_date: new Date().toISOString().split('T')[0],

    // Primary signal: Bet UNDER when combined SP+ is high
    sp_sum_threshold: 130,  // Approximately mean + 1 std
    bet_direction: 'under' as const,

    // No pace component (r ≈ 0)
    use_pace: false,

    // No range conditioning (overfit)
    use_range_bands: false,

    // No seasonal regime (both regimes show same direction)
    use_seasonal_split: false,

    // Edge threshold for production (TBD)
    min_bets_per_week: 1,
  };

  console.log('Config:');
  console.log(`  Model: ${FROZEN_CONFIG.model_name}`);
  console.log(`  Signal: Bet ${FROZEN_CONFIG.bet_direction.toUpperCase()} when SP+ sum > ${FROZEN_CONFIG.sp_sum_threshold}`);
  console.log(`  Use pace: ${FROZEN_CONFIG.use_pace}`);
  console.log(`  Use range bands: ${FROZEN_CONFIG.use_range_bands}`);
  console.log(`  Use seasonal split: ${FROZEN_CONFIG.use_seasonal_split}`);

  // Final holdout evaluation
  console.log('\n=== FINAL 2024 HOLDOUT EVALUATION ===\n');

  const allGames = await getGames([2022, 2023, 2024]);

  const train = allGames.filter(g => g.season !== 2024 && g.sp_sum !== null);
  const test = allGames.filter(g => g.season === 2024 && g.sp_sum !== null);

  console.log(`Train: ${train.length} games (2022-2023 with SP+)`);
  console.log(`Test:  ${test.length} games (2024 with SP+)`);

  // Train results
  const trainEligible = train.filter(g => g.sp_sum! > FROZEN_CONFIG.sp_sum_threshold);
  let trainWins = 0;
  let trainLosses = 0;

  for (const g of trainEligible) {
    // Bet UNDER
    if (g.actual_total < g.total_open) trainWins++;
    else if (g.actual_total > g.total_open) trainLosses++;
  }

  const trainBets = trainWins + trainLosses;
  const trainUnits = trainWins * 1.0 - trainLosses * 1.1;
  const trainWinRate = trainBets > 0 ? (trainWins / trainBets) * 100 : 0;
  const trainROI = trainBets > 0 ? (trainUnits / (trainBets * 1.1)) * 100 : 0;

  console.log(`\nTrain (SP+ > ${FROZEN_CONFIG.sp_sum_threshold} → UNDER):`);
  console.log(`  Eligible games: ${trainEligible.length}`);
  console.log(`  Bets: ${trainBets}`);
  console.log(`  Wins: ${trainWins}`);
  console.log(`  Win Rate: ${trainWinRate.toFixed(1)}%`);
  console.log(`  ROI: ${trainROI >= 0 ? '+' : ''}${trainROI.toFixed(1)}%`);

  // Test results
  const testEligible = test.filter(g => g.sp_sum! > FROZEN_CONFIG.sp_sum_threshold);
  let testWins = 0;
  let testLosses = 0;

  for (const g of testEligible) {
    if (g.actual_total < g.total_open) testWins++;
    else if (g.actual_total > g.total_open) testLosses++;
  }

  const testBets = testWins + testLosses;
  const testUnits = testWins * 1.0 - testLosses * 1.1;
  const testWinRate = testBets > 0 ? (testWins / testBets) * 100 : 0;
  const testROI = testBets > 0 ? (testUnits / (testBets * 1.1)) * 100 : 0;

  console.log(`\nTest (SP+ > ${FROZEN_CONFIG.sp_sum_threshold} → UNDER):`);
  console.log(`  Eligible games: ${testEligible.length}`);
  console.log(`  Bets: ${testBets}`);
  console.log(`  Wins: ${testWins}`);
  console.log(`  Win Rate: ${testWinRate.toFixed(1)}%`);
  console.log(`  ROI: ${testROI >= 0 ? '+' : ''}${testROI.toFixed(1)}%`);

  // Breakdown by week
  console.log('\n=== 2024 WEEK-BY-WEEK BREAKDOWN ===\n');
  console.log('Week | Bets | Wins | Losses | W-L');
  console.log('-----|------|------|--------|----');

  const byWeek = new Map<number, { wins: number; losses: number }>();
  for (const g of testEligible) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, { wins: 0, losses: 0 });
    const w = byWeek.get(g.week)!;
    if (g.actual_total < g.total_open) w.wins++;
    else if (g.actual_total > g.total_open) w.losses++;
  }

  for (const [week, stats] of Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0])) {
    const bets = stats.wins + stats.losses;
    console.log(
      `${week.toString().padStart(4)} | ${bets.toString().padStart(4)} | ${stats.wins.toString().padStart(4)} | ` +
      `${stats.losses.toString().padStart(6)} | ${stats.wins >= stats.losses ? '+' : ''}${stats.wins - stats.losses}`
    );
  }

  // Final assessment
  console.log('\n=== FINAL ASSESSMENT ===\n');

  if (testROI > 5) {
    console.log('✓ Model shows positive edge on holdout');
    console.log('  Recommendation: Proceed to production with volume limits');
  } else if (testROI > 0) {
    console.log('◐ Model shows marginal edge on holdout');
    console.log('  Recommendation: Monitor with small stakes');
  } else if (testROI > -5) {
    console.log('◐ Model shows near-breakeven on holdout');
    console.log('  Recommendation: Investigate edge decay, possible market efficiency');
  } else {
    console.log('✗ Model shows negative edge on holdout');
    console.log('  Recommendation: Signal may not be stable, reconsider approach');
  }

  console.log(`\nKey metrics:`);
  console.log(`  Train ROI: ${trainROI >= 0 ? '+' : ''}${trainROI.toFixed(1)}%`);
  console.log(`  Test ROI:  ${testROI >= 0 ? '+' : ''}${testROI.toFixed(1)}%`);
  console.log(`  Degradation: ${(trainROI - testROI).toFixed(1)} points`);

  const volumePerWeek = testBets / 15;  // Approximate weeks
  console.log(`  Volume: ~${volumePerWeek.toFixed(1)} bets/week`);
}

main().catch(console.error);
