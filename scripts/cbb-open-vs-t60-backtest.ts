/**
 * CBB Open vs T-60 Backtest
 *
 * Tests if betting at opening line provides edge vs T-60.
 * Hypothesis: Market may be less efficient at open before it corrects.
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
  spread_open: number;
  spread_t60: number;
  spread_close: number;
  home_net_rating: number;
  away_net_rating: number;
  line_move: number; // T-60 - Open (positive = line moved toward away)
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
  console.log('\n=== Building Open vs T-60 Dataset ===\n');

  // Get betting lines with BOTH open and T-60
  console.log('Fetching betting lines...');
  const bettingLines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, dk_spread_open, spread_t60, spread_close'
  );

  // Filter to games with both open AND t60
  const linesWithBoth = bettingLines.filter(l =>
    l.dk_spread_open !== null && l.spread_t60 !== null
  );
  console.log(`Found ${linesWithBoth.length} games with BOTH open and T-60 spreads`);

  const linesByGame = new Map<string, { open: number; t60: number; close: number }>();
  for (const line of linesWithBoth) {
    linesByGame.set(line.game_id, {
      open: line.dk_spread_open,
      t60: line.spread_t60,
      close: line.spread_close || line.spread_t60,
    });
  }

  // Get games with scores
  console.log('Fetching games...');
  const gameData = await fetchAllRows<any>(
    'cbb_games',
    'id, season, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );
  console.log(`Found ${gameData.length} completed games`);

  // Get ratings
  console.log('Fetching ratings...');
  const ratings = await fetchAllRows<any>('cbb_team_ratings', 'team_id, season, net_rating');
  const ratingsMap = new Map<string, Map<number, number>>();
  for (const r of ratings) {
    if (!ratingsMap.has(r.team_id)) {
      ratingsMap.set(r.team_id, new Map());
    }
    ratingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }
  console.log(`Loaded ${ratings.length} ratings`);

  // Build dataset
  const games: BacktestGame[] = [];
  let noLine = 0, noRating = 0;

  for (const game of gameData) {
    if (game.season !== 2023 && game.season !== 2024) continue;

    const line = linesByGame.get(game.id);
    if (!line) {
      noLine++;
      continue;
    }

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
      spread_open: line.open,
      spread_t60: line.t60,
      spread_close: line.close,
      home_net_rating: homeRating,
      away_net_rating: awayRating,
      line_move: line.t60 - line.open,
    });
  }

  console.log(`\nDataset built: ${games.length} games`);
  console.log(`  Skipped - no line: ${noLine}`);
  console.log(`  Skipped - no rating: ${noRating}`);

  return games;
}

function calculateModelSpread(homeNet: number, awayNet: number, K: number, HFA: number): number {
  return (awayNet - homeNet) / K + HFA;
}

interface BetResult {
  won: boolean;
  profit: number;
  edge: number;
  lineMove: number;
}

function runBacktest(
  games: BacktestGame[],
  K: number,
  HFA: number,
  minEdge: number,
  maxEdge: number,
  useOpen: boolean // true = bet at open, false = bet at T-60
): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating, K, HFA);

    // Calculate edge based on which line we're using
    const marketSpread = useOpen ? game.spread_open : game.spread_t60;
    const edge = marketSpread - modelSpread;
    const absEdge = Math.abs(edge);

    if (absEdge < minEdge || absEdge > maxEdge) continue;

    const betSide = edge > 0 ? 'home' : 'away';
    const actualMargin = game.home_score - game.away_score;

    // Bet is settled at the line we bet (open or T-60)
    let won: boolean;
    if (betSide === 'home') {
      won = actualMargin > -marketSpread;
    } else {
      won = actualMargin < -marketSpread;
    }

    // Handle push
    if (actualMargin === -marketSpread) continue;

    results.push({
      won,
      profit: won ? 0.91 : -1.0,
      edge: absEdge,
      lineMove: game.line_move,
    });
  }

  return results;
}

// CLV analysis: did we get a better number betting at open?
function analyzeClv(
  games: BacktestGame[],
  K: number,
  HFA: number,
  minEdge: number,
  maxEdge: number
): void {
  let betterAtOpen = 0;
  let worseAtOpen = 0;
  let same = 0;
  let totalClv = 0;
  let count = 0;

  for (const game of games) {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating, K, HFA);
    const edgeAtOpen = game.spread_open - modelSpread;
    const absEdge = Math.abs(edgeAtOpen);

    if (absEdge < minEdge || absEdge > maxEdge) continue;

    const betSide = edgeAtOpen > 0 ? 'home' : 'away';

    // CLV = closing line - bet line (positive = we got a better number)
    // If betting home, we want a higher spread at close
    // If betting away, we want a lower spread at close
    let clv: number;
    if (betSide === 'home') {
      clv = game.spread_close - game.spread_open;
    } else {
      clv = game.spread_open - game.spread_close;
    }

    totalClv += clv;
    count++;

    if (clv > 0.25) betterAtOpen++;
    else if (clv < -0.25) worseAtOpen++;
    else same++;
  }

  if (count > 0) {
    console.log(`\nCLV Analysis (betting at open, edge ${minEdge}-${maxEdge}):`);
    console.log(`  Bets: ${count}`);
    console.log(`  Got better number: ${betterAtOpen} (${(betterAtOpen/count*100).toFixed(1)}%)`);
    console.log(`  Got worse number: ${worseAtOpen} (${(worseAtOpen/count*100).toFixed(1)}%)`);
    console.log(`  Same (±0.25): ${same} (${(same/count*100).toFixed(1)}%)`);
    console.log(`  Average CLV: ${(totalClv/count).toFixed(2)} pts`);
  }
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
  console.log('║         CBB OPEN vs T-60 BACKTEST                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const allGames = await buildDataset();
  if (allGames.length === 0) {
    console.error('No games found!');
    return;
  }

  // Analyze line movement distribution
  console.log('\n=== Line Movement Distribution (Open → T-60) ===\n');
  const moves = allGames.map(g => g.line_move);
  const avgMove = moves.reduce((a, b) => a + b, 0) / moves.length;
  const movesUp = moves.filter(m => m > 0.5).length;
  const movesDown = moves.filter(m => m < -0.5).length;
  const stable = moves.filter(m => Math.abs(m) <= 0.5).length;

  console.log(`Average line move: ${avgMove.toFixed(2)} pts`);
  console.log(`Moved toward away (>0.5): ${movesUp} (${(movesUp/moves.length*100).toFixed(1)}%)`);
  console.log(`Moved toward home (<-0.5): ${movesDown} (${(movesDown/moves.length*100).toFixed(1)}%)`);
  console.log(`Stable (±0.5): ${stable} (${(stable/moves.length*100).toFixed(1)}%)`);

  const K = 3.5;
  const HFA = 3.0;

  console.log('\n=== COMPARISON: Bet at OPEN vs Bet at T-60 ===\n');

  const edgeRanges = [
    { min: 0, max: 100, label: 'All edges' },
    { min: 2.5, max: 5.0, label: '2.5-5 pts' },
    { min: 3.0, max: 6.0, label: '3-6 pts' },
    { min: 5.0, max: 10.0, label: '5-10 pts' },
  ];

  for (const range of edgeRanges) {
    console.log(`\n--- Edge Filter: ${range.label} ---`);

    const openResults = runBacktest(allGames, K, HFA, range.min, range.max, true);
    const t60Results = runBacktest(allGames, K, HFA, range.min, range.max, false);

    summarize(openResults, 'Bet at OPEN');
    summarize(t60Results, 'Bet at T-60');
  }

  // Test betting WITH line movement at open
  console.log('\n=== STRATEGY: Bet at Open + Line Movement Filter ===\n');

  // Strategy 1: Bet at open BEFORE line moves against us
  console.log('Hypothesis: Bet at open when line will move in our favor');

  // Games where line moved significantly
  const bigMoveGames = allGames.filter(g => Math.abs(g.line_move) >= 1.0);
  console.log(`\nGames with 1+ pt line move: ${bigMoveGames.length}`);

  // Test if we can predict line movement direction
  // If model says bet home and line moves up (toward away), we got a better number
  let correctMoveCount = 0;
  let wrongMoveCount = 0;

  for (const game of bigMoveGames) {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating, K, HFA);
    const edgeAtOpen = game.spread_open - modelSpread;
    const betSide = edgeAtOpen > 0 ? 'home' : 'away';

    // Did line move in our favor?
    if (betSide === 'home' && game.line_move > 0) correctMoveCount++;
    else if (betSide === 'away' && game.line_move < 0) correctMoveCount++;
    else wrongMoveCount++;
  }

  console.log(`Line moved in our favor: ${correctMoveCount} (${(correctMoveCount/bigMoveGames.length*100).toFixed(1)}%)`);
  console.log(`Line moved against us: ${wrongMoveCount} (${(wrongMoveCount/bigMoveGames.length*100).toFixed(1)}%)`);

  // CLV Analysis
  console.log('\n=== CLV ANALYSIS ===');
  analyzeClv(allGames, K, HFA, 0, 100);
  analyzeClv(allGames, K, HFA, 2.5, 5.0);
  analyzeClv(allGames, K, HFA, 5.0, 10.0);

  // Year-by-year
  console.log('\n=== YEAR-BY-YEAR (All Edges) ===\n');

  for (const season of [2023, 2024]) {
    const seasonGames = allGames.filter(g => g.season === season);
    console.log(`\n--- ${season} Season (${seasonGames.length} games) ---`);

    const openResults = runBacktest(seasonGames, K, HFA, 0, 100, true);
    const t60Results = runBacktest(seasonGames, K, HFA, 0, 100, false);

    summarize(openResults, 'Bet at OPEN');
    summarize(t60Results, 'Bet at T-60');
  }

  // Final test: bet at open only when edge is larger at open than at T-60
  console.log('\n=== STRATEGY: Bet Open When Edge Shrinks by T-60 ===\n');

  const shrinkingEdgeGames: BetResult[] = [];
  const growingEdgeGames: BetResult[] = [];

  for (const game of allGames) {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating, K, HFA);
    const edgeAtOpen = Math.abs(game.spread_open - modelSpread);
    const edgeAtT60 = Math.abs(game.spread_t60 - modelSpread);

    if (edgeAtOpen < 2.5) continue; // Need meaningful edge at open

    const betSide = (game.spread_open - modelSpread) > 0 ? 'home' : 'away';
    const actualMargin = game.home_score - game.away_score;

    let won: boolean;
    if (betSide === 'home') {
      won = actualMargin > -game.spread_open;
    } else {
      won = actualMargin < -game.spread_open;
    }

    if (actualMargin === -game.spread_open) continue; // push

    const result: BetResult = {
      won,
      profit: won ? 0.91 : -1.0,
      edge: edgeAtOpen,
      lineMove: game.line_move,
    };

    if (edgeAtOpen > edgeAtT60 + 0.5) {
      // Edge shrunk - market moved toward our position
      shrinkingEdgeGames.push(result);
    } else if (edgeAtT60 > edgeAtOpen + 0.5) {
      // Edge grew - market moved away from our position
      growingEdgeGames.push(result);
    }
  }

  summarize(shrinkingEdgeGames, 'Edge SHRUNK by T-60 (market agreed)');
  summarize(growingEdgeGames, 'Edge GREW by T-60 (market disagreed)');

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
