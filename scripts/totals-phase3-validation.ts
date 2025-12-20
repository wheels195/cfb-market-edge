/**
 * Totals V1 Phase 3: Validation & Stress Testing
 *
 * Phase 3A: Volume stress test (threshold sweep)
 * Phase 3B: Market-awareness filter
 * Phase 3C: Portfolio allocation guidance
 *
 * Goal: Determine if TOTALS_V1 is a viable low-volume satellite strategy
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TotalsGame {
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  total_open: number;
  total_close: number | null;
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
        home_team: line.home_team,
        away_team: line.away_team,
        total_open: line.total_open,
        total_close: line.total_close,
        actual_total: line.home_score + line.away_score,
        sp_sum: spSum,
      });
    }
  }

  return games;
}

interface ThresholdResult {
  threshold: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  avgEdge: number;  // Average points under actual
  maxDrawdown: number;  // Worst cumulative loss
  longestLosing: number;  // Longest losing streak
  weeklyVolume: number;  // Bets per week
}

function analyzeThreshold(games: TotalsGame[], threshold: number): ThresholdResult {
  const eligible = games.filter(g => g.sp_sum !== null && g.sp_sum > threshold);

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let totalEdge = 0;

  // For drawdown calculation
  const results: number[] = [];  // +1 for win, -1.1 for loss
  let cumulative = 0;
  let maxCum = 0;
  let maxDrawdown = 0;

  // For losing streak
  let currentStreak = 0;
  let longestLosing = 0;

  for (const g of eligible) {
    // Bet UNDER
    const delta = g.total_open - g.actual_total;  // Positive = under won
    totalEdge += delta;

    if (g.actual_total < g.total_open) {
      wins++;
      results.push(1.0);
      cumulative += 1.0;
      currentStreak = 0;
    } else if (g.actual_total > g.total_open) {
      losses++;
      results.push(-1.1);
      cumulative -= 1.1;
      currentStreak++;
      longestLosing = Math.max(longestLosing, currentStreak);
    } else {
      pushes++;
    }

    maxCum = Math.max(maxCum, cumulative);
    maxDrawdown = Math.max(maxDrawdown, maxCum - cumulative);
  }

  const totalBets = wins + losses;
  const units = wins * 1.0 - losses * 1.1;

  // Approximate weeks (2022-2023 = ~30 weeks)
  const weeks = games.some(g => g.season === 2022) && games.some(g => g.season === 2023) ? 30 : 15;

  return {
    threshold,
    bets: totalBets,
    wins,
    losses,
    pushes,
    winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
    roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
    avgEdge: eligible.length > 0 ? totalEdge / eligible.length : 0,
    maxDrawdown,
    longestLosing,
    weeklyVolume: totalBets / weeks,
  };
}

interface MarketAwarenessResult {
  filter: string;
  bets: number;
  wins: number;
  winRate: number;
  roi: number;
}

function analyzeMarketAwareness(
  games: TotalsGame[],
  threshold: number
): { falling: MarketAwarenessResult; rising: MarketAwarenessResult; stable: MarketAwarenessResult } {
  const eligible = games.filter(g =>
    g.sp_sum !== null &&
    g.sp_sum > threshold &&
    g.total_close !== null
  );

  const falling = eligible.filter(g => g.total_close! < g.total_open - 0.5);
  const rising = eligible.filter(g => g.total_close! > g.total_open + 0.5);
  const stable = eligible.filter(g => Math.abs(g.total_close! - g.total_open) <= 0.5);

  const analyze = (subset: TotalsGame[], label: string): MarketAwarenessResult => {
    let wins = 0;
    let losses = 0;

    for (const g of subset) {
      if (g.actual_total < g.total_open) wins++;
      else if (g.actual_total > g.total_open) losses++;
    }

    const bets = wins + losses;
    const units = wins * 1.0 - losses * 1.1;

    return {
      filter: label,
      bets,
      wins,
      winRate: bets > 0 ? (wins / bets) * 100 : 0,
      roi: bets > 0 ? (units / (bets * 1.1)) * 100 : 0,
    };
  };

  return {
    falling: analyze(falling, 'Market falling (close < open)'),
    rising: analyze(rising, 'Market rising (close > open)'),
    stable: analyze(stable, 'Market stable'),
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 PHASE 3: VALIDATION & STRESS TESTING                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const allGames = await getGames([2022, 2023, 2024]);

  const train = allGames.filter(g => g.season !== 2024);
  const test = allGames.filter(g => g.season === 2024);

  console.log(`Train: ${train.length} games (2022-2023)`);
  console.log(`Test:  ${test.length} games (2024)`);

  // ========================================
  // PHASE 3A: THRESHOLD SWEEP ON TRAIN ONLY
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 3A: THRESHOLD SWEEP (TRAIN ONLY - 2022-2023)');
  console.log('='.repeat(70) + '\n');

  const thresholds = [115, 120, 125, 130, 135];
  const trainResults: ThresholdResult[] = [];

  console.log('Thresh | Bets | W-L   | Win%  | ROI     | Avg Edge | MaxDD | Streak | Vol/Wk');
  console.log('-------|------|-------|-------|---------|----------|-------|--------|-------');

  for (const t of thresholds) {
    const result = analyzeThreshold(train, t);
    trainResults.push(result);

    console.log(
      `${t.toString().padStart(6)} | ${result.bets.toString().padStart(4)} | ` +
      `${result.wins}-${result.losses}`.padStart(5) + ` | ` +
      `${result.winRate.toFixed(1).padStart(5)}% | ` +
      `${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1).padStart(6)}% | ` +
      `${result.avgEdge >= 0 ? '+' : ''}${result.avgEdge.toFixed(1).padStart(8)} | ` +
      `${result.maxDrawdown.toFixed(1).padStart(5)} | ` +
      `${result.longestLosing.toString().padStart(6)} | ` +
      `${result.weeklyVolume.toFixed(1).padStart(5)}`
    );
  }

  // Stability analysis
  console.log('\n=== STABILITY ANALYSIS ===\n');

  console.log('Looking for:');
  console.log('  - Directional stability (win rate > 52% as volume increases)');
  console.log('  - Non-collapse (ROI stays positive or near-breakeven)\n');

  for (const result of trainResults) {
    const stable = result.winRate > 52;
    const nonCollapse = result.roi > -5;
    const viable = stable && nonCollapse;

    const status = viable ? '✓' : '✗';
    console.log(
      `${status} SP+ > ${result.threshold}: ` +
      `${result.winRate.toFixed(1)}% win rate, ` +
      `${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}% ROI, ` +
      `${result.bets} bets`
    );
  }

  // Select best thresholds
  console.log('\n=== THRESHOLD SELECTION ===\n');

  const viable = trainResults.filter(r => r.winRate > 52 && r.roi > -5);

  if (viable.length === 0) {
    console.log('WARNING: No thresholds meet stability criteria');
    console.log('Proceeding with least-bad options for holdout test\n');
  }

  // Select based on stability, not max ROI
  // Prefer threshold with:
  // 1. Win rate closest to train mean (most stable)
  // 2. Reasonable volume
  const sorted = [...trainResults].sort((a, b) => {
    // Penalize very low volume
    if (a.bets < 30 && b.bets >= 30) return 1;
    if (b.bets < 30 && a.bets >= 30) return -1;

    // Prefer stable win rates over extreme ROI
    const aStability = Math.abs(a.winRate - 55);  // Deviation from "stable" 55%
    const bStability = Math.abs(b.winRate - 55);
    return aStability - bStability;
  });

  const primary = sorted.find(r => r.roi > 0) || sorted[0];
  const secondary = sorted.find(r => r !== primary && r.roi > -5);

  console.log(`Primary threshold:   SP+ > ${primary.threshold}`);
  console.log(`  Train: ${primary.winRate.toFixed(1)}% win rate, ${primary.roi >= 0 ? '+' : ''}${primary.roi.toFixed(1)}% ROI, ${primary.bets} bets`);

  if (secondary) {
    console.log(`Secondary threshold: SP+ > ${secondary.threshold}`);
    console.log(`  Train: ${secondary.winRate.toFixed(1)}% win rate, ${secondary.roi >= 0 ? '+' : ''}${secondary.roi.toFixed(1)}% ROI, ${secondary.bets} bets`);
  }

  // ========================================
  // PHASE 3A: ONE-SHOT 2024 EVALUATION
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 3A: ONE-SHOT 2024 HOLDOUT EVALUATION');
  console.log('='.repeat(70) + '\n');

  console.log('Thresh | Bets | W-L   | Win%  | ROI     | Avg Edge | MaxDD');
  console.log('-------|------|-------|-------|---------|----------|------');

  for (const threshold of [primary.threshold, secondary?.threshold].filter(Boolean)) {
    const result = analyzeThreshold(test, threshold!);

    console.log(
      `${threshold!.toString().padStart(6)} | ${result.bets.toString().padStart(4)} | ` +
      `${result.wins}-${result.losses}`.padStart(5) + ` | ` +
      `${result.winRate.toFixed(1).padStart(5)}% | ` +
      `${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1).padStart(6)}% | ` +
      `${result.avgEdge >= 0 ? '+' : ''}${result.avgEdge.toFixed(1).padStart(8)} | ` +
      `${result.maxDrawdown.toFixed(1)}`
    );
  }

  // ========================================
  // PHASE 3B: MARKET-AWARENESS FILTER
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 3B: MARKET-AWARENESS FILTER');
  console.log('='.repeat(70) + '\n');

  console.log('Question: Does the UNDER edge survive when the market is already moving?\n');

  // Test on train
  console.log('=== TRAIN (2022-2023) ===\n');

  const trainMarket = analyzeMarketAwareness(train, primary.threshold);

  console.log('Filter                          | Bets | Wins | Win%  | ROI');
  console.log('--------------------------------|------|------|-------|-------');

  for (const result of [trainMarket.falling, trainMarket.rising, trainMarket.stable]) {
    console.log(
      `${result.filter.padEnd(31)} | ${result.bets.toString().padStart(4)} | ` +
      `${result.wins.toString().padStart(4)} | ${result.winRate.toFixed(1).padStart(5)}% | ` +
      `${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}%`
    );
  }

  // Test on holdout
  console.log('\n=== HOLDOUT (2024) ===\n');

  const testMarket = analyzeMarketAwareness(test, primary.threshold);

  console.log('Filter                          | Bets | Wins | Win%  | ROI');
  console.log('--------------------------------|------|------|-------|-------');

  for (const result of [testMarket.falling, testMarket.rising, testMarket.stable]) {
    console.log(
      `${result.filter.padEnd(31)} | ${result.bets.toString().padStart(4)} | ` +
      `${result.wins.toString().padStart(4)} | ${result.winRate.toFixed(1).padStart(5)}% | ` +
      `${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}%`
    );
  }

  // Market awareness interpretation
  console.log('\n=== INTERPRETATION ===\n');

  if (trainMarket.falling.roi > trainMarket.rising.roi + 10) {
    console.log('✓ Edge survives when market already falling');
    console.log('  Implication: Our signal may be LATE (market already correcting)');
  } else if (trainMarket.rising.roi > trainMarket.falling.roi + 10) {
    console.log('✓ Edge survives when market rising');
    console.log('  Implication: Our signal may be EARLY (betting against momentum)');
  } else {
    console.log('◐ No strong pattern with market direction');
    console.log('  Implication: Signal independent of line movement');
  }

  // ========================================
  // PHASE 3C: PORTFOLIO ALLOCATION
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('PHASE 3C: PORTFOLIO ALLOCATION GUIDANCE');
  console.log('='.repeat(70) + '\n');

  const finalResult = analyzeThreshold(test, primary.threshold);

  console.log('TOTALS_V1 as Satellite Strategy:');
  console.log('');
  console.log('  Role: Low-frequency, uncorrelated return stream');
  console.log('  Allocation: 10% of betting volume (max)');
  console.log('');
  console.log('  Frozen Parameters:');
  console.log(`    - Threshold: SP+ sum > ${primary.threshold}`);
  console.log(`    - Direction: UNDER`);
  console.log(`    - Expected volume: ~${(finalResult.bets / 15).toFixed(1)} bets/week`);
  console.log('');
  console.log('  Risk Limits:');
  console.log(`    - Max drawdown observed: ${Math.max(primary.maxDrawdown, finalResult.maxDrawdown).toFixed(1)} units`);
  console.log(`    - Longest losing streak: ${Math.max(primary.longestLosing, finalResult.longestLosing)} bets`);
  console.log(`    - Suggested stop-loss: 5 consecutive losses`);

  // ========================================
  // FINAL ASSESSMENT
  // ========================================
  console.log('\n' + '='.repeat(70));
  console.log('FINAL ASSESSMENT');
  console.log('='.repeat(70) + '\n');

  const primaryTrain = trainResults.find(r => r.threshold === primary.threshold)!;
  const primaryTest = analyzeThreshold(test, primary.threshold);

  console.log('Primary Threshold Results:');
  console.log(`  Train (2022-2023): ${primaryTrain.bets} bets, ${primaryTrain.winRate.toFixed(1)}% win rate, ${primaryTrain.roi >= 0 ? '+' : ''}${primaryTrain.roi.toFixed(1)}% ROI`);
  console.log(`  Test (2024):       ${primaryTest.bets} bets, ${primaryTest.winRate.toFixed(1)}% win rate, ${primaryTest.roi >= 0 ? '+' : ''}${primaryTest.roi.toFixed(1)}% ROI`);
  console.log('');

  // Viability assessment
  const degradation = primaryTrain.roi - primaryTest.roi;
  const volumeViable = primaryTest.bets >= 5;
  const roiPositive = primaryTest.roi > 0;
  const winRateStable = primaryTest.winRate > 50;

  console.log('Viability Checks:');
  console.log(`  [${volumeViable ? '✓' : '✗'}] Sufficient volume (${primaryTest.bets} >= 5)`);
  console.log(`  [${roiPositive ? '✓' : '◐'}] Positive ROI on holdout (${primaryTest.roi >= 0 ? '+' : ''}${primaryTest.roi.toFixed(1)}%)`);
  console.log(`  [${winRateStable ? '✓' : '✗'}] Win rate > 50% (${primaryTest.winRate.toFixed(1)}%)`);
  console.log(`  [${Math.abs(degradation) < 20 ? '✓' : '◐'}] Degradation < 20 points (${degradation.toFixed(1)})`);
  console.log('');

  if (volumeViable && roiPositive && winRateStable) {
    console.log('VERDICT: TOTALS_V1 is VIABLE as a low-volume satellite strategy');
    console.log('');
    console.log('Recommended deployment:');
    console.log('  - Small allocation (10% of volume)');
    console.log('  - Monitor for 2025 season');
    console.log('  - Re-evaluate after 50 more bets');
  } else if (winRateStable && primaryTest.roi > -5) {
    console.log('VERDICT: TOTALS_V1 shows MARGINAL edge, needs more data');
    console.log('');
    console.log('Recommended action:');
    console.log('  - Paper trade 2025 season');
    console.log('  - Do not deploy with real capital yet');
  } else {
    console.log('VERDICT: TOTALS_V1 signal NOT STABLE enough for deployment');
    console.log('');
    console.log('Recommended action:');
    console.log('  - Archive model');
    console.log('  - Revisit with additional features or data');
  }

  // Failure modes
  console.log('\n=== FAILURE MODES ===\n');

  console.log('1. Low volume: Only ~1-3 bets/week limits sample size');
  console.log('2. Threshold sensitivity: Edge concentrates at extreme SP+ values');
  console.log('3. Market efficiency: If sportsbooks adjust, edge may disappear');
  console.log('4. Regime change: 2024 holdout is small sample, could be variance');
}

main().catch(console.error);
