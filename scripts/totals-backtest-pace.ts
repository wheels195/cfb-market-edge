/**
 * Totals V1 Pace-Only Model
 *
 * Test 1: Pace as primary driver for totals
 *
 * Model: delta = w × (combined_pace - league_avg)
 * Higher pace = more plays = more scoring opportunities
 *
 * Point-in-time: Season N games use Season N-1 pace data
 *
 * Train: 2022-2023 (2023 only has pace since 2021 missing)
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
  home_pace: number | null;
  away_pace: number | null;
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

async function getSeasonPace(season: number): Promise<Map<string, number>> {
  // Get final week pace for each team (cumulative through season end)
  const paceMap = new Map<string, number>();

  // Get max week for each team
  const { data } = await supabase
    .from('team_stats_snapshots')
    .select('team_id, week, plays_per_game')
    .eq('season', season)
    .not('plays_per_game', 'is', null)
    .order('week', { ascending: false });

  // Keep only highest week per team (season-end pace)
  const seen = new Set<string>();
  for (const row of data || []) {
    if (!seen.has(row.team_id)) {
      paceMap.set(row.team_id, row.plays_per_game);
      seen.add(row.team_id);
    }
  }

  return paceMap;
}

async function getGames(seasons: number[]): Promise<TotalsGame[]> {
  const teamMap = await getTeamMap();
  const games: TotalsGame[] = [];

  // Load pace for prior seasons (point-in-time)
  const paceBySeason = new Map<number, Map<string, number>>();
  for (const season of [2021, 2022, 2023]) {
    const pace = await getSeasonPace(season);
    paceBySeason.set(season, pace);
    console.log(`  ${season} pace: ${pace.size} teams`);
  }

  for (const season of seasons) {
    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null);

    const priorPace = paceBySeason.get(season - 1);

    for (const line of lines || []) {
      const homeId = teamMap.get(line.home_team);
      const awayId = teamMap.get(line.away_team);

      const homePace = homeId && priorPace ? priorPace.get(homeId) || null : null;
      const awayPace = awayId && priorPace ? priorPace.get(awayId) || null : null;

      games.push({
        season: line.season,
        week: line.week,
        home_team: line.home_team,
        away_team: line.away_team,
        total_open: line.total_open,
        actual_total: line.home_score + line.away_score,
        home_pace: homePace,
        away_pace: awayPace,
      });
    }
  }

  return games;
}

interface BacktestResult {
  w: number;
  bets: number;
  wins: number;
  winRate: number;
  roi: number;
  avgDelta: number;
}

function runBacktest(games: TotalsGame[], w: number, leagueAvg: number): BacktestResult {
  const eligible = games.filter(g => g.home_pace !== null && g.away_pace !== null);

  let wins = 0;
  let losses = 0;
  let totalDelta = 0;

  for (const g of eligible) {
    const combinedPace = (g.home_pace! + g.away_pace!) / 2;
    const delta = w * (combinedPace - leagueAvg);

    totalDelta += Math.abs(delta);

    // Bet based on delta
    const betOver = delta > 0;
    const wentOver = g.actual_total > g.total_open;
    const wentUnder = g.actual_total < g.total_open;

    if (betOver && wentOver) wins++;
    else if (betOver && wentUnder) losses++;
    else if (!betOver && wentUnder) wins++;
    else if (!betOver && wentOver) losses++;
    // Push: neither wins nor losses
  }

  const totalBets = wins + losses;
  const units = wins * 1.0 - losses * 1.1;

  return {
    w,
    bets: totalBets,
    wins,
    winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
    roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
    avgDelta: eligible.length > 0 ? totalDelta / eligible.length : 0,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 PACE-ONLY MODEL                 ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('Loading data...');
  const allGames = await getGames([2022, 2023, 2024]);

  // Split by season
  const train2023 = allGames.filter(g => g.season === 2023);
  const test2024 = allGames.filter(g => g.season === 2024);

  // Note: 2022 excluded from train because 2021 pace data is missing
  console.log(`\n2022 games: ${allGames.filter(g => g.season === 2022).length} (excluded - no 2021 pace)`);
  console.log(`2023 games: ${train2023.length} (train)`);
  console.log(`2024 games: ${test2024.length} (holdout)`);

  // Coverage check
  const train2023WithPace = train2023.filter(g => g.home_pace && g.away_pace);
  const test2024WithPace = test2024.filter(g => g.home_pace && g.away_pace);
  console.log(`\n2023 with pace: ${train2023WithPace.length} (${((train2023WithPace.length / train2023.length) * 100).toFixed(1)}%)`);
  console.log(`2024 with pace: ${test2024WithPace.length} (${((test2024WithPace.length / test2024.length) * 100).toFixed(1)}%)`);

  // Calculate league average pace from train data
  const trainPaces = train2023WithPace.flatMap(g => [g.home_pace!, g.away_pace!]);
  const leagueAvg = trainPaces.reduce((a, b) => a + b, 0) / trainPaces.length;
  console.log(`\nLeague average pace (from 2022 season): ${leagueAvg.toFixed(1)} plays/game`);

  // Pace distribution
  const paceStd = Math.sqrt(trainPaces.reduce((a, b) => a + (b - leagueAvg) ** 2, 0) / trainPaces.length);
  console.log(`Pace std dev: ${paceStd.toFixed(1)}`);

  // Grid search on train
  console.log('\n=== GRID SEARCH ON TRAIN (2023) ===\n');
  console.log('Weight  | Bets | Wins | Win%  | ROI     | Avg Delta');
  console.log('--------|------|------|-------|---------|----------');

  const weights = [0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0];
  const trainResults: BacktestResult[] = [];

  for (const w of weights) {
    const result = runBacktest(train2023WithPace, w, leagueAvg);
    trainResults.push(result);

    console.log(
      `${w.toFixed(2).padStart(7)} | ${result.bets.toString().padStart(4)} | ${result.wins.toString().padStart(4)} | ` +
      `${result.winRate.toFixed(1).padStart(5)}% | ${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1).padStart(6)}% | ` +
      `${result.avgDelta.toFixed(2)}`
    );
  }

  // Find best
  const best = trainResults.reduce((a, b) => a.roi > b.roi ? a : b);
  console.log(`\nBest weight on train: w=${best.w}`);
  console.log(`  Win Rate: ${best.winRate.toFixed(1)}%, ROI: ${best.roi >= 0 ? '+' : ''}${best.roi.toFixed(1)}%`);

  // Correlation analysis
  console.log('\n=== CORRELATION ANALYSIS ===\n');

  // Calculate correlation between pace delta and actual delta
  const paceDelta = train2023WithPace.map(g => (g.home_pace! + g.away_pace!) / 2 - leagueAvg);
  const actualDelta = train2023WithPace.map(g => g.actual_total - g.total_open);

  const n = paceDelta.length;
  const sumX = paceDelta.reduce((a, b) => a + b, 0);
  const sumY = actualDelta.reduce((a, b) => a + b, 0);
  const sumXY = paceDelta.reduce((acc, x, i) => acc + x * actualDelta[i], 0);
  const sumX2 = paceDelta.reduce((a, b) => a + b * b, 0);
  const sumY2 = actualDelta.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const correlation = den === 0 ? 0 : num / den;

  console.log(`Pace Delta vs Actual Delta:      r = ${correlation.toFixed(4)}`);

  // Bucket analysis
  console.log('\n=== BUCKET ANALYSIS ===\n');
  console.log('Do high-pace games go OVER more often?\n');

  const sorted = [...train2023WithPace].sort((a, b) =>
    (a.home_pace! + a.away_pace!) - (b.home_pace! + b.away_pace!)
  );

  const tercileSize = Math.floor(sorted.length / 3);
  const terciles = [
    sorted.slice(0, tercileSize),
    sorted.slice(tercileSize, tercileSize * 2),
    sorted.slice(tercileSize * 2),
  ];

  console.log('Tercile  | Avg Pace | Overs | Unders | Over%');
  console.log('---------|----------|-------|--------|------');

  for (let i = 0; i < 3; i++) {
    const t = terciles[i];
    const avgPace = t.reduce((a, g) => a + (g.home_pace! + g.away_pace!) / 2, 0) / t.length;
    const overs = t.filter(g => g.actual_total > g.total_open).length;
    const unders = t.filter(g => g.actual_total < g.total_open).length;
    const overPct = (overs / (overs + unders)) * 100;

    const labels = ['Low', 'Mid', 'High'];
    console.log(
      `${labels[i].padEnd(8)} | ${avgPace.toFixed(1).padStart(8)} | ${overs.toString().padStart(5)} | ` +
      `${unders.toString().padStart(6)} | ${overPct.toFixed(1)}%`
    );
  }

  // 2024 Holdout
  console.log('\n=== 2024 HOLDOUT ===\n');
  console.log('(Using best weight from train)\n');

  const holdoutResult = runBacktest(test2024WithPace, best.w, leagueAvg);

  console.log(`Weight: ${best.w}`);
  console.log(`Bets: ${holdoutResult.bets}`);
  console.log(`Wins: ${holdoutResult.wins}`);
  console.log(`Win Rate: ${holdoutResult.winRate.toFixed(1)}%`);
  console.log(`ROI: ${holdoutResult.roi >= 0 ? '+' : ''}${holdoutResult.roi.toFixed(1)}%`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`\nPace-only model (w=${best.w}):`);
  console.log(`  Train 2023: ${best.winRate.toFixed(1)}% win rate, ${best.roi >= 0 ? '+' : ''}${best.roi.toFixed(1)}% ROI`);
  console.log(`  Test 2024:  ${holdoutResult.winRate.toFixed(1)}% win rate, ${holdoutResult.roi >= 0 ? '+' : ''}${holdoutResult.roi.toFixed(1)}% ROI`);
  console.log(`  Correlation (pace delta vs actual): r = ${correlation.toFixed(4)}`);

  if (correlation > 0.05) {
    console.log('\n  → Weak positive signal: higher pace → more likely OVER');
  } else if (correlation < -0.05) {
    console.log('\n  → Weak negative signal: higher pace → more likely UNDER (surprising)');
  } else {
    console.log('\n  → No meaningful pace signal in isolation');
  }
}

main().catch(console.error);
