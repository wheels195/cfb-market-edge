/**
 * CBB Baseline Backtest
 *
 * Validates expected loss rate when betting:
 * 1. All favorites
 * 2. All underdogs
 * 3. Random (coin flip)
 *
 * Expected: ~-4.5% ROI (vig drag)
 * If significantly different, data or logic issue.
 */

import { createClient } from '@supabase/supabase-js';
import {
  CBB_BETTING_FRAMEWORK,
  calculateSpreadPL,
  determineSpreadOutcome,
} from '../src/lib/cbb/betting-framework';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface BacktestGame {
  id: string;
  cbbd_game_id: number;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  spread_t60: number | null;
  spread_t30: number | null;
  execution_timing: string | null;
  season: number;
}

interface BacktestResult {
  strategy: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalPL: number;
  roi: number;
}

function getExecutionSpread(game: BacktestGame): number | null {
  if (game.execution_timing === 't60' && game.spread_t60 !== null) {
    return game.spread_t60;
  }
  if (game.execution_timing === 't30' && game.spread_t30 !== null) {
    return game.spread_t30;
  }
  return null;
}

async function fetchBacktestData(): Promise<BacktestGame[]> {
  console.log('Fetching backtest data...');

  const allGames: BacktestGame[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('cbb_betting_lines')
      .select(`
        id,
        cbbd_game_id,
        spread_t60,
        spread_t30,
        execution_timing,
        cbb_games!inner (
          home_team_name,
          away_team_name,
          home_score,
          away_score,
          season,
          status
        )
      `)
      .eq('provider', 'DraftKings')
      .not('execution_timing', 'is', null)
      .eq('cbb_games.status', 'final')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching data:', error.message);
      return [];
    }

    if (data && data.length > 0) {
      for (const row of data) {
        const g = row.cbb_games as any;
        if (g.home_score !== null && g.away_score !== null) {
          allGames.push({
            id: row.id,
            cbbd_game_id: row.cbbd_game_id,
            home_team_name: g.home_team_name,
            away_team_name: g.away_team_name,
            home_score: g.home_score,
            away_score: g.away_score,
            spread_t60: row.spread_t60,
            spread_t30: row.spread_t30,
            execution_timing: row.execution_timing,
            season: g.season,
          });
        }
      }
      offset += data.length;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allGames;
}

function runBacktest(
  games: BacktestGame[],
  strategy: 'favorites' | 'underdogs' | 'random' | 'home' | 'away'
): BacktestResult {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let totalPL = 0;
  let betsPlaced = 0;

  // Seed for reproducible random
  let randomSeed = 42;
  const pseudoRandom = () => {
    randomSeed = (randomSeed * 1103515245 + 12345) & 0x7fffffff;
    return randomSeed / 0x7fffffff;
  };

  for (const game of games) {
    const spread = getExecutionSpread(game);
    if (spread === null) continue;

    let betSide: 'home' | 'away';

    switch (strategy) {
      case 'favorites':
        // Negative spread = home favorite, positive = away favorite
        betSide = spread < 0 ? 'home' : 'away';
        break;
      case 'underdogs':
        // Positive spread = home underdog, negative = away underdog
        betSide = spread > 0 ? 'home' : 'away';
        break;
      case 'home':
        betSide = 'home';
        break;
      case 'away':
        betSide = 'away';
        break;
      case 'random':
        betSide = pseudoRandom() < 0.5 ? 'home' : 'away';
        break;
    }

    // Skip pick'ems for favorites/underdogs strategies
    if ((strategy === 'favorites' || strategy === 'underdogs') && spread === 0) {
      continue;
    }

    const outcome = determineSpreadOutcome(
      spread,
      game.home_score,
      game.away_score,
      betSide
    );

    betsPlaced++;

    if (outcome === null) {
      pushes++;
    } else if (outcome) {
      wins++;
      totalPL += calculateSpreadPL(true);
    } else {
      losses++;
      totalPL += calculateSpreadPL(false);
    }
  }

  const winRate = betsPlaced > 0 ? wins / (wins + losses) : 0;
  const roi = betsPlaced > 0 ? totalPL / betsPlaced : 0;

  return {
    strategy,
    totalBets: betsPlaced,
    wins,
    losses,
    pushes,
    winRate,
    totalPL,
    roi,
  };
}

function runBacktestBySeason(
  games: BacktestGame[],
  strategy: 'favorites' | 'underdogs' | 'random'
): Map<number, BacktestResult> {
  const seasons = [...new Set(games.map(g => g.season))].sort();
  const results = new Map<number, BacktestResult>();

  for (const season of seasons) {
    const seasonGames = games.filter(g => g.season === season);
    results.set(season, runBacktest(seasonGames, strategy));
  }

  return results;
}

async function run() {
  console.log('========================================');
  console.log('  CBB Baseline Backtest');
  console.log('  Validating expected vig loss rate');
  console.log('========================================\n');

  console.log('Framework:', CBB_BETTING_FRAMEWORK);
  console.log('');

  const games = await fetchBacktestData();
  console.log(`Total games with execution spreads: ${games.length}\n`);

  if (games.length === 0) {
    console.error('No games found!');
    return;
  }

  // Overall results
  console.log('========================================');
  console.log('  Overall Results (All Seasons)');
  console.log('========================================\n');

  const strategies: ('favorites' | 'underdogs' | 'random' | 'home' | 'away')[] = [
    'favorites',
    'underdogs',
    'random',
    'home',
    'away',
  ];

  for (const strategy of strategies) {
    const result = runBacktest(games, strategy);
    console.log(`Strategy: ${strategy.toUpperCase()}`);
    console.log(`  Bets: ${result.totalBets}`);
    console.log(`  Record: ${result.wins}-${result.losses}-${result.pushes}`);
    console.log(`  Win Rate: ${(result.winRate * 100).toFixed(2)}%`);
    console.log(`  P/L: ${result.totalPL.toFixed(2)} units`);
    console.log(`  ROI: ${(result.roi * 100).toFixed(2)}%`);
    console.log('');
  }

  // By season
  console.log('========================================');
  console.log('  Results by Season');
  console.log('========================================\n');

  for (const strategy of ['favorites', 'underdogs', 'random'] as const) {
    console.log(`--- ${strategy.toUpperCase()} ---`);
    const seasonResults = runBacktestBySeason(games, strategy);

    for (const [season, result] of seasonResults) {
      console.log(
        `  ${season - 1}-${String(season).slice(2)}: ` +
        `${result.wins}-${result.losses}-${result.pushes} | ` +
        `WR: ${(result.winRate * 100).toFixed(1)}% | ` +
        `ROI: ${(result.roi * 100).toFixed(2)}%`
      );
    }
    console.log('');
  }

  // Validation
  console.log('========================================');
  console.log('  Validation');
  console.log('========================================\n');

  const randomResult = runBacktest(games, 'random');
  const expectedLoss = CBB_BETTING_FRAMEWORK.expectedBaselineLoss;
  const actualLoss = randomResult.roi;
  const tolerance = 0.02; // 2% tolerance

  if (Math.abs(actualLoss - expectedLoss) < tolerance) {
    console.log(`PASS: Random ROI (${(actualLoss * 100).toFixed(2)}%) within expected range`);
    console.log(`      Expected: ${(expectedLoss * 100).toFixed(2)}% +/- 2%`);
  } else {
    console.log(`CHECK: Random ROI (${(actualLoss * 100).toFixed(2)}%) differs from expected`);
    console.log(`       Expected: ${(expectedLoss * 100).toFixed(2)}%`);
    console.log('       This may indicate data issues or natural variance');
  }

  // Win rate sanity check
  if (randomResult.winRate > 0.48 && randomResult.winRate < 0.52) {
    console.log(`PASS: Random win rate (${(randomResult.winRate * 100).toFixed(1)}%) near 50%`);
  } else {
    console.log(`CHECK: Random win rate (${(randomResult.winRate * 100).toFixed(1)}%) skewed`);
  }

  console.log('\n========================================');
  console.log('  Baseline Complete');
  console.log('========================================');
}

run().catch(console.error);
