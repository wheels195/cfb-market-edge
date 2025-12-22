/**
 * CFB Open vs Close Execution Backtest
 *
 * Uses cfbd_betting_lines data (2021-2022) to compare:
 * - Betting at OPEN line
 * - Betting at CLOSE line
 *
 * This tests whether timing matters for execution.
 * If Open ROI ≈ Close ROI, the edge is robust to timing.
 * If Open ROI << Close ROI, the edge may depend on late information.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface GameData {
  cfbd_game_id: number;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  spread_open: number;   // Open spread (home perspective)
  spread_close: number;  // Close spread (home perspective)
}

interface ModelProjection {
  model_spread_home: number;
}

/**
 * Simple ensemble model approximation
 * Since we don't have Elo/SP+/PPA for 2021-2022, we use a simple heuristic:
 * - Assume model = 0 (neutral) to test raw market efficiency
 * - Or we can use a simple home field advantage model
 *
 * For this analysis, we'll test if edge at OPEN differs from edge at CLOSE
 * by comparing which games would be selected and their outcomes
 */

interface BacktestResult {
  label: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  profit: number;
  roi: number;
}

/**
 * Fetch games with open and close spreads
 */
async function fetchGames(): Promise<GameData[]> {
  const { data, error } = await supabase
    .from('cfbd_betting_lines')
    .select('*')
    .not('spread_open', 'is', null)
    .not('spread_close', 'is', null)
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('cfbd_game_id', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return [];
  }

  return (data || []).map(row => ({
    cfbd_game_id: row.cfbd_game_id,
    season: row.season,
    week: row.week,
    home_team: row.home_team,
    away_team: row.away_team,
    home_score: row.home_score,
    away_score: row.away_score,
    spread_open: row.spread_open,
    spread_close: row.spread_close,
  }));
}

/**
 * Evaluate a spread bet
 * @param marketSpread - The spread to bet at (negative = home favored)
 * @param modelSpread - Model's projected spread
 * @param actualMargin - Home team's actual margin (positive = home won)
 * @param edgeThreshold - Minimum edge to bet
 */
function evaluateBet(
  marketSpread: number,
  modelSpread: number,
  actualMargin: number,
  edgeThreshold: number
): { won: boolean; profit: number } | null {
  const edge = marketSpread - modelSpread;

  // Skip if edge below threshold
  if (Math.abs(edge) < edgeThreshold) return null;

  // Determine bet side: positive edge = bet home
  const betHome = edge > 0;

  // Evaluate outcome
  let won: boolean;
  let push = false;

  if (betHome) {
    // Bet home at marketSpread
    const adjustedMargin = actualMargin + marketSpread;
    if (adjustedMargin === 0) push = true;
    else won = adjustedMargin > 0;
  } else {
    // Bet away at -marketSpread
    const adjustedMargin = -actualMargin - marketSpread;
    if (adjustedMargin === 0) push = true;
    else won = adjustedMargin > 0;
  }

  if (push) {
    return { won: false, profit: 0 };
  }

  return {
    won: won!,
    profit: won! ? 100 / 1.1 : -100,
  };
}

/**
 * Run backtest with specific execution timing
 */
function runBacktest(
  games: GameData[],
  executionLine: 'open' | 'close',
  modelSpread: number,  // Fixed model spread (e.g., 0 for neutral, or HFA)
  edgeThreshold: number,
  seasonFilter?: number
): BacktestResult {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let profit = 0;

  for (const game of games) {
    if (seasonFilter && game.season !== seasonFilter) continue;

    const marketSpread = executionLine === 'open' ? game.spread_open : game.spread_close;
    const actualMargin = game.home_score - game.away_score;

    const result = evaluateBet(marketSpread, modelSpread, actualMargin, edgeThreshold);
    if (!result) continue;

    if (result.profit === 0) {
      pushes++;
    } else if (result.won) {
      wins++;
      profit += result.profit;
    } else {
      losses++;
      profit += result.profit;
    }
  }

  const bets = wins + losses + pushes;
  const decisioned = wins + losses;

  return {
    label: executionLine.toUpperCase(),
    bets,
    wins,
    losses,
    pushes,
    winRate: decisioned > 0 ? wins / decisioned : 0,
    profit,
    roi: bets > 0 ? profit / (bets * 100) * 100 : 0,
  };
}

/**
 * Compare open vs close at same edge thresholds
 */
function compareOpenVsClose(
  games: GameData[],
  modelSpread: number,
  thresholds: number[]
) {
  console.log(`\n| Threshold | Open Bets | Open Win% | Open ROI | Close Bets | Close Win% | Close ROI | Diff |`);
  console.log(`|-----------|-----------|-----------|----------|------------|------------|-----------|------|`);

  for (const threshold of thresholds) {
    const openResult = runBacktest(games, 'open', modelSpread, threshold);
    const closeResult = runBacktest(games, 'close', modelSpread, threshold);

    const roiDiff = closeResult.roi - openResult.roi;

    console.log(
      `| ${threshold.toFixed(1).padStart(4)} pts ` +
      `| ${String(openResult.bets).padStart(4)} ` +
      `| ${(openResult.winRate * 100).toFixed(1).padStart(5)}% ` +
      `| ${openResult.roi >= 0 ? '+' : ''}${openResult.roi.toFixed(1).padStart(5)}% ` +
      `| ${String(closeResult.bets).padStart(4)} ` +
      `| ${(closeResult.winRate * 100).toFixed(1).padStart(5)}% ` +
      `| ${closeResult.roi >= 0 ? '+' : ''}${closeResult.roi.toFixed(1).padStart(5)}% ` +
      `| ${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(1)}% |`
    );
  }
}

async function main() {
  console.log('========================================');
  console.log('  CFB Open vs Close Execution Backtest');
  console.log('========================================\n');

  const games = await fetchGames();
  console.log(`Total games with open + close: ${games.length}\n`);

  if (games.length === 0) {
    console.log('No games found!');
    return;
  }

  // Line movement analysis
  const moves = games.map(g => g.spread_close - g.spread_open);
  const avgMove = moves.reduce((a, b) => a + b, 0) / moves.length;
  const absAvg = moves.map(m => Math.abs(m)).reduce((a, b) => a + b, 0) / moves.length;

  console.log('=== Line Movement (Close - Open) ===');
  console.log(`Avg move: ${avgMove.toFixed(2)} pts`);
  console.log(`Avg absolute move: ${absAvg.toFixed(2)} pts`);

  // Test 1: Market efficiency with neutral model (model_spread = 0)
  console.log('\n\n=== Test 1: Neutral Model (model = 0) ===');
  console.log('Tests raw market efficiency at different thresholds');

  compareOpenVsClose(games, 0, [0, 1, 2, 3, 5]);

  // Test 2: Home field advantage model (model_spread = -2.5)
  console.log('\n\n=== Test 2: HFA Model (model = -2.5 home favor) ===');
  console.log('Assumes home team should be favored by 2.5 pts');

  compareOpenVsClose(games, -2.5, [0, 1, 2, 3, 5]);

  // Test 3: Contrarian - bet against the move
  console.log('\n\n=== Test 3: Line Movement Contrarian ===');
  console.log('If move > threshold, bet AGAINST the move');

  const moveBuckets = [0.5, 1, 1.5, 2, 3];

  console.log(`\n| Move | Games | Fade Win% | Fade ROI |`);
  console.log(`|------|-------|-----------|----------|`);

  for (const minMove of moveBuckets) {
    let wins = 0;
    let losses = 0;
    let profit = 0;

    for (const game of games) {
      const move = game.spread_close - game.spread_open;
      if (Math.abs(move) < minMove) continue;

      const actualMargin = game.home_score - game.away_score;

      // Fade the move: if line moved toward home (positive), bet away
      const betHome = move < 0;
      const spreadAtClose = game.spread_close;

      let won: boolean;
      if (betHome) {
        won = actualMargin + spreadAtClose > 0;
      } else {
        won = -(actualMargin + spreadAtClose) > 0;
      }

      if (won) {
        wins++;
        profit += 100 / 1.1;
      } else {
        losses++;
        profit -= 100;
      }
    }

    const bets = wins + losses;
    const winRate = bets > 0 ? wins / bets : 0;
    const roi = bets > 0 ? profit / (bets * 100) * 100 : 0;

    console.log(
      `| ${minMove.toFixed(1).padStart(4)} ` +
      `| ${String(bets).padStart(4)} ` +
      `| ${(winRate * 100).toFixed(1).padStart(5)}% ` +
      `| ${roi >= 0 ? '+' : ''}${roi.toFixed(1).padStart(5)}% |`
    );
  }

  // Summary
  console.log('\n\n=== Summary ===');
  console.log('Compare Open ROI vs Close ROI to assess timing sensitivity.');
  console.log('If Close >> Open, edge may come from late information.');
  console.log('If Close ≈ Open, edge is robust to execution timing.');
}

main().catch(console.error);
