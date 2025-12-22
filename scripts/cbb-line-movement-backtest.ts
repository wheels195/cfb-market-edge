/**
 * CBB Line Movement Backtest
 *
 * Analyzes betting WITH vs AGAINST line movement from open → T-60
 *
 * Key definitions:
 * - line_move = spread_t60 - dk_spread_open (positive = line moved toward away team)
 * - If line_move > 0: money came in on home team (spread got more negative for home)
 * - If line_move < 0: money came in on away team (spread got less negative for home)
 *
 * WITH the move: bet the side money is coming in on
 * AGAINST the move: bet the side money is leaving (contrarian)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface GameData {
  betting_line_id: string;
  game_id: string;
  cbbd_game_id: number;
  dk_spread_open: number;
  spread_t60: number;
  home_score: number;
  away_score: number;
  season: number;
}

interface BetResult {
  game_id: string;
  lineMove: number;
  betSide: 'home' | 'away';
  spreadAtExecution: number;
  actualMargin: number;
  won: boolean;
  profit: number;
}

interface BacktestResults {
  strategy: string;
  moveBucket: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  profit: number;
  roi: number;
}

/**
 * Fetch games with both open and T-60 spreads, plus results
 */
async function fetchGamesWithLineMovement(): Promise<GameData[]> {
  const games: GameData[] = [];
  let offset = 0;
  const pageSize = 1000;

  console.log('Fetching games with line movement data...\n');

  while (true) {
    const { data, error } = await supabase
      .from('cbb_betting_lines')
      .select(`
        id,
        game_id,
        cbbd_game_id,
        dk_spread_open,
        spread_t60,
        cbb_games!inner(
          home_score,
          away_score,
          season
        )
      `)
      .not('dk_spread_open', 'is', null)
      .not('spread_t60', 'is', null)
      .order('cbbd_game_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error fetching games:', error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const g = row.cbb_games as any;
      // Skip games without scores
      if (g.home_score === null || g.away_score === null) continue;

      games.push({
        betting_line_id: row.id,
        game_id: row.game_id,
        cbbd_game_id: row.cbbd_game_id,
        dk_spread_open: row.dk_spread_open,
        spread_t60: row.spread_t60,
        home_score: g.home_score,
        away_score: g.away_score,
        season: g.season,
      });
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return games;
}

/**
 * Calculate line movement and determine bet outcomes
 */
function analyzeGame(
  game: GameData,
  strategy: 'with' | 'against',
  minMove: number,
  maxMove: number
): BetResult | null {
  // Line movement: positive = spread moved toward away (home became more favored)
  const lineMove = game.spread_t60 - game.dk_spread_open;

  // Skip if move is outside our filter range
  if (Math.abs(lineMove) < minMove || Math.abs(lineMove) > maxMove) {
    return null;
  }

  // Determine which side the money moved on
  // Positive lineMove = money on home (spread got more negative for home)
  // Negative lineMove = money on away (spread got less negative for home)
  const moneySide: 'home' | 'away' = lineMove > 0 ? 'home' : 'away';

  // Determine our bet based on strategy
  let betSide: 'home' | 'away';
  if (strategy === 'with') {
    betSide = moneySide; // Bet with the money
  } else {
    betSide = moneySide === 'home' ? 'away' : 'home'; // Bet against the money
  }

  // Execute at T-60 spread
  const spreadAtExecution = game.spread_t60;

  // Calculate actual margin (positive = home won by X)
  const actualMargin = game.home_score - game.away_score;

  // Determine if bet won
  // For home bet: home margin must exceed spread (which is negative for favorite)
  // Example: home -5.5, needs to win by 6+ → actualMargin + spread > 0
  let won: boolean;
  let push = false;

  if (betSide === 'home') {
    const result = actualMargin + spreadAtExecution;
    if (result === 0) {
      push = true;
      won = false;
    } else {
      won = result > 0;
    }
  } else {
    // Away bet: away covers if -(actualMargin + spread) > 0
    const result = -(actualMargin + spreadAtExecution);
    if (result === 0) {
      push = true;
      won = false;
    } else {
      won = result > 0;
    }
  }

  // Calculate profit (-110 juice)
  let profit: number;
  if (push) {
    profit = 0;
  } else if (won) {
    profit = 100 / 1.1; // Win $90.91 on $100 bet
  } else {
    profit = -100; // Lose $100
  }

  return {
    game_id: game.game_id,
    lineMove,
    betSide,
    spreadAtExecution,
    actualMargin,
    won: push ? false : won,
    profit,
  };
}

/**
 * Run backtest for a specific strategy and move range
 */
function runBacktest(
  games: GameData[],
  strategy: 'with' | 'against',
  minMove: number,
  maxMove: number,
  seasonFilter?: number
): BacktestResults {
  const results: BetResult[] = [];

  for (const game of games) {
    if (seasonFilter && game.season !== seasonFilter) continue;

    const result = analyzeGame(game, strategy, minMove, maxMove);
    if (result) {
      results.push(result);
    }
  }

  const wins = results.filter(r => r.profit > 0).length;
  const losses = results.filter(r => r.profit < 0).length;
  const pushes = results.filter(r => r.profit === 0).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const totalWagered = results.filter(r => r.profit !== 0).length * 100;

  return {
    strategy: strategy === 'with' ? 'WITH move' : 'AGAINST move',
    moveBucket: `${minMove}-${maxMove} pts`,
    bets: results.length,
    wins,
    losses,
    pushes,
    winRate: wins / (wins + losses) || 0,
    profit: totalProfit,
    roi: totalWagered > 0 ? (totalProfit / totalWagered) * 100 : 0,
  };
}

async function main() {
  console.log('========================================');
  console.log('  CBB Line Movement Backtest');
  console.log('========================================\n');

  const games = await fetchGamesWithLineMovement();
  console.log(`Total games with open + T-60 + results: ${games.length}\n`);

  // Distribution of line movements
  const moves = games.map(g => g.spread_t60 - g.dk_spread_open);
  const avgMove = moves.reduce((a, b) => a + b, 0) / moves.length;
  const absAvg = moves.map(m => Math.abs(m)).reduce((a, b) => a + b, 0) / moves.length;

  console.log('=== Line Movement Distribution ===');
  console.log(`Average move: ${avgMove.toFixed(2)} pts`);
  console.log(`Average absolute move: ${absAvg.toFixed(2)} pts`);

  // Count by bucket
  const buckets = [
    { min: 0, max: 0.5, label: '0-0.5' },
    { min: 0.5, max: 1, label: '0.5-1' },
    { min: 1, max: 1.5, label: '1-1.5' },
    { min: 1.5, max: 2, label: '1.5-2' },
    { min: 2, max: 3, label: '2-3' },
    { min: 3, max: 5, label: '3-5' },
    { min: 5, max: 10, label: '5+' },
  ];

  console.log('\nMove distribution:');
  for (const bucket of buckets) {
    const count = moves.filter(m => Math.abs(m) >= bucket.min && Math.abs(m) < bucket.max).length;
    console.log(`  ${bucket.label} pts: ${count} games (${(count / moves.length * 100).toFixed(1)}%)`);
  }

  // Run backtests by season
  console.log('\n\n=== Backtest Results by Season ===');

  const seasons = [2022, 2023, 2024];
  const moveBuckets = [
    { min: 0.5, max: 10, label: '0.5+' },
    { min: 1, max: 10, label: '1+' },
    { min: 1.5, max: 10, label: '1.5+' },
    { min: 2, max: 10, label: '2+' },
    { min: 3, max: 10, label: '3+' },
  ];

  // Header
  console.log('\n| Strategy | Move | Season | Bets | Win% | ROI |');
  console.log('|----------|------|--------|------|------|-----|');

  for (const season of seasons) {
    for (const bucket of moveBuckets) {
      const withResult = runBacktest(games, 'with', bucket.min, bucket.max, season);
      const againstResult = runBacktest(games, 'against', bucket.min, bucket.max, season);

      if (withResult.bets > 20) {
        console.log(
          `| ${withResult.strategy.padEnd(12)} | ${bucket.label.padEnd(5)} | ${season} | ${String(withResult.bets).padEnd(4)} | ${(withResult.winRate * 100).toFixed(1).padEnd(5)}% | ${withResult.roi >= 0 ? '+' : ''}${withResult.roi.toFixed(1)}% |`
        );
        console.log(
          `| ${againstResult.strategy.padEnd(12)} | ${bucket.label.padEnd(5)} | ${season} | ${String(againstResult.bets).padEnd(4)} | ${(againstResult.winRate * 100).toFixed(1).padEnd(5)}% | ${againstResult.roi >= 0 ? '+' : ''}${againstResult.roi.toFixed(1)}% |`
        );
      }
    }
    console.log('|----------|------|--------|------|------|-----|');
  }

  // Overall results
  console.log('\n\n=== Overall Results (All Seasons) ===');
  console.log('\n| Strategy | Move | Bets | Win% | Profit | ROI |');
  console.log('|----------|------|------|------|--------|-----|');

  for (const bucket of moveBuckets) {
    const withResult = runBacktest(games, 'with', bucket.min, bucket.max);
    const againstResult = runBacktest(games, 'against', bucket.min, bucket.max);

    console.log(
      `| ${withResult.strategy.padEnd(12)} | ${bucket.label.padEnd(5)} | ${String(withResult.bets).padEnd(4)} | ${(withResult.winRate * 100).toFixed(1).padEnd(5)}% | $${withResult.profit.toFixed(0).padStart(6)} | ${withResult.roi >= 0 ? '+' : ''}${withResult.roi.toFixed(1)}% |`
    );
    console.log(
      `| ${againstResult.strategy.padEnd(12)} | ${bucket.label.padEnd(5)} | ${String(againstResult.bets).padEnd(4)} | ${(againstResult.winRate * 100).toFixed(1).padEnd(5)}% | $${againstResult.profit.toFixed(0).padStart(6)} | ${againstResult.roi >= 0 ? '+' : ''}${againstResult.roi.toFixed(1)}% |`
    );
  }

  // Summary
  console.log('\n\n=== Key Findings ===');
  const bestWith = moveBuckets
    .map(b => runBacktest(games, 'with', b.min, b.max))
    .sort((a, b) => b.roi - a.roi)[0];
  const bestAgainst = moveBuckets
    .map(b => runBacktest(games, 'against', b.min, b.max))
    .sort((a, b) => b.roi - a.roi)[0];

  console.log(`\nBest WITH move: ${bestWith.moveBucket} → ${bestWith.winRate * 100}% win, ${bestWith.roi >= 0 ? '+' : ''}${bestWith.roi.toFixed(1)}% ROI (${bestWith.bets} bets)`);
  console.log(`Best AGAINST move: ${bestAgainst.moveBucket} → ${bestAgainst.winRate * 100}% win, ${bestAgainst.roi >= 0 ? '+' : ''}${bestAgainst.roi.toFixed(1)}% ROI (${bestAgainst.bets} bets)`);
}

main().catch(console.error);
