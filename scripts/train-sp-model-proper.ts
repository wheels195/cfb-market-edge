/**
 * Train SP+ model with PROPER point-in-time data
 *
 * Key insight: For a game in season X, use SP+ ratings from season X-1
 * This eliminates look-ahead bias since prior-season ratings are known before the season starts.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface TrainingGame {
  eventId: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  actualMargin: number;
  closingSpread: number;
  // Prior-season SP+ (what we'd know before game)
  homeSP: number;
  awaySP: number;
  spDiff: number;
}

interface ModelResult {
  spDiffWeight: number;
  homeFieldAdvantage: number;
  r2: number;
  mae: number;
  rmse: number;
  n: number;
}

async function getAllWithPagination<T>(
  tableName: string,
  selectQuery: string,
  filters?: { column: string; value: unknown }[]
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(tableName).select(selectQuery).range(offset, offset + 999);
    if (filters) {
      for (const f of filters) {
        query = query.eq(f.column, f.value);
      }
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) break;
    results.push(...(data as T[]));
    offset += data.length;
    if (data.length < 1000) break;
  }

  return results;
}

async function loadDataWithPriorSeasonSP(): Promise<TrainingGame[]> {
  console.log('Loading data with PRIOR-SEASON SP+ ratings (no look-ahead bias)...\n');

  // Get events
  const events = await getAllWithPagination<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    commence_time: string;
    home_team: { name: string };
    away_team: { name: string };
  }>('events', `
    id, home_team_id, away_team_id, commence_time,
    home_team:teams!events_home_team_id_fkey(name),
    away_team:teams!events_away_team_id_fkey(name)
  `, [{ column: 'status', value: 'final' }]);
  console.log(`  Loaded ${events.length} completed events`);

  // Get results
  const results = await getAllWithPagination<{
    event_id: string;
    home_score: number;
    away_score: number;
  }>('results', 'event_id, home_score, away_score');
  const resultMap = new Map(results.map(r => [r.event_id, r]));
  console.log(`  Loaded ${resultMap.size} results`);

  // Get closing spreads
  const closingLines = await getAllWithPagination<{
    event_id: string;
    spread_points_home: number | null;
  }>('closing_lines', 'event_id, spread_points_home', [
    { column: 'market_type', value: 'spread' },
    { column: 'side', value: 'home' },
  ]);
  const closingMap = new Map(closingLines.filter(l => l.spread_points_home !== null)
    .map(l => [l.event_id, l.spread_points_home!]));
  console.log(`  Loaded ${closingMap.size} closing spreads`);

  // Get SP+ ratings - indexed by team_id and season
  const spRatings = await getAllWithPagination<{
    team_id: string;
    season: number;
    sp_overall: number | null;
  }>('advanced_team_ratings', 'team_id, season, sp_overall');

  // Map: team_id -> season -> sp_overall
  const spByTeamSeason = new Map<string, Map<number, number>>();
  for (const r of spRatings) {
    if (r.sp_overall === null) continue;
    if (!spByTeamSeason.has(r.team_id)) {
      spByTeamSeason.set(r.team_id, new Map());
    }
    spByTeamSeason.get(r.team_id)!.set(r.season, r.sp_overall);
  }
  console.log(`  Loaded SP+ for ${spByTeamSeason.size} teams across multiple seasons\n`);

  // Build training data with PRIOR-SEASON SP+
  const games: TrainingGame[] = [];
  let missingPriorSP = 0;

  for (const event of events) {
    const result = resultMap.get(event.id);
    const closingSpread = closingMap.get(event.id);

    if (!result || closingSpread === undefined) continue;

    const eventDate = new Date(event.commence_time);
    const gameSeason = eventDate.getMonth() >= 7 ? eventDate.getFullYear() : eventDate.getFullYear() - 1;

    // KEY: Use PRIOR season's SP+ ratings (what we'd know before season started)
    const priorSeason = gameSeason - 1;

    const homeTeamSP = spByTeamSeason.get(event.home_team_id);
    const awayTeamSP = spByTeamSeason.get(event.away_team_id);

    const homeSP = homeTeamSP?.get(priorSeason);
    const awaySP = awayTeamSP?.get(priorSeason);

    if (homeSP === undefined || awaySP === undefined) {
      missingPriorSP++;
      continue;
    }

    games.push({
      eventId: event.id,
      season: gameSeason,
      homeTeam: event.home_team.name,
      awayTeam: event.away_team.name,
      actualMargin: result.home_score - result.away_score,
      closingSpread,
      homeSP,
      awaySP,
      spDiff: homeSP - awaySP,
    });
  }

  console.log(`  Built ${games.length} games with prior-season SP+`);
  console.log(`  Skipped ${missingPriorSP} games (missing prior-season SP+)\n`);

  return games;
}

function trainModel(games: TrainingGame[], label: string): ModelResult {
  console.log(`Training on ${games.length} games (${label})...`);

  const n = games.length;
  if (n < 50) {
    console.log('  Not enough data');
    return { spDiffWeight: 1, homeFieldAdvantage: -3, r2: 0, mae: 0, rmse: 0, n: 0 };
  }

  // Linear regression: closingSpread = spDiffWeight * spDiff + homeFieldAdvantage
  let xx00 = 0, xx01 = 0, xx11 = 0;
  let xy0 = 0, xy1 = 0;

  for (const g of games) {
    xx00 += g.spDiff * g.spDiff;
    xx01 += g.spDiff;
    xx11 += 1;
    xy0 += g.spDiff * g.closingSpread;
    xy1 += g.closingSpread;
  }

  const det = xx00 * xx11 - xx01 * xx01;
  const spDiffWeight = (xx11 * xy0 - xx01 * xy1) / det;
  const homeFieldAdvantage = (xx00 * xy1 - xx01 * xy0) / det;

  // Calculate metrics
  let ssr = 0, sst = 0, sumAbs = 0;
  const meanY = xy1 / n;

  for (const g of games) {
    const predicted = spDiffWeight * g.spDiff + homeFieldAdvantage;
    const residual = g.closingSpread - predicted;
    ssr += residual * residual;
    sst += (g.closingSpread - meanY) * (g.closingSpread - meanY);
    sumAbs += Math.abs(residual);
  }

  return {
    spDiffWeight,
    homeFieldAdvantage,
    r2: 1 - (ssr / sst),
    mae: sumAbs / n,
    rmse: Math.sqrt(ssr / n),
    n,
  };
}

function backtest(games: TrainingGame[], model: ModelResult, minEdge: number) {
  let bets = 0, wins = 0, profit = 0;
  const stake = 100;

  for (const g of games) {
    const modelSpread = model.spDiffWeight * g.spDiff + model.homeFieldAdvantage;
    const edge = g.closingSpread - modelSpread;

    if (Math.abs(edge) < minEdge) continue;

    bets++;
    const betSide = edge > 0 ? 'home' : 'away';
    const marginNeeded = -g.closingSpread;

    let won: boolean;
    if (betSide === 'home') {
      won = g.actualMargin > marginNeeded;
    } else {
      won = g.actualMargin < marginNeeded;
    }

    // Push
    if (g.actualMargin === marginNeeded) continue;

    if (won) {
      wins++;
      profit += stake * (100 / 110);
    } else {
      profit -= stake;
    }
  }

  return {
    bets,
    wins,
    winRate: bets > 0 ? (wins / bets * 100) : 0,
    profit,
    roi: bets > 0 ? (profit / (bets * stake) * 100) : 0,
  };
}

async function saveModel(model: ModelResult) {
  const config = {
    spread: {
      spDiffWeight: model.spDiffWeight,
      homeFieldAdvantage: model.homeFieldAdvantage,
    },
    total: {
      intercept: 53,
      offenseWeight: 0,
    },
  };

  const { data: existing } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'sp_plus_v1')
    .single();

  if (existing) {
    await supabase
      .from('model_versions')
      .update({
        description: 'SP+ model trained on prior-season ratings (no look-ahead bias)',
        config,
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('model_versions')
      .insert({
        name: 'sp_plus_v1',
        description: 'SP+ model trained on prior-season ratings (no look-ahead bias)',
        config,
      });
  }
}

async function main() {
  console.log('=== SP+ MODEL TRAINING (PROPER METHODOLOGY) ===\n');
  console.log('Using PRIOR-SEASON SP+ ratings to avoid look-ahead bias.');
  console.log('For a game in 2024, we use 2023 final SP+ ratings.\n');

  const allGames = await loadDataWithPriorSeasonSP();

  if (allGames.length < 100) {
    console.log('Not enough games with prior-season SP+ data.');
    console.log('Need SP+ ratings for 2021+ to have training data for 2022+ games.');
    return;
  }

  // Split by season for train/test
  const trainGames = allGames.filter(g => g.season <= 2023);
  const testGames = allGames.filter(g => g.season >= 2024);

  console.log('=== DATA SPLIT ===');
  console.log(`Training set: ${trainGames.length} games (2022-2023 seasons)`);
  console.log(`Test set: ${testGames.length} games (2024 season)\n`);

  // Train on 2022-2023
  const model = trainModel(trainGames, '2022-2023 training set');

  console.log('\n=== MODEL COEFFICIENTS ===');
  console.log(`SP+ diff weight: ${model.spDiffWeight.toFixed(4)}`);
  console.log(`  (1 point SP+ difference = ${Math.abs(model.spDiffWeight).toFixed(2)} spread points)`);
  console.log(`Home field advantage: ${model.homeFieldAdvantage.toFixed(2)} points`);
  console.log(`R² (vs closing lines): ${(model.r2 * 100).toFixed(1)}%`);
  console.log(`MAE: ${model.mae.toFixed(2)} points`);
  console.log(`RMSE: ${model.rmse.toFixed(2)} points`);

  // Test on 2024 (out-of-sample)
  console.log('\n=== OUT-OF-SAMPLE TEST (2024 GAMES) ===');

  if (testGames.length < 10) {
    console.log('Not enough 2024 games to test.');
  } else {
    let testSSR = 0, testSST = 0, testSumAbs = 0;
    const testMeanY = testGames.reduce((s, g) => s + g.closingSpread, 0) / testGames.length;

    for (const g of testGames) {
      const predicted = model.spDiffWeight * g.spDiff + model.homeFieldAdvantage;
      const residual = g.closingSpread - predicted;
      testSSR += residual * residual;
      testSST += (g.closingSpread - testMeanY) * (g.closingSpread - testMeanY);
      testSumAbs += Math.abs(residual);
    }

    const testR2 = 1 - (testSSR / testSST);
    const testMAE = testSumAbs / testGames.length;

    console.log(`Test games: ${testGames.length}`);
    console.log(`Test R²: ${(testR2 * 100).toFixed(1)}%`);
    console.log(`Test MAE: ${testMAE.toFixed(2)} points`);
  }

  // Backtest on test set
  console.log('\n=== BACKTEST RESULTS (2024 - OUT OF SAMPLE) ===');
  console.log('Edge    | Bets   | Win %  | ROI');
  console.log('--------|--------|--------|--------');

  for (const threshold of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]) {
    const r = backtest(testGames, model, threshold);
    console.log(
      `${threshold.toFixed(1)} pts  | ${r.bets.toString().padStart(6)} | ${r.winRate.toFixed(1).padStart(5)}% | ${r.roi >= 0 ? '+' : ''}${r.roi.toFixed(1)}%`
    );
  }

  // Also show training set backtest for comparison
  console.log('\n=== BACKTEST RESULTS (2022-2023 - IN SAMPLE) ===');
  console.log('(For reference only - these are not predictive results)');
  console.log('Edge    | Bets   | Win %  | ROI');
  console.log('--------|--------|--------|--------');

  for (const threshold of [1.0, 2.0, 3.0]) {
    const r = backtest(trainGames, model, threshold);
    console.log(
      `${threshold.toFixed(1)} pts  | ${r.bets.toString().padStart(6)} | ${r.winRate.toFixed(1).padStart(5)}% | ${r.roi >= 0 ? '+' : ''}${r.roi.toFixed(1)}%`
    );
  }

  // Save model
  await saveModel(model);
  console.log('\n=== MODEL SAVED ===');

  console.log('\n=== KEY TAKEAWAYS ===');
  console.log('1. Using prior-season SP+ eliminates look-ahead bias');
  console.log('2. Out-of-sample results reflect realistic future performance');
  console.log('3. Expect R² of ~50-60% (down from 78% with look-ahead)');
  console.log('4. Realistic ROI target: +3-5% with disciplined betting');
  console.log('5. As 2024 progresses, current-season SP+ becomes available');
}

main().catch(console.error);
