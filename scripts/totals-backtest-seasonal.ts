/**
 * Totals V1 Seasonal Regime Split
 *
 * Test 4: Does the totals edge vary by week number?
 *
 * Hypothesis:
 * - Early season (Weeks 1-4): Prior year SP+ may be less accurate due to roster changes
 * - Late season (Weeks 5+): Current performance stabilizes, market more efficient
 *
 * Alternative hypothesis:
 * - Early season: Less market efficiency, more edge
 * - Late season: Market has adjusted, less edge
 *
 * Train: 2023 only (2022 lacks 2021 pace)
 * Test: 2024
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
  actual_total: number;
  // SP+ (from prior year)
  home_sp_off: number | null;
  home_sp_def: number | null;
  away_sp_off: number | null;
  away_sp_def: number | null;
}

async function getTeamMap(): Promise<Map<string, string>> {
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

async function getSPRatings(season: number): Promise<Map<string, { off: number; def: number }>> {
  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_offense, sp_defense')
    .eq('season', season)
    .not('sp_overall', 'is', null);

  const spMap = new Map<string, { off: number; def: number }>();
  for (const row of data || []) {
    spMap.set(row.team_id, { off: row.sp_offense || 0, def: row.sp_defense || 0 });
  }
  return spMap;
}

async function getGames(seasons: number[]): Promise<TotalsGame[]> {
  const teamMap = await getTeamMap();
  const games: TotalsGame[] = [];

  const spBySeason = new Map<number, Map<string, { off: number; def: number }>>();
  for (const season of [2021, 2022, 2023]) {
    const sp = await getSPRatings(season);
    spBySeason.set(season, sp);
    console.log(`  ${season} SP+: ${sp.size} teams`);
  }

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

      games.push({
        season: line.season,
        week: line.week,
        home_team: line.home_team,
        away_team: line.away_team,
        total_open: line.total_open,
        actual_total: line.home_score + line.away_score,
        home_sp_off: homeSP?.off ?? null,
        home_sp_def: homeSP?.def ?? null,
        away_sp_off: awaySP?.off ?? null,
        away_sp_def: awaySP?.def ?? null,
      });
    }
  }

  return games;
}

function hasSP(g: TotalsGame): boolean {
  return (
    g.home_sp_off !== null &&
    g.home_sp_def !== null &&
    g.away_sp_off !== null &&
    g.away_sp_def !== null
  );
}

interface WeekStats {
  week: number;
  games: number;
  overs: number;
  unders: number;
  overPct: number;
  avgDelta: number;
  spCorr: number;
}

function analyzeWeek(games: TotalsGame[]): WeekStats[] {
  const byWeek = new Map<number, TotalsGame[]>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week)!.push(g);
  }

  const stats: WeekStats[] = [];

  for (const [week, weekGames] of Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0])) {
    const overs = weekGames.filter(g => g.actual_total > g.total_open);
    const unders = weekGames.filter(g => g.actual_total < g.total_open);
    const decided = overs.length + unders.length;
    const avgDelta = weekGames.reduce((a, g) => a + (g.actual_total - g.total_open), 0) / weekGames.length;

    // Correlation within this week
    const withSP = weekGames.filter(hasSP);
    let spCorr = 0;

    if (withSP.length > 5) {
      const spSums = withSP.map(g => g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!);
      const deltas = withSP.map(g => g.actual_total - g.total_open);

      const n = spSums.length;
      const sumX = spSums.reduce((a, b) => a + b, 0);
      const sumY = deltas.reduce((a, b) => a + b, 0);
      const sumXY = spSums.reduce((acc, x, i) => acc + x * deltas[i], 0);
      const sumX2 = spSums.reduce((a, b) => a + b * b, 0);
      const sumY2 = deltas.reduce((a, b) => a + b * b, 0);

      const num = n * sumXY - sumX * sumY;
      const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      spCorr = den === 0 ? 0 : num / den;
    }

    stats.push({
      week,
      games: weekGames.length,
      overs: overs.length,
      unders: unders.length,
      overPct: decided > 0 ? (overs.length / decided) * 100 : 50,
      avgDelta,
      spCorr,
    });
  }

  return stats;
}

interface ModelResult {
  name: string;
  bets: number;
  wins: number;
  winRate: number;
  roi: number;
}

function runStrategy(
  games: TotalsGame[],
  strategy: 'over' | 'under' | 'sp_high_under' | 'sp_low_over'
): ModelResult {
  const withSP = games.filter(hasSP);
  let wins = 0;
  let losses = 0;
  let bets = 0;

  for (const g of withSP) {
    const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;

    let betOver: boolean | null = null;

    switch (strategy) {
      case 'over':
        betOver = true;
        break;
      case 'under':
        betOver = false;
        break;
      case 'sp_high_under':
        // Bet UNDER on high SP+ games (>1 std above mean ~130)
        if (spSum > 130) betOver = false;
        break;
      case 'sp_low_over':
        // Bet OVER on low SP+ games (<1 std below mean ~90)
        if (spSum < 90) betOver = true;
        break;
    }

    if (betOver === null) continue;

    bets++;
    if (betOver && g.actual_total > g.total_open) wins++;
    else if (betOver && g.actual_total < g.total_open) losses++;
    else if (!betOver && g.actual_total < g.total_open) wins++;
    else if (!betOver && g.actual_total > g.total_open) losses++;
  }

  const totalBets = wins + losses;
  const units = wins * 1.0 - losses * 1.1;

  return {
    name: strategy,
    bets: totalBets,
    wins,
    winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
    roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 SEASONAL REGIME SPLIT           ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('Loading data...');
  const allGames = await getGames([2022, 2023, 2024]);

  // Use 2022+2023 for analysis, 2024 as holdout
  const train = allGames.filter(g => g.season === 2022 || g.season === 2023);
  const test2024 = allGames.filter(g => g.season === 2024);

  console.log(`\nTrain: ${train.length} games (2022-2023)`);
  console.log(`Test: ${test2024.length} games (2024)`);

  // Week-by-week analysis
  console.log('\n=== WEEK-BY-WEEK ANALYSIS (TRAIN) ===\n');
  console.log('Week | Games | Overs | Over% | Avg Delta | SP+ Corr');
  console.log('-----|-------|-------|-------|-----------|--------');

  const weekStats = analyzeWeek(train);
  for (const w of weekStats) {
    if (w.week > 15) continue;  // Skip bowl games
    console.log(
      `${w.week.toString().padStart(4)} | ${w.games.toString().padStart(5)} | ${w.overs.toString().padStart(5)} | ` +
      `${w.overPct.toFixed(1).padStart(5)}% | ${w.avgDelta >= 0 ? '+' : ''}${w.avgDelta.toFixed(1).padStart(9)} | ` +
      `${w.spCorr >= 0 ? '+' : ''}${w.spCorr.toFixed(3)}`
    );
  }

  // Split into regimes
  console.log('\n=== REGIME COMPARISON ===\n');

  const earlyWeeks = [1, 2, 3, 4];
  const lateWeeks = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  const earlyGames = train.filter(g => earlyWeeks.includes(g.week));
  const lateGames = train.filter(g => lateWeeks.includes(g.week));

  console.log(`Early season (Weeks 1-4): ${earlyGames.length} games`);
  console.log(`Late season (Weeks 5+):   ${lateGames.length} games`);

  // Analyze each regime
  const regimes = [
    { label: 'Early (1-4)', games: earlyGames },
    { label: 'Late (5+)', games: lateGames },
  ];

  console.log('\n=== REGIME STATS ===\n');
  console.log('Regime       | Games | Overs | Over% | Avg Delta | SP+ Corr');
  console.log('-------------|-------|-------|-------|-----------|--------');

  for (const regime of regimes) {
    const overs = regime.games.filter(g => g.actual_total > g.total_open);
    const unders = regime.games.filter(g => g.actual_total < g.total_open);
    const decided = overs.length + unders.length;
    const overPct = decided > 0 ? (overs.length / decided) * 100 : 50;
    const avgDelta = regime.games.reduce((a, g) => a + (g.actual_total - g.total_open), 0) / regime.games.length;

    // Correlation
    const withSP = regime.games.filter(hasSP);
    const spSums = withSP.map(g => g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!);
    const deltas = withSP.map(g => g.actual_total - g.total_open);

    const n = spSums.length;
    const sumX = spSums.reduce((a, b) => a + b, 0);
    const sumY = deltas.reduce((a, b) => a + b, 0);
    const sumXY = spSums.reduce((acc, x, i) => acc + x * deltas[i], 0);
    const sumX2 = spSums.reduce((a, b) => a + b * b, 0);
    const sumY2 = deltas.reduce((a, b) => a + b * b, 0);

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const spCorr = den === 0 ? 0 : num / den;

    console.log(
      `${regime.label.padEnd(12)} | ${regime.games.length.toString().padStart(5)} | ${overs.length.toString().padStart(5)} | ` +
      `${overPct.toFixed(1).padStart(5)}% | ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1).padStart(9)} | ` +
      `${spCorr >= 0 ? '+' : ''}${spCorr.toFixed(3)}`
    );
  }

  // Strategy testing by regime
  console.log('\n=== STRATEGY BY REGIME (TRAIN) ===\n');
  console.log('Regime       | Strategy        | Bets | Wins | Win%  | ROI');
  console.log('-------------|-----------------|------|------|-------|-------');

  const strategies = ['over', 'under', 'sp_high_under', 'sp_low_over'] as const;
  const regimeResults: Array<{ regime: string; strategy: string; result: ModelResult }> = [];

  for (const regime of regimes) {
    for (const strategy of strategies) {
      const result = runStrategy(regime.games, strategy);
      if (result.bets < 10) continue;

      regimeResults.push({ regime: regime.label, strategy, result });

      console.log(
        `${regime.label.padEnd(12)} | ${strategy.padEnd(15)} | ${result.bets.toString().padStart(4)} | ` +
        `${result.wins.toString().padStart(4)} | ${result.winRate.toFixed(1).padStart(5)}% | ${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}%`
      );
    }
    console.log('-------------|-----------------|------|------|-------|-------');
  }

  // Find best strategy per regime
  console.log('\n=== BEST STRATEGY PER REGIME ===\n');

  const bestEarly = regimeResults
    .filter(r => r.regime === 'Early (1-4)' && r.result.bets >= 20)
    .reduce((a, b) => a.result.roi > b.result.roi ? a : b, { regime: '', strategy: '', result: { name: '', bets: 0, wins: 0, winRate: 0, roi: -100 } });

  const bestLate = regimeResults
    .filter(r => r.regime === 'Late (5+)' && r.result.bets >= 20)
    .reduce((a, b) => a.result.roi > b.result.roi ? a : b, { regime: '', strategy: '', result: { name: '', bets: 0, wins: 0, winRate: 0, roi: -100 } });

  if (bestEarly.result.bets > 0) {
    console.log(`Early (1-4): ${bestEarly.strategy} → ${bestEarly.result.roi >= 0 ? '+' : ''}${bestEarly.result.roi.toFixed(1)}% ROI`);
  }
  if (bestLate.result.bets > 0) {
    console.log(`Late (5+):   ${bestLate.strategy} → ${bestLate.result.roi >= 0 ? '+' : ''}${bestLate.result.roi.toFixed(1)}% ROI`);
  }

  // Combined strategy
  console.log('\n=== COMBINED STRATEGY (TRAIN) ===\n');

  const earlyStrategy = bestEarly.result.roi > 0 ? bestEarly.strategy : null;
  const lateStrategy = bestLate.result.roi > 0 ? bestLate.strategy : null;

  console.log(`Early (1-4): ${earlyStrategy || 'none (negative ROI)'}`);
  console.log(`Late (5+):   ${lateStrategy || 'none (negative ROI)'}`);

  let trainWins = 0;
  let trainLosses = 0;

  for (const g of train.filter(hasSP)) {
    const isEarly = earlyWeeks.includes(g.week);
    const strategy = isEarly ? earlyStrategy : lateStrategy;
    if (!strategy) continue;

    const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;
    let betOver: boolean | null = null;

    switch (strategy) {
      case 'over':
        betOver = true;
        break;
      case 'under':
        betOver = false;
        break;
      case 'sp_high_under':
        if (spSum > 130) betOver = false;
        break;
      case 'sp_low_over':
        if (spSum < 90) betOver = true;
        break;
    }

    if (betOver === null) continue;

    if (betOver && g.actual_total > g.total_open) trainWins++;
    else if (betOver && g.actual_total < g.total_open) trainLosses++;
    else if (!betOver && g.actual_total < g.total_open) trainWins++;
    else if (!betOver && g.actual_total > g.total_open) trainLosses++;
  }

  const trainBets = trainWins + trainLosses;
  const trainUnits = trainWins * 1.0 - trainLosses * 1.1;
  const trainWinRate = trainBets > 0 ? (trainWins / trainBets) * 100 : 0;
  const trainROI = trainBets > 0 ? (trainUnits / (trainBets * 1.1)) * 100 : 0;

  console.log(`\nTrain Results:`);
  console.log(`  Bets: ${trainBets}`);
  console.log(`  Wins: ${trainWins}`);
  console.log(`  Win Rate: ${trainWinRate.toFixed(1)}%`);
  console.log(`  ROI: ${trainROI >= 0 ? '+' : ''}${trainROI.toFixed(1)}%`);

  // 2024 Holdout
  console.log('\n=== 2024 HOLDOUT ===\n');

  let holdoutWins = 0;
  let holdoutLosses = 0;

  for (const g of test2024.filter(hasSP)) {
    const isEarly = earlyWeeks.includes(g.week);
    const strategy = isEarly ? earlyStrategy : lateStrategy;
    if (!strategy) continue;

    const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;
    let betOver: boolean | null = null;

    switch (strategy) {
      case 'over':
        betOver = true;
        break;
      case 'under':
        betOver = false;
        break;
      case 'sp_high_under':
        if (spSum > 130) betOver = false;
        break;
      case 'sp_low_over':
        if (spSum < 90) betOver = true;
        break;
    }

    if (betOver === null) continue;

    if (betOver && g.actual_total > g.total_open) holdoutWins++;
    else if (betOver && g.actual_total < g.total_open) holdoutLosses++;
    else if (!betOver && g.actual_total < g.total_open) holdoutWins++;
    else if (!betOver && g.actual_total > g.total_open) holdoutLosses++;
  }

  const holdoutBets = holdoutWins + holdoutLosses;
  const holdoutUnits = holdoutWins * 1.0 - holdoutLosses * 1.1;
  const holdoutWinRate = holdoutBets > 0 ? (holdoutWins / holdoutBets) * 100 : 0;
  const holdoutROI = holdoutBets > 0 ? (holdoutUnits / (holdoutBets * 1.1)) * 100 : 0;

  console.log(`2024 Holdout Results:`);
  console.log(`  Bets: ${holdoutBets}`);
  console.log(`  Wins: ${holdoutWins}`);
  console.log(`  Win Rate: ${holdoutWinRate.toFixed(1)}%`);
  console.log(`  ROI: ${holdoutROI >= 0 ? '+' : ''}${holdoutROI.toFixed(1)}%`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`\nSeasonal regime model:`);
  console.log(`  Train: ${trainWinRate.toFixed(1)}% win rate, ${trainROI >= 0 ? '+' : ''}${trainROI.toFixed(1)}% ROI`);
  console.log(`  Test:  ${holdoutWinRate.toFixed(1)}% win rate, ${holdoutROI >= 0 ? '+' : ''}${holdoutROI.toFixed(1)}% ROI`);

  // Key insight
  const earlyCorr = weekStats.filter(w => earlyWeeks.includes(w.week)).reduce((a, w) => a + w.spCorr, 0) / earlyWeeks.length;
  const lateCorr = weekStats.filter(w => lateWeeks.includes(w.week)).reduce((a, w) => a + w.spCorr, 0) / lateWeeks.length;

  console.log(`\nSP+ correlation by regime:`);
  console.log(`  Early (1-4): ${earlyCorr >= 0 ? '+' : ''}${earlyCorr.toFixed(3)}`);
  console.log(`  Late (5+):   ${lateCorr >= 0 ? '+' : ''}${lateCorr.toFixed(3)}`);
}

main().catch(console.error);
