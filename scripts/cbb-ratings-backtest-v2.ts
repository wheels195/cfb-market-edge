/**
 * CBB Ratings Model Backtest v2
 *
 * Fixed: Paginate queries to get all data
 * Uses prior season ratings to avoid point-in-time leakage.
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
  actual_margin: number;
  won: boolean;
  profit: number;
}

// Paginate to get all rows
async function fetchAllRows<T>(
  table: string,
  select: string,
  filters?: { column: string; op: string; value: any }[]
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);

    if (filters) {
      for (const f of filters) {
        if (f.op === 'not.is') {
          query = query.not(f.column, 'is', f.value);
        } else if (f.op === 'in') {
          query = query.in(f.column, f.value);
        } else if (f.op === 'eq') {
          query = query.eq(f.column, f.value);
        }
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = allData.concat(data as T[]);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }

  return allData;
}

async function buildDataset(): Promise<BacktestGame[]> {
  console.log('\n=== STEP 1: Building Dataset ===\n');

  // Get ALL betting lines with T-60 spreads
  console.log('Fetching betting lines (paginated)...');
  const bettingLines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60, spread_close',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );
  console.log(`Found ${bettingLines.length} games with T-60 spreads`);

  // Create lookup map
  const linesByGame = new Map<string, { spread_t60: number; spread_close: number }>();
  for (const line of bettingLines) {
    linesByGame.set(line.game_id, {
      spread_t60: line.spread_t60,
      spread_close: line.spread_close
    });
  }

  // Get ALL games with scores for seasons we care about
  console.log('Fetching games (paginated)...');
  const gameData = await fetchAllRows<any>(
    'cbb_games',
    'id, season, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );
  console.log(`Found ${gameData.length} completed games total`);

  // Count by season
  const bySeason = new Map<number, number>();
  for (const g of gameData) {
    bySeason.set(g.season, (bySeason.get(g.season) || 0) + 1);
  }
  console.log('Games by season:', Object.fromEntries(bySeason));

  // Get ALL ratings
  console.log('Fetching ratings...');
  const ratings = await fetchAllRows<any>(
    'cbb_team_ratings',
    'team_id, season, net_rating'
  );
  console.log(`Found ${ratings.length} rating records`);

  // Count ratings by season
  const ratingsBySeason = new Map<number, number>();
  for (const r of ratings) {
    ratingsBySeason.set(r.season, (ratingsBySeason.get(r.season) || 0) + 1);
  }
  console.log('Ratings by season:', Object.fromEntries(ratingsBySeason));

  // Create ratings lookup: team_id -> season -> net_rating
  const ratingsMap = new Map<string, Map<number, number>>();
  for (const r of ratings) {
    if (!ratingsMap.has(r.team_id)) {
      ratingsMap.set(r.team_id, new Map());
    }
    ratingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }

  // Join everything
  const games: BacktestGame[] = [];
  let noLine = 0;
  let noRating = 0;

  for (const game of gameData) {
    // Only process 2023 and 2024 games
    if (game.season !== 2023 && game.season !== 2024) continue;

    const line = linesByGame.get(game.id);
    if (!line) {
      noLine++;
      continue;
    }

    // Use PRIOR season ratings (avoid leakage)
    const priorSeason = game.season - 1;
    const homeRating = ratingsMap.get(game.home_team_id)?.get(priorSeason);
    const awayRating = ratingsMap.get(game.away_team_id)?.get(priorSeason);

    if (homeRating === undefined || awayRating === undefined) {
      noRating++;
      continue;
    }

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

  console.log(`\nJoin Results:`);
  console.log(`  No betting line: ${noLine}`);
  console.log(`  No prior season rating: ${noRating}`);
  console.log(`  Final dataset: ${games.length} games`);
  console.log(`  2023: ${games.filter(g => g.season === 2023).length} games`);
  console.log(`  2024: ${games.filter(g => g.season === 2024).length} games`);

  return games;
}

function calculateModelSpread(
  homeNetRating: number,
  awayNetRating: number,
  K: number,
  HFA: number
): number {
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

    const edge = game.spread_t60 - modelSpread;
    const absEdge = Math.abs(edge);

    if (absEdge < minEdge || absEdge > maxEdge) continue;

    const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
    const actualMargin = game.home_score - game.away_score;

    let won: boolean;
    if (betSide === 'home') {
      won = actualMargin > -game.spread_t60;
    } else {
      won = actualMargin < -game.spread_t60;
    }

    // Handle push
    if (actualMargin === -game.spread_t60) continue;

    const profit = won ? 0.91 : -1.0;

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

function summarize(results: BetResult[], label: string): { bets: number; winRate: number; roi: number } {
  if (results.length === 0) {
    console.log(`${label}: No bets`);
    return { bets: 0, winRate: 0, roi: -1 };
  }

  const wins = results.filter(r => r.won).length;
  const winRate = wins / results.length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const roi = totalProfit / results.length;

  console.log(`${label}: ${results.length} bets | ${wins}-${results.length - wins} | ${(winRate * 100).toFixed(1)}% | ROI: ${(roi * 100).toFixed(1)}%`);

  return { bets: results.length, winRate, roi };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          CBB RATINGS MODEL BACKTEST v2                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const allGames = await buildDataset();
  if (allGames.length === 0) {
    console.error('No games found!');
    return;
  }

  const trainGames = allGames.filter(g => g.season === 2023);
  const testGames = allGames.filter(g => g.season === 2024);

  console.log('\n=== STEP 2: Baseline ===\n');
  const baselineAll = runBacktest(allGames, 3, 3.5, 0, 100);
  summarize(baselineAll, 'Baseline (all games)');

  console.log('\n=== STEP 3: Grid Search (2023 Train) ===\n');

  const kValues = [2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
  const hfaValues = [2.5, 3.0, 3.5, 4.0];
  const edgeFilters = [
    { min: 0, max: 100, label: 'All' },
    { min: 2.0, max: 5.0, label: '2-5' },
    { min: 2.5, max: 5.0, label: '2.5-5' },
    { min: 3.0, max: 6.0, label: '3-6' },
    { min: 3.0, max: 7.0, label: '3-7' },
  ];

  let bestConfig = { K: 3, HFA: 3.5, min: 0, max: 100, roi: -1, bets: 0 };

  for (const K of kValues) {
    for (const HFA of hfaValues) {
      for (const edge of edgeFilters) {
        const results = runBacktest(trainGames, K, HFA, edge.min, edge.max);
        if (results.length < 30) continue;

        const roi = results.reduce((sum, r) => sum + r.profit, 0) / results.length;

        if (roi > bestConfig.roi && results.length >= 50) {
          bestConfig = { K, HFA, min: edge.min, max: edge.max, roi, bets: results.length };
        }
      }
    }
  }

  console.log(`Best Config: K=${bestConfig.K}, HFA=${bestConfig.HFA}, Edge=[${bestConfig.min}, ${bestConfig.max}]`);
  console.log(`Train ROI: ${(bestConfig.roi * 100).toFixed(1)}% on ${bestConfig.bets} bets\n`);

  console.log('=== STEP 4: Edge Analysis (Best K/HFA) ===\n');

  const ranges = [
    { min: 0, max: 2, label: '0-2 pts' },
    { min: 2, max: 3, label: '2-3 pts' },
    { min: 3, max: 4, label: '3-4 pts' },
    { min: 4, max: 5, label: '4-5 pts' },
    { min: 5, max: 7, label: '5-7 pts' },
    { min: 7, max: 10, label: '7-10 pts' },
    { min: 10, max: 100, label: '10+ pts' },
  ];

  console.log('Train Set (2023):');
  for (const r of ranges) {
    const results = runBacktest(trainGames, bestConfig.K, bestConfig.HFA, r.min, r.max);
    summarize(results, `  ${r.label}`);
  }

  console.log('\n=== STEP 5: HOLDOUT (2024) ===\n');

  if (testGames.length === 0) {
    console.log('❌ No 2024 test games available');
    console.log('   This is because we need 2023 ratings for 2024 games');
    console.log('   Checking if we have 2023 ratings...');

    // Check what's happening
    const { count } = await supabase
      .from('cbb_team_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('season', 2023);
    console.log(`   2023 ratings in DB: ${count}`);
  } else {
    console.log(`Testing on ${testGames.length} holdout games...`);

    for (const r of ranges) {
      const results = runBacktest(testGames, bestConfig.K, bestConfig.HFA, r.min, r.max);
      summarize(results, `  ${r.label}`);
    }

    // Final summary with best edge filter
    console.log('\n=== FINAL RESULTS ===\n');

    const trainFinal = runBacktest(trainGames, bestConfig.K, bestConfig.HFA, bestConfig.min, bestConfig.max);
    const testFinal = runBacktest(testGames, bestConfig.K, bestConfig.HFA, bestConfig.min, bestConfig.max);

    console.log('Frozen Config: K=' + bestConfig.K + ', HFA=' + bestConfig.HFA + ', Edge=[' + bestConfig.min + ', ' + bestConfig.max + ']');
    summarize(trainFinal, '2023 Train');
    summarize(testFinal, '2024 Holdout');

    const allFinal = [...trainFinal, ...testFinal];
    summarize(allFinal, 'Combined');
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
