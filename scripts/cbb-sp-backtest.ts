/**
 * CBB SP+ Model Backtest
 *
 * V1: Prior-season ratings only (stale baseline)
 * - 2022 games use 2021 ratings
 * - 2023 games use 2022 ratings
 * - 2024 games use 2023 ratings
 *
 * Train: 2022-2023
 * Test: 2024
 * Fixed edge threshold (no tuning on test set)
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

interface GameWithRatings {
  id: string;
  cbbd_game_id: number;
  season: number;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  execution_spread: number; // DK T-60 spread (home perspective)
  home_off: number;
  home_def: number;
  home_net: number;
  away_off: number;
  away_def: number;
  away_net: number;
}

interface BacktestResult {
  season: number | 'all';
  threshold: number;
  totalGames: number;
  betsPlaced: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalPL: number;
  roi: number;
  avgEdge: number;
}

// Load ratings into memory for fast lookup
async function loadRatings(): Promise<Map<string, Map<string, { off: number; def: number; net: number }>>> {
  const { data, error } = await supabase
    .from('cbb_ratings_season_end')
    .select('season, team_name, off_rating, def_rating, net_rating');

  if (error || !data) {
    console.error('Error loading ratings:', error?.message);
    return new Map();
  }

  // Map: season -> team_name -> ratings
  const ratings = new Map<string, Map<string, { off: number; def: number; net: number }>>();

  for (const r of data) {
    const seasonKey = r.season.toString();
    if (!ratings.has(seasonKey)) {
      ratings.set(seasonKey, new Map());
    }
    ratings.get(seasonKey)!.set(r.team_name.toLowerCase(), {
      off: r.off_rating,
      def: r.def_rating,
      net: r.net_rating,
    });
  }

  return ratings;
}

// Normalize team name for matching
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/state/g, 'st.')
    .replace(/saint/g, 'st.')
    .replace(/&/g, 'and')
    .replace(/['']/g, "'")
    .trim();
}

// Try to find rating with fuzzy matching
function findRating(
  teamName: string,
  season: number,
  ratings: Map<string, Map<string, { off: number; def: number; net: number }>>
): { off: number; def: number; net: number } | null {
  const priorSeason = (season - 1).toString();
  const seasonRatings = ratings.get(priorSeason);

  if (!seasonRatings) return null;

  const normalized = normalizeTeamName(teamName);

  // Direct match
  if (seasonRatings.has(normalized)) {
    return seasonRatings.get(normalized)!;
  }

  // Try original lowercase
  if (seasonRatings.has(teamName.toLowerCase())) {
    return seasonRatings.get(teamName.toLowerCase())!;
  }

  // Try partial match
  for (const [key, value] of seasonRatings) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return value;
    }
  }

  return null;
}

async function fetchGamesWithRatings(
  ratings: Map<string, Map<string, { off: number; def: number; net: number }>>
): Promise<GameWithRatings[]> {
  console.log('Fetching games with execution spreads...');

  const allGames: GameWithRatings[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  let unmatchedTeams = new Set<string>();

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
      console.error('Error:', error.message);
      break;
    }

    if (data && data.length > 0) {
      for (const row of data) {
        const g = row.cbb_games as any;
        if (g.home_score === null || g.away_score === null) continue;

        const executionSpread = row.execution_timing === 't60' ? row.spread_t60 : row.spread_t30;
        if (executionSpread === null) continue;

        const homeRating = findRating(g.home_team_name, g.season, ratings);
        const awayRating = findRating(g.away_team_name, g.season, ratings);

        if (!homeRating) unmatchedTeams.add(`${g.season}: ${g.home_team_name}`);
        if (!awayRating) unmatchedTeams.add(`${g.season}: ${g.away_team_name}`);

        if (!homeRating || !awayRating) continue;

        allGames.push({
          id: row.id,
          cbbd_game_id: row.cbbd_game_id,
          season: g.season,
          home_team_name: g.home_team_name,
          away_team_name: g.away_team_name,
          home_score: g.home_score,
          away_score: g.away_score,
          execution_spread: executionSpread,
          home_off: homeRating.off,
          home_def: homeRating.def,
          home_net: homeRating.net,
          away_off: awayRating.off,
          away_def: awayRating.def,
          away_net: awayRating.net,
        });
      }
      offset += data.length;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  if (unmatchedTeams.size > 0 && unmatchedTeams.size <= 30) {
    console.log(`\nUnmatched teams (${unmatchedTeams.size}):`);
    for (const t of [...unmatchedTeams].slice(0, 20)) {
      console.log(`  - ${t}`);
    }
  }

  return allGames;
}

/**
 * SP+ Model Projection
 *
 * Model spread = (home_net - away_net) adjusted for home court
 * Higher net rating = better team = should be favored
 *
 * Home court advantage in CBB: ~3-4 points
 */
function computeModelSpread(game: GameWithRatings): number {
  const HOME_COURT_ADV = 3.5; // Standard CBB home court advantage
  const netDiff = game.home_net - game.away_net;

  // Model projects home margin = net diff + home court
  // Spread is inverse of margin (negative = favorite)
  // If home is better by 10 net + 3.5 HCA, they should be -13.5
  const projectedMargin = netDiff + HOME_COURT_ADV;
  const modelSpread = -projectedMargin; // Convert to spread format

  return modelSpread;
}

function runBacktest(
  games: GameWithRatings[],
  edgeThreshold: number
): BacktestResult {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let totalPL = 0;
  let betsPlaced = 0;
  let totalEdge = 0;

  for (const game of games) {
    const modelSpread = computeModelSpread(game);
    const marketSpread = game.execution_spread;

    // Edge = model spread - market spread
    // Positive edge on home = market has home as bigger underdog than model
    // Negative edge on home = market has home as bigger favorite than model
    const edge = modelSpread - marketSpread;

    // Only bet if edge exceeds threshold
    if (Math.abs(edge) < edgeThreshold) continue;

    // Determine bet side
    // If edge > 0: model thinks home should be MORE favored, bet home
    // If edge < 0: model thinks away should be MORE favored, bet away
    const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';

    const outcome = determineSpreadOutcome(
      marketSpread,
      game.home_score,
      game.away_score,
      betSide
    );

    betsPlaced++;
    totalEdge += Math.abs(edge);

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
  const avgEdge = betsPlaced > 0 ? totalEdge / betsPlaced : 0;

  return {
    season: 'all',
    threshold: edgeThreshold,
    totalGames: games.length,
    betsPlaced,
    wins,
    losses,
    pushes,
    winRate,
    totalPL,
    roi,
    avgEdge,
  };
}

async function run() {
  console.log('========================================');
  console.log('  CBB SP+ Model Backtest');
  console.log('  V1: Prior-Season Ratings Only');
  console.log('========================================\n');

  console.log('Loading ratings...');
  const ratings = await loadRatings();
  console.log(`Loaded ratings for seasons: ${[...ratings.keys()].join(', ')}\n`);

  const games = await fetchGamesWithRatings(ratings);
  console.log(`\nTotal games with ratings: ${games.length}`);

  const trainGames = games.filter(g => g.season === 2022 || g.season === 2023);
  const testGames = games.filter(g => g.season === 2024);

  console.log(`Train (2022-2023): ${trainGames.length} games`);
  console.log(`Test (2024): ${testGames.length} games\n`);

  // Fixed edge thresholds to evaluate
  const thresholds = [0, 1, 2, 3, 4, 5];

  console.log('========================================');
  console.log('  TRAIN SET (2022-2023)');
  console.log('========================================\n');

  console.log('Threshold | Bets   | Record        | Win%  | P/L      | ROI     | Avg Edge');
  console.log('-'.repeat(80));

  for (const threshold of thresholds) {
    const result = runBacktest(trainGames, threshold);
    console.log(
      `${threshold.toString().padStart(9)} | ` +
      `${result.betsPlaced.toString().padStart(6)} | ` +
      `${result.wins}-${result.losses}-${result.pushes}`.padEnd(13) + ' | ' +
      `${(result.winRate * 100).toFixed(1)}%`.padStart(5) + ' | ' +
      `${result.totalPL >= 0 ? '+' : ''}${result.totalPL.toFixed(1)}`.padStart(8) + ' | ' +
      `${(result.roi * 100).toFixed(2)}%`.padStart(7) + ' | ' +
      `${result.avgEdge.toFixed(2)}`
    );
  }

  console.log('\n========================================');
  console.log('  TEST SET (2024) - HOLDOUT');
  console.log('========================================\n');

  console.log('Threshold | Bets   | Record        | Win%  | P/L      | ROI     | Avg Edge');
  console.log('-'.repeat(80));

  for (const threshold of thresholds) {
    const result = runBacktest(testGames, threshold);
    console.log(
      `${threshold.toString().padStart(9)} | ` +
      `${result.betsPlaced.toString().padStart(6)} | ` +
      `${result.wins}-${result.losses}-${result.pushes}`.padEnd(13) + ' | ' +
      `${(result.winRate * 100).toFixed(1)}%`.padStart(5) + ' | ' +
      `${result.totalPL >= 0 ? '+' : ''}${result.totalPL.toFixed(1)}`.padStart(8) + ' | ' +
      `${(result.roi * 100).toFixed(2)}%`.padStart(7) + ' | ' +
      `${result.avgEdge.toFixed(2)}`
    );
  }

  // Detailed breakdown for threshold=2 (reasonable default)
  const selectedThreshold = 2;
  console.log(`\n========================================`);
  console.log(`  Detailed Analysis (Threshold = ${selectedThreshold})`);
  console.log(`========================================\n`);

  for (const [label, subset] of [['TRAIN', trainGames], ['TEST', testGames]] as const) {
    const result = runBacktest(subset, selectedThreshold);
    console.log(`${label}:`);
    console.log(`  Games in dataset: ${result.totalGames}`);
    console.log(`  Bets placed: ${result.betsPlaced} (${(result.betsPlaced / result.totalGames * 100).toFixed(1)}% of games)`);
    console.log(`  Record: ${result.wins}-${result.losses}-${result.pushes}`);
    console.log(`  Win Rate: ${(result.winRate * 100).toFixed(2)}%`);
    console.log(`  ROI: ${(result.roi * 100).toFixed(2)}%`);
    console.log(`  Break-even win rate at -110: 52.38%`);
    console.log('');
  }

  console.log('========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log('Model: SP+ net rating diff + 3.5 HCA');
  console.log('Features: Prior-season ratings only (stale baseline)');
  console.log('No tuning performed on test set.');
}

run().catch(console.error);
