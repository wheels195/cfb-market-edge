/**
 * Totals V1 SP+ × Pace Interaction Model
 *
 * Test 2: Does combining SP+ and pace reveal structure neither shows alone?
 *
 * Hypotheses:
 * 1. Multiplicative: pace amplifies SP+ effect
 * 2. Conditional: pace matters more in extreme SP+ matchups
 * 3. Offset: high SP+ + low pace = lower than market expects
 *
 * Train: 2023 (2022 excluded - no 2021 pace)
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
  // Pace (from prior year)
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

async function getSeasonPace(season: number): Promise<Map<string, number>> {
  const paceMap = new Map<string, number>();

  const { data } = await supabase
    .from('team_stats_snapshots')
    .select('team_id, week, plays_per_game')
    .eq('season', season)
    .not('plays_per_game', 'is', null)
    .order('week', { ascending: false });

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

  // Load SP+ and pace for prior seasons
  const spBySeason = new Map<number, Map<string, { off: number; def: number }>>();
  const paceBySeason = new Map<number, Map<string, number>>();

  for (const season of [2021, 2022, 2023]) {
    const sp = await getSPRatings(season);
    spBySeason.set(season, sp);

    const pace = await getSeasonPace(season);
    paceBySeason.set(season, pace);

    console.log(`  ${season}: SP+ ${sp.size} teams, Pace ${pace.size} teams`);
  }

  for (const season of seasons) {
    const { data: lines } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .eq('season', season)
      .not('total_open', 'is', null)
      .not('home_score', 'is', null);

    const priorSP = spBySeason.get(season - 1);
    const priorPace = paceBySeason.get(season - 1);

    for (const line of lines || []) {
      const homeId = teamMap.get(line.home_team);
      const awayId = teamMap.get(line.away_team);

      const homeSP = homeId && priorSP ? priorSP.get(homeId) : null;
      const awaySP = awayId && priorSP ? priorSP.get(awayId) : null;
      const homePace = homeId && priorPace ? priorPace.get(homeId) : null;
      const awayPace = awayId && priorPace ? priorPace.get(awayId) : null;

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
        home_pace: homePace ?? null,
        away_pace: awayPace ?? null,
      });
    }
  }

  return games;
}

function hasAllData(g: TotalsGame): boolean {
  return (
    g.home_sp_off !== null &&
    g.home_sp_def !== null &&
    g.away_sp_off !== null &&
    g.away_sp_def !== null &&
    g.home_pace !== null &&
    g.away_pace !== null
  );
}

interface ComputedFeatures {
  spSum: number;           // All four SP+ values
  paceAvg: number;         // Average pace
  spPaceProduct: number;   // Normalized SP+ × pace
  offenseSPSum: number;    // Just offensive SP+
  defenseSPSum: number;    // Just defensive SP+
  actualDelta: number;     // Actual - market
}

function computeFeatures(g: TotalsGame, spMean: number, spStd: number, paceMean: number, paceStd: number): ComputedFeatures {
  const spSum = g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!;
  const paceAvg = (g.home_pace! + g.away_pace!) / 2;

  // Normalize both features
  const spZ = (spSum - spMean) / spStd;
  const paceZ = (paceAvg - paceMean) / paceStd;

  return {
    spSum,
    paceAvg,
    spPaceProduct: spZ * paceZ,  // Interaction term
    offenseSPSum: g.home_sp_off! + g.away_sp_off!,
    defenseSPSum: g.home_sp_def! + g.away_sp_def!,
    actualDelta: g.actual_total - g.total_open,
  };
}

interface ModelResult {
  name: string;
  bets: number;
  wins: number;
  winRate: number;
  roi: number;
}

function runModel(
  games: TotalsGame[],
  getEdge: (g: TotalsGame, features: ComputedFeatures) => number,
  spMean: number,
  spStd: number,
  paceMean: number,
  paceStd: number
): ModelResult {
  const eligible = games.filter(hasAllData);

  let wins = 0;
  let losses = 0;

  for (const g of eligible) {
    const features = computeFeatures(g, spMean, spStd, paceMean, paceStd);
    const edge = getEdge(g, features);

    const betOver = edge > 0;
    const wentOver = g.actual_total > g.total_open;
    const wentUnder = g.actual_total < g.total_open;

    if (betOver && wentOver) wins++;
    else if (betOver && wentUnder) losses++;
    else if (!betOver && wentUnder) wins++;
    else if (!betOver && wentOver) losses++;
  }

  const totalBets = wins + losses;
  const units = wins * 1.0 - losses * 1.1;

  return {
    name: '',
    bets: totalBets,
    wins,
    winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
    roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  TOTALS V1 SP+ × PACE INTERACTION MODEL    ║');
  console.log('╚════════════════════════════════════════════╝\n');

  console.log('Loading data...');
  const allGames = await getGames([2023, 2024]);

  const train2023 = allGames.filter(g => g.season === 2023 && hasAllData(g));
  const test2024 = allGames.filter(g => g.season === 2024 && hasAllData(g));

  console.log(`\n2023 with all data: ${train2023.length} games (train)`);
  console.log(`2024 with all data: ${test2024.length} games (holdout)`);

  // Compute normalization parameters from train
  const trainSPSums = train2023.map(g => g.home_sp_off! + g.home_sp_def! + g.away_sp_off! + g.away_sp_def!);
  const trainPaces = train2023.map(g => (g.home_pace! + g.away_pace!) / 2);

  const spMean = trainSPSums.reduce((a, b) => a + b, 0) / trainSPSums.length;
  const spStd = Math.sqrt(trainSPSums.reduce((a, b) => a + (b - spMean) ** 2, 0) / trainSPSums.length);
  const paceMean = trainPaces.reduce((a, b) => a + b, 0) / trainPaces.length;
  const paceStd = Math.sqrt(trainPaces.reduce((a, b) => a + (b - paceMean) ** 2, 0) / trainPaces.length);

  console.log(`\nTrain stats:`);
  console.log(`  SP+ sum: mean=${spMean.toFixed(1)}, std=${spStd.toFixed(1)}`);
  console.log(`  Pace:    mean=${paceMean.toFixed(1)}, std=${paceStd.toFixed(1)}`);

  // Correlation analysis
  console.log('\n=== CORRELATION ANALYSIS ===\n');

  const trainFeatures = train2023.map(g => computeFeatures(g, spMean, spStd, paceMean, paceStd));

  const computeCorr = (x: number[], y: number[]): number => {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumX2 = x.reduce((a, b) => a + b * b, 0);
    const sumY2 = y.reduce((a, b) => a + b * b, 0);
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
  };

  const actualDeltas = trainFeatures.map(f => f.actualDelta);
  const spSums = trainFeatures.map(f => f.spSum);
  const paceAvgs = trainFeatures.map(f => f.paceAvg);
  const spPaceProducts = trainFeatures.map(f => f.spPaceProduct);

  console.log(`SP+ Sum vs Delta:          r = ${computeCorr(spSums, actualDeltas).toFixed(4)}`);
  console.log(`Pace Avg vs Delta:         r = ${computeCorr(paceAvgs, actualDeltas).toFixed(4)}`);
  console.log(`SP+ × Pace vs Delta:       r = ${computeCorr(spPaceProducts, actualDeltas).toFixed(4)}`);

  // Quadrant analysis
  console.log('\n=== QUADRANT ANALYSIS ===');
  console.log('(Split by median SP+ and median pace)\n');

  const medianSP = [...spSums].sort((a, b) => a - b)[Math.floor(spSums.length / 2)];
  const medianPace = [...paceAvgs].sort((a, b) => a - b)[Math.floor(paceAvgs.length / 2)];

  const quadrants = [
    { label: 'Low SP+, Low Pace', filter: (g: TotalsGame, f: ComputedFeatures) => f.spSum < medianSP && f.paceAvg < medianPace },
    { label: 'Low SP+, High Pace', filter: (g: TotalsGame, f: ComputedFeatures) => f.spSum < medianSP && f.paceAvg >= medianPace },
    { label: 'High SP+, Low Pace', filter: (g: TotalsGame, f: ComputedFeatures) => f.spSum >= medianSP && f.paceAvg < medianPace },
    { label: 'High SP+, High Pace', filter: (g: TotalsGame, f: ComputedFeatures) => f.spSum >= medianSP && f.paceAvg >= medianPace },
  ];

  console.log('Quadrant              | Games | Overs | Over%  | Avg Delta');
  console.log('----------------------|-------|-------|--------|----------');

  for (const q of quadrants) {
    const qGames = train2023.filter(g => {
      const f = computeFeatures(g, spMean, spStd, paceMean, paceStd);
      return q.filter(g, f);
    });

    const overs = qGames.filter(g => g.actual_total > g.total_open).length;
    const unders = qGames.filter(g => g.actual_total < g.total_open).length;
    const overPct = (overs / (overs + unders)) * 100;
    const avgDelta = qGames.reduce((a, g) => a + (g.actual_total - g.total_open), 0) / qGames.length;

    console.log(
      `${q.label.padEnd(21)} | ${qGames.length.toString().padStart(5)} | ${overs.toString().padStart(5)} | ` +
      `${overPct.toFixed(1).padStart(6)}% | ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}`
    );
  }

  // Model comparison
  console.log('\n=== MODEL COMPARISON (TRAIN 2023) ===\n');
  console.log('Model                           | Bets | Wins | Win%  | ROI');
  console.log('--------------------------------|------|------|-------|-------');

  const models = [
    {
      name: 'Baseline (random)',
      getEdge: () => 0,  // Always returns 0, so random
    },
    {
      name: 'SP+ only (high→OVER)',
      getEdge: (_g: TotalsGame, f: ComputedFeatures) => f.spSum - spMean,
    },
    {
      name: 'SP+ only (high→UNDER)',
      getEdge: (_g: TotalsGame, f: ComputedFeatures) => -(f.spSum - spMean),
    },
    {
      name: 'Pace only (high→OVER)',
      getEdge: (_g: TotalsGame, f: ComputedFeatures) => f.paceAvg - paceMean,
    },
    {
      name: 'SP+ × Pace interaction',
      getEdge: (_g: TotalsGame, f: ComputedFeatures) => f.spPaceProduct,
    },
    {
      name: 'High SP+ + Low Pace → UNDER',
      getEdge: (_g: TotalsGame, f: ComputedFeatures) => {
        const spZ = (f.spSum - spMean) / spStd;
        const paceZ = (f.paceAvg - paceMean) / paceStd;
        // Bet UNDER when SP+ high but pace low
        if (spZ > 0.5 && paceZ < -0.5) return -1;
        // Bet OVER when SP+ high and pace high
        if (spZ > 0.5 && paceZ > 0.5) return 1;
        return 0;  // No bet otherwise
      },
    },
    {
      name: 'Pace-adjusted SP+ (SP+ × pace_ratio)',
      getEdge: (_g: TotalsGame, f: ComputedFeatures) => {
        const paceRatio = f.paceAvg / paceMean;  // >1 = faster than avg
        const spDelta = f.spSum - spMean;
        return spDelta * (paceRatio - 1);  // Amplify SP+ by pace excess
      },
    },
  ];

  const trainResults: Array<{ name: string; result: ModelResult }> = [];

  for (const model of models) {
    // For models that return 0 edge, we need special handling
    if (model.name === 'Baseline (random)') {
      // Simulate random betting
      let wins = 0;
      let losses = 0;
      for (const g of train2023) {
        const betOver = Math.random() > 0.5;
        if (betOver && g.actual_total > g.total_open) wins++;
        else if (betOver && g.actual_total < g.total_open) losses++;
        else if (!betOver && g.actual_total < g.total_open) wins++;
        else if (!betOver && g.actual_total > g.total_open) losses++;
      }
      const totalBets = wins + losses;
      const units = wins * 1.0 - losses * 1.1;
      const result: ModelResult = {
        name: model.name,
        bets: totalBets,
        wins,
        winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
        roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
      };
      trainResults.push({ name: model.name, result });
      console.log(
        `${model.name.padEnd(31)} | ${result.bets.toString().padStart(4)} | ${result.wins.toString().padStart(4)} | ` +
        `${result.winRate.toFixed(1).padStart(5)}% | ${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}%`
      );
      continue;
    }

    // For conditional models, count how many bets are made
    let bets = 0;
    let wins = 0;
    let losses = 0;

    for (const g of train2023) {
      const f = computeFeatures(g, spMean, spStd, paceMean, paceStd);
      const edge = model.getEdge(g, f);

      if (edge === 0) continue;  // No bet

      bets++;
      const betOver = edge > 0;
      if (betOver && g.actual_total > g.total_open) wins++;
      else if (betOver && g.actual_total < g.total_open) losses++;
      else if (!betOver && g.actual_total < g.total_open) wins++;
      else if (!betOver && g.actual_total > g.total_open) losses++;
    }

    const totalBets = wins + losses;
    const units = wins * 1.0 - losses * 1.1;
    const result: ModelResult = {
      name: model.name,
      bets: totalBets,
      wins,
      winRate: totalBets > 0 ? (wins / totalBets) * 100 : 0,
      roi: totalBets > 0 ? (units / (totalBets * 1.1)) * 100 : 0,
    };
    trainResults.push({ name: model.name, result });

    console.log(
      `${model.name.padEnd(31)} | ${result.bets.toString().padStart(4)} | ${result.wins.toString().padStart(4)} | ` +
      `${result.winRate.toFixed(1).padStart(5)}% | ${result.roi >= 0 ? '+' : ''}${result.roi.toFixed(1)}%`
    );
  }

  // Find best model
  const bestModel = trainResults.filter(r => r.result.bets > 20).reduce((a, b) =>
    a.result.roi > b.result.roi ? a : b
  );

  console.log(`\nBest model on train: ${bestModel.name}`);
  console.log(`  Win Rate: ${bestModel.result.winRate.toFixed(1)}%, ROI: ${bestModel.result.roi >= 0 ? '+' : ''}${bestModel.result.roi.toFixed(1)}%`);

  // 2024 Holdout
  console.log('\n=== 2024 HOLDOUT ===\n');

  const bestModelDef = models.find(m => m.name === bestModel.name);
  if (!bestModelDef) return;

  let holdoutWins = 0;
  let holdoutLosses = 0;

  for (const g of test2024) {
    const f = computeFeatures(g, spMean, spStd, paceMean, paceStd);
    const edge = bestModelDef.getEdge(g, f);

    if (edge === 0) continue;

    const betOver = edge > 0;
    if (betOver && g.actual_total > g.total_open) holdoutWins++;
    else if (betOver && g.actual_total < g.total_open) holdoutLosses++;
    else if (!betOver && g.actual_total < g.total_open) holdoutWins++;
    else if (!betOver && g.actual_total > g.total_open) holdoutLosses++;
  }

  const holdoutBets = holdoutWins + holdoutLosses;
  const holdoutUnits = holdoutWins * 1.0 - holdoutLosses * 1.1;
  const holdoutWinRate = holdoutBets > 0 ? (holdoutWins / holdoutBets) * 100 : 0;
  const holdoutROI = holdoutBets > 0 ? (holdoutUnits / (holdoutBets * 1.1)) * 100 : 0;

  console.log(`Model: ${bestModel.name}`);
  console.log(`Bets: ${holdoutBets}`);
  console.log(`Wins: ${holdoutWins}`);
  console.log(`Win Rate: ${holdoutWinRate.toFixed(1)}%`);
  console.log(`ROI: ${holdoutROI >= 0 ? '+' : ''}${holdoutROI.toFixed(1)}%`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`\nSP+ × Pace interaction model:`);
  console.log(`  Train 2023: ${bestModel.result.winRate.toFixed(1)}% win rate, ${bestModel.result.roi >= 0 ? '+' : ''}${bestModel.result.roi.toFixed(1)}% ROI`);
  console.log(`  Test 2024:  ${holdoutWinRate.toFixed(1)}% win rate, ${holdoutROI >= 0 ? '+' : ''}${holdoutROI.toFixed(1)}% ROI`);

  if (holdoutROI > 0) {
    console.log('\n  → Interaction model shows promise, proceed to Test 3');
  } else if (holdoutROI > bestModel.result.roi - 10) {
    console.log('\n  → Minor degradation on holdout, investigate further');
  } else {
    console.log('\n  → Significant degradation, interaction not stable');
  }
}

main().catch(console.error);
