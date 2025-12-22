/**
 * CBB Ratings Model Backtest
 *
 * Tests whether net rating differential can predict spreads profitably.
 * Uses prior season ratings to avoid point-in-time leakage.
 *
 * Train: 2023 season (using 2022 ratings)
 * Test: 2024 season (using 2023 ratings)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface BacktestGame {
  game_id: string;
  season: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  spread_t60: number;
  spread_close: number;
  home_net_rating: number;
  away_net_rating: number;
}

interface BetResult {
  game_id: string;
  season: number;
  market_spread: number;
  model_spread: number;
  edge: number;
  bet_side: 'home' | 'away';
  actual_margin: number; // home - away
  won: boolean;
  profit: number; // at -110
}

// ============================================
// STEP 1: Build Dataset
// ============================================

async function buildDataset(): Promise<BacktestGame[]> {
  console.log('\n=== STEP 1: Building Dataset ===\n');

  const games: BacktestGame[] = [];

  // Get all games with T-60 spreads
  const { data: bettingLines, error: linesError } = await supabase
    .from('cbb_betting_lines')
    .select('game_id, spread_t60, spread_close')
    .not('spread_t60', 'is', null);

  if (linesError || !bettingLines) {
    console.error('Error fetching betting lines:', linesError);
    return [];
  }

  console.log(`Found ${bettingLines.length} games with T-60 spreads`);

  // Create lookup map
  const linesByGame = new Map<string, { spread_t60: number; spread_close: number }>();
  for (const line of bettingLines) {
    linesByGame.set(line.game_id, {
      spread_t60: line.spread_t60,
      spread_close: line.spread_close
    });
  }

  // Get games with scores
  const { data: gameData, error: gamesError } = await supabase
    .from('cbb_games')
    .select('id, season, home_team_id, away_team_id, home_score, away_score')
    .not('home_score', 'is', null)
    .in('season', [2023, 2024]);

  if (gamesError || !gameData) {
    console.error('Error fetching games:', gamesError);
    return [];
  }

  console.log(`Found ${gameData.length} completed games in 2023-2024`);

  // Get all ratings
  const { data: ratings, error: ratingsError } = await supabase
    .from('cbb_team_ratings')
    .select('team_id, season, net_rating')
    .in('season', [2022, 2023]);

  if (ratingsError || !ratings) {
    console.error('Error fetching ratings:', ratingsError);
    return [];
  }

  // Create ratings lookup: team_id -> season -> net_rating
  const ratingsMap = new Map<string, Map<number, number>>();
  for (const r of ratings) {
    if (!ratingsMap.has(r.team_id)) {
      ratingsMap.set(r.team_id, new Map());
    }
    ratingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }

  console.log(`Loaded ratings for ${ratingsMap.size} teams`);

  // Join everything
  for (const game of gameData) {
    const line = linesByGame.get(game.id);
    if (!line) continue;

    // Use PRIOR season ratings (avoid leakage)
    const priorSeason = game.season - 1;
    const homeRating = ratingsMap.get(game.home_team_id)?.get(priorSeason);
    const awayRating = ratingsMap.get(game.away_team_id)?.get(priorSeason);

    if (homeRating === undefined || awayRating === undefined) continue;

    games.push({
      game_id: game.id,
      season: game.season,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_score: game.home_score,
      away_score: game.away_score,
      spread_t60: line.spread_t60,
      spread_close: line.spread_close,
      home_net_rating: homeRating,
      away_net_rating: awayRating,
    });
  }

  console.log(`\nFinal dataset: ${games.length} games with all required data`);
  console.log(`  2023: ${games.filter(g => g.season === 2023).length} games`);
  console.log(`  2024: ${games.filter(g => g.season === 2024).length} games`);

  return games;
}

// ============================================
// STEP 2: Model Functions
// ============================================

function calculateModelSpread(
  homeNetRating: number,
  awayNetRating: number,
  K: number,
  HFA: number
): number {
  // Positive spread = home is underdog
  // Net rating: higher = better team
  // If home has higher rating, they should be favored (negative spread)
  return (awayNetRating - homeNetRating) / K + HFA;
}

function runBacktest(
  games: BacktestGame[],
  K: number,
  HFA: number,
  minEdge: number,
  maxEdge: number
): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const modelSpread = calculateModelSpread(
      game.home_net_rating,
      game.away_net_rating,
      K,
      HFA
    );

    // Edge = market - model
    // Positive edge = market thinks home is worse than model does = bet home
    const edge = game.spread_t60 - modelSpread;
    const absEdge = Math.abs(edge);

    // Filter by edge range
    if (absEdge < minEdge || absEdge > maxEdge) continue;

    const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
    const actualMargin = game.home_score - game.away_score;

    // Did the bet win?
    // Betting home at spread_t60: win if actualMargin > -spread_t60
    // Betting away at spread_t60: win if actualMargin < -spread_t60
    let won: boolean;
    if (betSide === 'home') {
      won = actualMargin > -game.spread_t60;
    } else {
      won = actualMargin < -game.spread_t60;
    }

    // Handle push
    if (actualMargin === -game.spread_t60) {
      continue; // Skip pushes
    }

    const profit = won ? 0.91 : -1.0; // -110 odds

    results.push({
      game_id: game.game_id,
      season: game.season,
      market_spread: game.spread_t60,
      model_spread: modelSpread,
      edge,
      bet_side: betSide,
      actual_margin: actualMargin,
      won,
      profit,
    });
  }

  return results;
}

function summarizeResults(results: BetResult[], label: string): void {
  if (results.length === 0) {
    console.log(`${label}: No bets`);
    return;
  }

  const wins = results.filter(r => r.won).length;
  const losses = results.length - wins;
  const winRate = wins / results.length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const roi = totalProfit / results.length;

  console.log(`${label}:`);
  console.log(`  Bets: ${results.length} | W-L: ${wins}-${losses} | Win%: ${(winRate * 100).toFixed(1)}% | ROI: ${(roi * 100).toFixed(1)}%`);
}

// ============================================
// STEP 3: Run Analysis
// ============================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          CBB RATINGS MODEL BACKTEST                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Build dataset
  const allGames = await buildDataset();
  if (allGames.length === 0) {
    console.error('No games found!');
    return;
  }

  const trainGames = allGames.filter(g => g.season === 2023);
  const testGames = allGames.filter(g => g.season === 2024);

  console.log('\n=== STEP 2: Baseline (Bet All Games) ===\n');

  // Baseline: bet all games with any model (K=3, HFA=3)
  const baselineResults = runBacktest(trainGames, 3, 3, 0, 100);
  summarizeResults(baselineResults, 'Baseline (all games, K=3, HFA=3)');

  console.log('\n=== STEP 3: Grid Search on Train Set (2023) ===\n');

  // Grid search
  const kValues = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const hfaValues = [2.0, 2.5, 3.0, 3.5, 4.0];

  let bestK = 3;
  let bestHFA = 3;
  let bestROI = -999;
  let bestWinRate = 0;
  let bestBets = 0;

  console.log('Grid Search Results (2.5-5 pt edge filter):');
  console.log('-'.repeat(60));

  for (const K of kValues) {
    for (const HFA of hfaValues) {
      const results = runBacktest(trainGames, K, HFA, 2.5, 5.0);
      if (results.length < 50) continue; // Need minimum sample

      const wins = results.filter(r => r.won).length;
      const winRate = wins / results.length;
      const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
      const roi = totalProfit / results.length;

      if (roi > bestROI) {
        bestROI = roi;
        bestK = K;
        bestHFA = HFA;
        bestWinRate = winRate;
        bestBets = results.length;
      }
    }
  }

  console.log(`\nBest Parameters: K=${bestK}, HFA=${bestHFA}`);
  console.log(`  Train ROI: ${(bestROI * 100).toFixed(1)}% | Win%: ${(bestWinRate * 100).toFixed(1)}% | Bets: ${bestBets}`);

  console.log('\n=== STEP 4: Edge Range Analysis (Best K/HFA) ===\n');

  // Test different edge ranges with best parameters
  const edgeRanges = [
    { min: 0, max: 1.5, label: '0-1.5 pts' },
    { min: 1.5, max: 2.5, label: '1.5-2.5 pts' },
    { min: 2.5, max: 3.5, label: '2.5-3.5 pts' },
    { min: 3.5, max: 5.0, label: '3.5-5.0 pts' },
    { min: 5.0, max: 7.0, label: '5.0-7.0 pts' },
    { min: 7.0, max: 100, label: '7.0+ pts' },
    { min: 2.5, max: 5.0, label: '2.5-5.0 pts (CFB range)' },
  ];

  console.log('Edge Range Analysis (Train 2023):');
  console.log('-'.repeat(60));

  for (const range of edgeRanges) {
    const results = runBacktest(trainGames, bestK, bestHFA, range.min, range.max);
    summarizeResults(results, range.label);
  }

  console.log('\n=== STEP 5: HOLDOUT VALIDATION (2024) ===\n');
  console.log('⚠️  Using frozen parameters from train set');
  console.log(`   K=${bestK}, HFA=${bestHFA}, Edge=[2.5, 5.0]\n`);

  // Run on holdout with frozen params
  const holdoutResults = runBacktest(testGames, bestK, bestHFA, 2.5, 5.0);

  console.log('HOLDOUT RESULTS (2024):');
  console.log('═'.repeat(60));
  summarizeResults(holdoutResults, '2024 Holdout');

  // Year-by-year breakdown
  console.log('\n=== STEP 6: Year-by-Year Stability ===\n');

  const train2023 = runBacktest(trainGames, bestK, bestHFA, 2.5, 5.0);
  const test2024 = holdoutResults;

  summarizeResults(train2023, '2023 (Train)');
  summarizeResults(test2024, '2024 (Test)');

  // Combined
  const allResults = [...train2023, ...test2024];
  console.log('\nCOMBINED (2023-2024):');
  summarizeResults(allResults, 'All Years');

  console.log('\n=== FINAL VERDICT ===\n');

  const holdoutROI = holdoutResults.length > 0
    ? holdoutResults.reduce((sum, r) => sum + r.profit, 0) / holdoutResults.length
    : -1;

  if (holdoutResults.length < 100) {
    console.log('❌ INSUFFICIENT DATA: Less than 100 bets in holdout');
    console.log('   Cannot draw conclusions with this sample size');
  } else if (holdoutROI > 0.05) {
    console.log('✅ PROMISING: Holdout ROI > +5%');
    console.log('   Consider further validation before production');
  } else if (holdoutROI > 0) {
    console.log('⚠️  MARGINAL: Holdout ROI positive but < +5%');
    console.log('   May not overcome real-world friction');
  } else {
    console.log('❌ NO EDGE: Holdout ROI negative');
    console.log('   CBB market appears efficient for this approach');
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
