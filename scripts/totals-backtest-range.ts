/**
 * Totals V1 Total-Range Conditioning
 *
 * Test 3: Does the totals edge vary by market total level?
 *
 * Hypothesis: Market efficiency differs by total range:
 * - Low totals (<45): Defensive games, market may underestimate variance
 * - Mid totals (45-55): Most common, likely most efficient
 * - High totals (>55): Offensive games, market may overestimate
 *
 * Train: 2023
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

interface RangeStats {
  range: string;
  games: number;
  overs: number;
  unders: number;
  overPct: number;
  avgDelta: number;
  spCorr: number;  // Correlation between SP+ sum and delta within this range
}

function analyzeRange(games: TotalsGame[], label: string): RangeStats {
  const overs = games.filter(g => g.actual_total > g.total_open);
  const unders = games.filter(g => g.actual_total < g.total_open);
  const decided = overs.length + unders.length;
  const avgDelta = games.reduce((a, g) => a + (g.actual_total - g.total_open), 0) / games.length;

  // Correlation within this range
  const withSP = games.filter(hasSP);
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

  return {
    range: label,
    games: games.length,
    overs: overs.length,
    unders: unders.length,
    overPct: decided > 0 ? (overs.length / decided) * 100 : 50,
    avgDelta,
    spCorr,
  };
}

interface ModelResult {
  name: string;
  bets: number;
  wins: number;
  winRate: number;
  roi: number;
}

function runStrategyInRange(
  games: TotalsGame[],
  strategy: 'over' | 'under' | 'sp_contrarian'
): ModelResult {
  const withSP = games.filter(hasSP);
  let wins = 0;
  let losses = 0;

  for (const g of withSP) {
    let betOver: boolean;

    if (strategy === 'over') {
      betOver = true;
    } else if (strategy === 'under') {
      betOver = false;
    } else {
      // SP contrarian: high SP+ → under, low SP+ → over
      const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;
      betOver = spSum < 110;  // Below median → over
    }

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
  console.log('║  TOTALS V1 TOTAL-RANGE CONDITIONING        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('Loading data...');
  const allGames = await getGames([2022, 2023, 2024]);

  const train2023 = allGames.filter(g => g.season === 2023);
  const test2024 = allGames.filter(g => g.season === 2024);

  console.log(`\n2022 games: ${allGames.filter(g => g.season === 2022).length}`);
  console.log(`2023 games: ${train2023.length} (train)`);
  console.log(`2024 games: ${test2024.length} (holdout)`);

  // Define range bands
  const ranges = [
    { label: 'Very Low (<40)', min: 0, max: 40 },
    { label: 'Low (40-45)', min: 40, max: 45 },
    { label: 'Low-Mid (45-50)', min: 45, max: 50 },
    { label: 'Mid (50-55)', min: 50, max: 55 },
    { label: 'Mid-High (55-60)', min: 55, max: 60 },
    { label: 'High (60-65)', min: 60, max: 65 },
    { label: 'Very High (>65)', min: 65, max: 100 },
  ];

  // Distribution of totals
  console.log('\n=== TOTAL DISTRIBUTION (TRAIN 2023) ===\n');
  console.log('Range           | Games | % of Total');
  console.log('----------------|-------|----------');

  for (const range of ranges) {
    const inRange = train2023.filter(g => g.total_open >= range.min && g.total_open < range.max);
    const pct = (inRange.length / train2023.length) * 100;
    console.log(`${range.label.padEnd(15)} | ${inRange.length.toString().padStart(5)} | ${pct.toFixed(1)}%`);
  }

  // Analyze each range
  console.log('\n=== RANGE ANALYSIS (TRAIN 2023) ===\n');
  console.log('Range           | Games | Overs | Over% | Avg Delta | SP+ Corr');
  console.log('----------------|-------|-------|-------|-----------|--------');

  const rangeStats: RangeStats[] = [];

  for (const range of ranges) {
    const inRange = train2023.filter(g => g.total_open >= range.min && g.total_open < range.max);
    if (inRange.length < 10) continue;

    const stats = analyzeRange(inRange, range.label);
    rangeStats.push(stats);

    console.log(
      `${stats.range.padEnd(15)} | ${stats.games.toString().padStart(5)} | ${stats.overs.toString().padStart(5)} | ` +
      `${stats.overPct.toFixed(1).padStart(5)}% | ${stats.avgDelta >= 0 ? '+' : ''}${stats.avgDelta.toFixed(1).padStart(9)} | ` +
      `${stats.spCorr >= 0 ? '+' : ''}${stats.spCorr.toFixed(3)}`
    );
  }

  // Find ranges with edge
  console.log('\n=== POTENTIAL EDGES ===\n');

  const edgeRanges = rangeStats.filter(s => Math.abs(s.overPct - 50) > 5);
  if (edgeRanges.length > 0) {
    console.log('Ranges with >5% deviation from 50%:');
    for (const r of edgeRanges) {
      const direction = r.overPct > 50 ? 'OVER' : 'UNDER';
      console.log(`  ${r.range}: ${r.overPct.toFixed(1)}% → Bet ${direction}`);
    }
  } else {
    console.log('No ranges show >5% deviation from 50%');
  }

  // Strategy testing by range
  console.log('\n=== STRATEGY BY RANGE (TRAIN 2023) ===\n');
  console.log('Range           | Strategy       | Bets | Wins | Win%  | ROI');
  console.log('----------------|----------------|------|------|-------|-------');

  interface RangeStrategy {
    range: string;
    strategy: string;
    result: ModelResult;
  }

  const rangeStrategies: RangeStrategy[] = [];

  for (const range of ranges) {
    const inRange = train2023.filter(g => g.total_open >= range.min && g.total_open < range.max);
    if (inRange.length < 20) continue;

    for (const strategy of ['over', 'under', 'sp_contrarian'] as const) {
      const result = runStrategyInRange(inRange, strategy);
      if (result.bets < 10) continue;

      rangeStrategies.push({ range: range.label, strategy, result });

      console.log(
        `${range.label.padEnd(15)} | ${strategy.padEnd(14)} | ${result.bets.toString().padStart(4)} | ` +
        `${result.wins.toString().padStart(4)} | ${result.winRate.toFixed(1).padStart(5)}% | ${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}%`
      );
    }
  }

  // Find best strategy per range
  console.log('\n=== BEST STRATEGY PER RANGE ===\n');

  const rangeSet = new Set(rangeStrategies.map(rs => rs.range));
  const bestByRange: RangeStrategy[] = [];

  for (const range of rangeSet) {
    const inRange = rangeStrategies.filter(rs => rs.range === range);
    const best = inRange.reduce((a, b) => a.result.roi > b.result.roi ? a : b);
    bestByRange.push(best);

    if (best.result.roi > 0) {
      console.log(`${best.range}: ${best.strategy} → ${best.result.roi >= 0 ? '+' : ''}${best.result.roi.toFixed(1)}% ROI`);
    }
  }

  // Combined strategy: apply best strategy per range
  console.log('\n=== COMBINED STRATEGY (TRAIN 2023) ===\n');

  let combinedWins = 0;
  let combinedLosses = 0;

  const strategyByRange = new Map<string, string>();
  for (const best of bestByRange) {
    if (best.result.roi > 0) {
      strategyByRange.set(best.range, best.strategy);
    }
  }

  console.log('Applying positive-ROI strategies:');
  for (const [range, strategy] of strategyByRange) {
    console.log(`  ${range}: ${strategy}`);
  }

  for (const g of train2023.filter(hasSP)) {
    let rangeLabel = '';
    for (const range of ranges) {
      if (g.total_open >= range.min && g.total_open < range.max) {
        rangeLabel = range.label;
        break;
      }
    }

    const strategy = strategyByRange.get(rangeLabel);
    if (!strategy) continue;

    let betOver: boolean;
    if (strategy === 'over') {
      betOver = true;
    } else if (strategy === 'under') {
      betOver = false;
    } else {
      const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;
      betOver = spSum < 110;
    }

    if (betOver && g.actual_total > g.total_open) combinedWins++;
    else if (betOver && g.actual_total < g.total_open) combinedLosses++;
    else if (!betOver && g.actual_total < g.total_open) combinedWins++;
    else if (!betOver && g.actual_total > g.total_open) combinedLosses++;
  }

  const combinedBets = combinedWins + combinedLosses;
  const combinedUnits = combinedWins * 1.0 - combinedLosses * 1.1;
  const combinedWinRate = combinedBets > 0 ? (combinedWins / combinedBets) * 100 : 0;
  const combinedROI = combinedBets > 0 ? (combinedUnits / (combinedBets * 1.1)) * 100 : 0;

  console.log(`\nCombined Train Results:`);
  console.log(`  Bets: ${combinedBets}`);
  console.log(`  Wins: ${combinedWins}`);
  console.log(`  Win Rate: ${combinedWinRate.toFixed(1)}%`);
  console.log(`  ROI: ${combinedROI >= 0 ? '+' : ''}${combinedROI.toFixed(1)}%`);

  // 2024 Holdout
  console.log('\n=== 2024 HOLDOUT ===\n');

  let holdoutWins = 0;
  let holdoutLosses = 0;

  for (const g of test2024.filter(hasSP)) {
    let rangeLabel = '';
    for (const range of ranges) {
      if (g.total_open >= range.min && g.total_open < range.max) {
        rangeLabel = range.label;
        break;
      }
    }

    const strategy = strategyByRange.get(rangeLabel);
    if (!strategy) continue;

    let betOver: boolean;
    if (strategy === 'over') {
      betOver = true;
    } else if (strategy === 'under') {
      betOver = false;
    } else {
      const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;
      betOver = spSum < 110;
    }

    if (betOver && g.actual_total > g.total_open) holdoutWins++;
    else if (betOver && g.actual_total < g.total_open) holdoutLosses++;
    else if (!betOver && g.actual_total < g.total_open) holdoutWins++;
    else if (!betOver && g.actual_total > g.total_open) holdoutLosses++;
  }

  const holdoutBets = holdoutWins + holdoutLosses;
  const holdoutUnits = holdoutWins * 1.0 - holdoutLosses * 1.1;
  const holdoutWinRate = holdoutBets > 0 ? (holdoutWins / holdoutBets) * 100 : 0;
  const holdoutROI = holdoutBets > 0 ? (holdoutUnits / (holdoutBets * 1.1)) * 100 : 0;

  console.log(`Combined Strategy on 2024:`);
  console.log(`  Bets: ${holdoutBets}`);
  console.log(`  Wins: ${holdoutWins}`);
  console.log(`  Win Rate: ${holdoutWinRate.toFixed(1)}%`);
  console.log(`  ROI: ${holdoutROI >= 0 ? '+' : ''}${holdoutROI.toFixed(1)}%`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`\nTotal-range conditioning:`);
  console.log(`  Train 2023: ${combinedWinRate.toFixed(1)}% win rate, ${combinedROI >= 0 ? '+' : ''}${combinedROI.toFixed(1)}% ROI`);
  console.log(`  Test 2024:  ${holdoutWinRate.toFixed(1)}% win rate, ${holdoutROI >= 0 ? '+' : ''}${holdoutROI.toFixed(1)}% ROI`);

  if (holdoutROI > 0) {
    console.log('\n  → Range conditioning shows promise');
  } else {
    console.log('\n  → Range strategies overfit to train data');
  }
}

main().catch(console.error);
