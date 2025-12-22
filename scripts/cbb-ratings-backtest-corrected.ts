/**
 * CBB Ratings Model Backtest - CORRECTED
 *
 * Fixed: HFA should be SUBTRACTED, not added.
 * Model Spread = (Away Net Rating - Home Net Rating) / K - HFA
 *
 * When teams are equal, home should be FAVORED by HFA points.
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
  home_net_rating: number;
  away_net_rating: number;
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
  console.log('\n=== Building Dataset ===\n');

  const bettingLines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );
  console.log(`Found ${bettingLines.length} games with T-60 spreads`);

  const linesByGame = new Map<string, number>();
  for (const line of bettingLines) {
    linesByGame.set(line.game_id, line.spread_t60);
  }

  const gameData = await fetchAllRows<any>(
    'cbb_games',
    'id, season, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );
  console.log(`Found ${gameData.length} completed games`);

  const ratings = await fetchAllRows<any>('cbb_team_ratings', 'team_id, season, net_rating');
  const ratingsMap = new Map<string, Map<number, number>>();
  for (const r of ratings) {
    if (!ratingsMap.has(r.team_id)) {
      ratingsMap.set(r.team_id, new Map());
    }
    ratingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }
  console.log(`Loaded ${ratings.length} ratings`);

  const games: BacktestGame[] = [];

  for (const game of gameData) {
    if (game.season !== 2023 && game.season !== 2024) continue;
    if (!game.away_team_id) continue;

    const line = linesByGame.get(game.id);
    if (line === undefined) continue;

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
      spread_t60: line,
      home_net_rating: homeRating,
      away_net_rating: awayRating,
    });
  }

  console.log(`Final dataset: ${games.length} games`);
  return games;
}

// CORRECTED: HFA is SUBTRACTED (home advantage makes spread negative)
function calculateModelSpread(homeNet: number, awayNet: number, K: number, HFA: number): number {
  return (awayNet - homeNet) / K - HFA;  // MINUS HFA, not plus!
}

interface BetResult {
  won: boolean;
  profit: number;
  betSide: 'home' | 'away';
  edge: number;
}

function runBacktest(games: BacktestGame[], K: number, HFA: number, minEdge: number, maxEdge: number): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating, K, HFA);
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

    if (actualMargin === -game.spread_t60) continue;

    results.push({
      won,
      profit: won ? 0.91 : -1.0,
      betSide,
      edge: absEdge,
    });
  }

  return results;
}

function summarize(results: BetResult[], label: string): void {
  if (results.length === 0) {
    console.log(`${label}: No bets`);
    return;
  }

  const wins = results.filter(r => r.won).length;
  const winRate = wins / results.length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const roi = totalProfit / results.length;

  const homeBets = results.filter(r => r.betSide === 'home');
  const awayBets = results.filter(r => r.betSide === 'away');
  const homeWins = homeBets.filter(r => r.won).length;
  const awayWins = awayBets.filter(r => r.won).length;

  console.log(`${label}: ${results.length} bets | ${wins}-${results.length - wins} | ${(winRate * 100).toFixed(1)}% | ROI: ${(roi * 100).toFixed(1)}%`);
  console.log(`  Home: ${homeBets.length} bets (${(homeBets.length/results.length*100).toFixed(0)}%), ${homeWins}-${homeBets.length-homeWins} (${homeBets.length > 0 ? (homeWins/homeBets.length*100).toFixed(1) : 0}%)`);
  console.log(`  Away: ${awayBets.length} bets (${(awayBets.length/results.length*100).toFixed(0)}%), ${awayWins}-${awayBets.length-awayWins} (${awayBets.length > 0 ? (awayWins/awayBets.length*100).toFixed(1) : 0}%)`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     CBB RATINGS BACKTEST - CORRECTED HFA                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  console.log('\nFIX: Model Spread = (awayNet - homeNet) / K - HFA');
  console.log('     (HFA is SUBTRACTED to favor home team)\n');

  const allGames = await buildDataset();
  if (allGames.length === 0) return;

  const trainGames = allGames.filter(g => g.season === 2023);
  const testGames = allGames.filter(g => g.season === 2024);

  console.log(`\nTrain: ${trainGames.length} games (2023)`);
  console.log(`Test: ${testGames.length} games (2024)\n`);

  // Grid search for best K and HFA
  console.log('=== GRID SEARCH (Train 2023) ===\n');

  const kValues = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const hfaValues = [2.5, 3.0, 3.5, 4.0, 4.5];

  let bestConfig = { K: 3.5, HFA: 3.5, roi: -1, bets: 0 };

  for (const K of kValues) {
    for (const HFA of hfaValues) {
      const results = runBacktest(trainGames, K, HFA, 0, 100);
      if (results.length < 100) continue;

      const roi = results.reduce((sum, r) => sum + r.profit, 0) / results.length;

      if (roi > bestConfig.roi) {
        bestConfig = { K, HFA, roi, bets: results.length };
      }
    }
  }

  console.log(`Best: K=${bestConfig.K}, HFA=${bestConfig.HFA}, ROI=${(bestConfig.roi*100).toFixed(1)}%`);

  console.log('\n=== RESULTS WITH CORRECTED FORMULA ===\n');

  const ranges = [
    { min: 0, max: 100, label: 'All edges' },
    { min: 2.5, max: 5.0, label: '2.5-5 pts' },
    { min: 3.0, max: 6.0, label: '3-6 pts' },
    { min: 5.0, max: 10.0, label: '5-10 pts' },
  ];

  console.log('--- Train (2023) ---');
  for (const r of ranges) {
    const results = runBacktest(trainGames, bestConfig.K, bestConfig.HFA, r.min, r.max);
    summarize(results, r.label);
  }

  console.log('\n--- Holdout (2024) ---');
  for (const r of ranges) {
    const results = runBacktest(testGames, bestConfig.K, bestConfig.HFA, r.min, r.max);
    summarize(results, r.label);
  }

  console.log('\n--- Combined ---');
  for (const r of ranges) {
    const results = runBacktest(allGames, bestConfig.K, bestConfig.HFA, r.min, r.max);
    summarize(results, r.label);
  }

  // Verify bet distribution is now balanced
  console.log('\n=== BET DISTRIBUTION CHECK ===\n');
  const allResults = runBacktest(allGames, bestConfig.K, bestConfig.HFA, 0, 100);
  const homePct = allResults.filter(r => r.betSide === 'home').length / allResults.length;
  console.log(`Home bets: ${(homePct*100).toFixed(1)}%`);
  console.log(`Away bets: ${((1-homePct)*100).toFixed(1)}%`);
  console.log(`Balance: ${Math.abs(homePct - 0.5) < 0.15 ? '✓ Reasonable' : '⚠️ Still skewed'}`);

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
