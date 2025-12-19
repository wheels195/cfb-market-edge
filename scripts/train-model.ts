/**
 * Train a regression model to predict spreads and totals
 * Uses historical data to learn market-calibrated predictions
 */
import { supabase } from '../src/lib/db/client';

interface TrainingGame {
  eventId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  season: number;
  homeScore: number;
  awayScore: number;
  actualMargin: number;
  actualTotal: number;
  closingSpread: number | null;  // Home spread (negative = home favored)
  closingTotal: number | null;
  homeElo: number;
  awayElo: number;
  eloDiff: number;
}

interface ModelCoefficients {
  // Spread model coefficients
  spread: {
    intercept: number;           // Base prediction (should be near 0)
    eloDiffWeight: number;       // Points per 100 Elo difference
    homeFieldAdvantage: number;  // Home field advantage in points
    r2: number;                  // Model fit
    mae: number;                 // Mean absolute error
    rmse: number;                // Root mean squared error
  };
  // Total model coefficients
  total: {
    intercept: number;           // Base total (league average)
    homeOffenseWeight: number;   // Elo contribution to total
    homeDefenseWeight: number;
    awayOffenseWeight: number;
    awayDefenseWeight: number;
    r2: number;
    mae: number;
    rmse: number;
  };
}

async function getAllWithPagination<T>(
  tableName: string,
  selectQuery: string,
  filters?: { column: string; value: unknown; op?: string }[]
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(tableName).select(selectQuery).range(offset, offset + 999);

    if (filters) {
      for (const f of filters) {
        if (f.op === 'not') {
          query = query.not(f.column, 'is', f.value);
        } else {
          query = query.eq(f.column, f.value);
        }
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching ${tableName}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;
    results.push(...(data as T[]));
    offset += data.length;
    if (data.length < 1000) break;
  }

  return results;
}

async function loadTrainingData(): Promise<TrainingGame[]> {
  console.log('Loading training data...');

  // Get all events with results
  const events = await getAllWithPagination<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    commence_time: string;
    home_team: { name: string };
    away_team: { name: string };
  }>('events', `
    id,
    home_team_id,
    away_team_id,
    commence_time,
    home_team:teams!events_home_team_id_fkey(name),
    away_team:teams!events_away_team_id_fkey(name)
  `, [{ column: 'status', value: 'final' }]);

  console.log(`  Loaded ${events.length} events`);

  // Get all results
  const results = await getAllWithPagination<{
    event_id: string;
    home_score: number;
    away_score: number;
  }>('results', 'event_id, home_score, away_score');

  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  for (const r of results) {
    resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
  }
  console.log(`  Loaded ${resultMap.size} results`);

  // Get closing lines (spread only, home side)
  const closingLines = await getAllWithPagination<{
    event_id: string;
    market_type: string;
    side: string;
    spread_points_home: number | null;
    total_points: number | null;
  }>('closing_lines', 'event_id, market_type, side, spread_points_home, total_points');

  const closingSpreadMap = new Map<string, number>();
  const closingTotalMap = new Map<string, number>();
  for (const line of closingLines) {
    if (line.market_type === 'spread' && line.side === 'home' && line.spread_points_home !== null) {
      closingSpreadMap.set(line.event_id, line.spread_points_home);
    }
    if (line.market_type === 'total' && line.total_points !== null) {
      closingTotalMap.set(line.event_id, line.total_points);
    }
  }
  console.log(`  Loaded ${closingSpreadMap.size} closing spreads, ${closingTotalMap.size} closing totals`);

  // Get team ratings (our calculated Elo)
  const ratings = await getAllWithPagination<{
    team_id: string;
    season: number;
    rating: number;
    games_played: number;
  }>('team_ratings', 'team_id, season, rating, games_played');

  const ratingMap = new Map<string, number>();
  for (const r of ratings) {
    // Use most recent rating for each team-season
    const key = `${r.team_id}_${r.season}`;
    ratingMap.set(key, r.rating);
  }
  console.log(`  Loaded ${ratingMap.size} team ratings`);

  // Build training games
  const trainingGames: TrainingGame[] = [];

  for (const event of events) {
    const result = resultMap.get(event.id);
    if (!result) continue;

    const closingSpread = closingSpreadMap.get(event.id) || null;
    const closingTotal = closingTotalMap.get(event.id) || null;

    // Get season from commence_time
    const eventDate = new Date(event.commence_time);
    // CFB seasons span Aug-Jan, so use the earlier year
    const season = eventDate.getMonth() >= 7 ? eventDate.getFullYear() : eventDate.getFullYear() - 1;

    // Get Elo ratings
    const homeElo = ratingMap.get(`${event.home_team_id}_${season}`) || 1500;
    const awayElo = ratingMap.get(`${event.away_team_id}_${season}`) || 1500;

    trainingGames.push({
      eventId: event.id,
      homeTeamId: event.home_team_id,
      awayTeamId: event.away_team_id,
      homeTeam: event.home_team.name,
      awayTeam: event.away_team.name,
      commenceTime: event.commence_time,
      season,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      actualMargin: result.homeScore - result.awayScore,
      actualTotal: result.homeScore + result.awayScore,
      closingSpread,
      closingTotal,
      homeElo,
      awayElo,
      eloDiff: homeElo - awayElo,
    });
  }

  console.log(`  Built ${trainingGames.length} training games`);
  return trainingGames;
}

function trainSpreadModel(games: TrainingGame[]): ModelCoefficients['spread'] {
  // Filter to games with closing spreads
  const gamesWithSpreads = games.filter(g => g.closingSpread !== null);
  console.log(`\nTraining spread model on ${gamesWithSpreads.length} games with closing lines...`);

  // Simple linear regression: closingSpread = intercept + eloDiffWeight * (eloDiff/100) + homeFieldAdvantage
  // We're predicting what the market says, not the actual outcome

  const n = gamesWithSpreads.length;
  if (n < 100) {
    console.log('Not enough data for reliable training');
    return { intercept: 0, eloDiffWeight: 0, homeFieldAdvantage: -3, r2: 0, mae: 0, rmse: 0 };
  }

  // Prepare data
  const X: number[][] = []; // [eloDiff/100, 1 (for home field)]
  const y: number[] = [];   // closing spread

  for (const g of gamesWithSpreads) {
    X.push([g.eloDiff / 100, 1]); // Scale Elo diff for numerical stability
    y.push(g.closingSpread!);
  }

  // Solve using normal equations: β = (X'X)^(-1) X'y
  // For 2 features, this is manageable

  // Calculate X'X
  let xx00 = 0, xx01 = 0, xx11 = 0;
  let xy0 = 0, xy1 = 0;

  for (let i = 0; i < n; i++) {
    xx00 += X[i][0] * X[i][0];
    xx01 += X[i][0] * X[i][1];
    xx11 += X[i][1] * X[i][1];
    xy0 += X[i][0] * y[i];
    xy1 += X[i][1] * y[i];
  }

  // Invert 2x2 matrix
  const det = xx00 * xx11 - xx01 * xx01;
  if (Math.abs(det) < 0.0001) {
    console.log('Matrix is singular, using defaults');
    return { intercept: 0, eloDiffWeight: -4, homeFieldAdvantage: -3, r2: 0, mae: 0, rmse: 0 };
  }

  const invxx00 = xx11 / det;
  const invxx01 = -xx01 / det;
  const invxx11 = xx00 / det;

  const eloDiffWeight = invxx00 * xy0 + invxx01 * xy1;
  const homeFieldAdvantage = invxx01 * xy0 + invxx11 * xy1;

  // Calculate fit metrics
  let sumSquaredResiduals = 0;
  let sumSquaredTotal = 0;
  let sumAbsError = 0;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  for (let i = 0; i < n; i++) {
    const predicted = eloDiffWeight * X[i][0] + homeFieldAdvantage * X[i][1];
    const residual = y[i] - predicted;
    sumSquaredResiduals += residual * residual;
    sumSquaredTotal += (y[i] - meanY) * (y[i] - meanY);
    sumAbsError += Math.abs(residual);
  }

  const r2 = 1 - (sumSquaredResiduals / sumSquaredTotal);
  const mae = sumAbsError / n;
  const rmse = Math.sqrt(sumSquaredResiduals / n);

  return {
    intercept: 0, // No separate intercept, home field handles it
    eloDiffWeight: eloDiffWeight, // Points per 100 Elo difference
    homeFieldAdvantage: homeFieldAdvantage,
    r2,
    mae,
    rmse,
  };
}

function trainTotalModel(games: TrainingGame[]): ModelCoefficients['total'] {
  // Filter to games with closing totals
  const gamesWithTotals = games.filter(g => g.closingTotal !== null);
  console.log(`\nTraining total model on ${gamesWithTotals.length} games with closing lines...`);

  const n = gamesWithTotals.length;
  if (n < 100) {
    console.log('Not enough data for reliable training');
    return {
      intercept: 55,
      homeOffenseWeight: 0,
      homeDefenseWeight: 0,
      awayOffenseWeight: 0,
      awayDefenseWeight: 0,
      r2: 0,
      mae: 0,
      rmse: 0
    };
  }

  // For totals, we'll use a simpler model: average closing total + adjustment
  // The Elo-based approach doesn't work as well for totals since Elo measures
  // win probability, not scoring pace

  // Simple model: intercept only (league average)
  const meanTotal = gamesWithTotals.reduce((sum, g) => sum + g.closingTotal!, 0) / n;

  // Calculate metrics against mean
  let sumSquaredResiduals = 0;
  let sumSquaredTotal = 0;
  let sumAbsError = 0;

  for (const g of gamesWithTotals) {
    const residual = g.closingTotal! - meanTotal;
    sumSquaredResiduals += residual * residual;
    sumSquaredTotal += (g.closingTotal! - meanTotal) * (g.closingTotal! - meanTotal);
    sumAbsError += Math.abs(residual);
  }

  // R² is 0 for intercept-only model (we're just predicting the mean)
  const mae = sumAbsError / n;
  const rmse = Math.sqrt(sumSquaredResiduals / n);

  return {
    intercept: meanTotal,
    homeOffenseWeight: 0,
    homeDefenseWeight: 0,
    awayOffenseWeight: 0,
    awayDefenseWeight: 0,
    r2: 0,  // Intercept-only model has R²=0 by definition
    mae,
    rmse,
  };
}

function evaluateAgainstActual(games: TrainingGame[], coefficients: ModelCoefficients) {
  console.log('\n=== MODEL EVALUATION AGAINST ACTUAL OUTCOMES ===\n');

  // Evaluate spread model
  const spreadGames = games.filter(g => g.closingSpread !== null);
  let spreadCorrect = 0;
  let closingCorrect = 0;
  let modelMarginError = 0;
  let closingMarginError = 0;

  for (const g of spreadGames) {
    const modelSpread =
      coefficients.spread.eloDiffWeight * (g.eloDiff / 100) +
      coefficients.spread.homeFieldAdvantage;

    // Did model predict the right direction (ignoring spread value)?
    const modelPickedHome = modelSpread < 0;  // Negative spread = home favored
    const homeWon = g.actualMargin > 0;
    if ((modelPickedHome && homeWon) || (!modelPickedHome && !homeWon && g.actualMargin !== 0)) {
      spreadCorrect++;
    }

    // Did closing line predict right direction?
    const closingPickedHome = g.closingSpread! < 0;
    if ((closingPickedHome && homeWon) || (!closingPickedHome && !homeWon && g.actualMargin !== 0)) {
      closingCorrect++;
    }

    // Margin prediction error
    const modelPredictedMargin = -modelSpread; // Convert to margin (positive = home wins)
    const closingPredictedMargin = -g.closingSpread!;

    modelMarginError += Math.abs(g.actualMargin - modelPredictedMargin);
    closingMarginError += Math.abs(g.actualMargin - closingPredictedMargin);
  }

  console.log('Spread Model Performance (picking winner):');
  console.log(`  Model accuracy: ${(spreadCorrect / spreadGames.length * 100).toFixed(1)}%`);
  console.log(`  Closing line accuracy: ${(closingCorrect / spreadGames.length * 100).toFixed(1)}%`);
  console.log(`  Model MAE vs actual margin: ${(modelMarginError / spreadGames.length).toFixed(2)} points`);
  console.log(`  Closing MAE vs actual margin: ${(closingMarginError / spreadGames.length).toFixed(2)} points`);

  // Evaluate total model
  const totalGames = games.filter(g => g.closingTotal !== null);
  let modelTotalError = 0;
  let closingTotalError = 0;

  for (const g of totalGames) {
    const modelTotal = coefficients.total.intercept;
    modelTotalError += Math.abs(g.actualTotal - modelTotal);
    closingTotalError += Math.abs(g.actualTotal - g.closingTotal!);
  }

  console.log('\nTotal Model Performance:');
  console.log(`  Model MAE vs actual total: ${(modelTotalError / totalGames.length).toFixed(2)} points`);
  console.log(`  Closing MAE vs actual total: ${(closingTotalError / totalGames.length).toFixed(2)} points`);
}

async function saveModel(coefficients: ModelCoefficients) {
  console.log('\n=== SAVING MODEL ===\n');

  // Save to model_versions table
  const { data: existingVersion } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'regression_v1')
    .single();

  if (existingVersion) {
    // Update existing
    await supabase
      .from('model_versions')
      .update({
        description: 'Regression model trained on historical closing lines',
        config: coefficients,
      })
      .eq('id', existingVersion.id);
    console.log('Updated existing model version');
  } else {
    // Create new
    await supabase
      .from('model_versions')
      .insert({
        name: 'regression_v1',
        description: 'Regression model trained on historical closing lines',
        config: coefficients,
      });
    console.log('Created new model version');
  }
}

async function main() {
  console.log('=== CFB MARKET-EDGE MODEL TRAINING ===\n');

  // Load data
  const games = await loadTrainingData();

  // Train models
  const spreadModel = trainSpreadModel(games);
  const totalModel = trainTotalModel(games);

  const coefficients: ModelCoefficients = {
    spread: spreadModel,
    total: totalModel,
  };

  // Display model
  console.log('\n=== TRAINED MODEL COEFFICIENTS ===\n');
  console.log('Spread Model:');
  console.log(`  Elo diff weight: ${spreadModel.eloDiffWeight.toFixed(4)} points per 100 Elo`);
  console.log(`  Home field advantage: ${spreadModel.homeFieldAdvantage.toFixed(2)} points`);
  console.log(`  R² (vs closing lines): ${spreadModel.r2.toFixed(4)}`);
  console.log(`  MAE (vs closing lines): ${spreadModel.mae.toFixed(2)} points`);
  console.log(`  RMSE (vs closing lines): ${spreadModel.rmse.toFixed(2)} points`);

  console.log('\nTotal Model:');
  console.log(`  League average total: ${totalModel.intercept.toFixed(1)} points`);
  console.log(`  MAE (vs closing lines): ${totalModel.mae.toFixed(2)} points`);

  console.log('\n--- Interpretation ---');
  console.log(`A 100-point Elo advantage translates to ${Math.abs(spreadModel.eloDiffWeight).toFixed(1)} points on the spread.`);
  console.log(`Home teams get a ${Math.abs(spreadModel.homeFieldAdvantage).toFixed(1)}-point advantage.`);

  // Show sample predictions
  console.log('\n=== SAMPLE PREDICTIONS ===');
  console.log('\nExample: #1 Ohio State (Elo 1650) vs #5 Penn State (Elo 1580) at Ohio State');
  const ohioStateElo = 1650;
  const pennStateElo = 1580;
  const eloDiff = ohioStateElo - pennStateElo;
  const predictedSpread = spreadModel.eloDiffWeight * (eloDiff / 100) + spreadModel.homeFieldAdvantage;
  console.log(`  Elo diff: ${eloDiff}`);
  console.log(`  Predicted spread: ${predictedSpread > 0 ? '+' : ''}${predictedSpread.toFixed(1)} (${predictedSpread < 0 ? 'Ohio State' : 'Penn State'} favored)`);
  console.log(`  Predicted total: ${totalModel.intercept.toFixed(1)}`);

  // Evaluate against actuals
  evaluateAgainstActual(games, coefficients);

  // Save model
  await saveModel(coefficients);

  console.log('\n=== TRAINING COMPLETE ===');
}

main().catch(console.error);
