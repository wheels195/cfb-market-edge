/**
 * Backtest the new conference-aware CBB model
 * Find what betting criteria actually work
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Model parameters from validation
const HOME_ADV = 7.4;
const LEARNING_RATE = 0.08;
const SEASON_DECAY = 0.7;

// Conference ratings
const CONF_RATING: Record<string, number> = {
  "Big 12": 12, "SEC": 11, "Big Ten": 9, "Big East": 7,
  "ACC": 5, "Mountain West": 5, "Atlantic 10": 4,
  "WCC": 3, "American Athletic": 3, "Missouri Valley": 2,
  "MAC": 1, "Sun Belt": 0, "Pac-12": 0,
  "Conference USA": -1, "WAC": -2, "Big West": -3,
  "Ohio Valley": -4, "Horizon League": -4, "Southern": -5,
  "CAA": -5, "Patriot League": -6, "Ivy League": -6,
  "Big South": -7, "Summit League": -8, "ASUN": -8,
  "Northeast": -10, "Southland": -11, "MEAC": -14, "SWAC": -16,
};

// Team ratings
const teamRatings: Map<string, { rating: number; games: number }> = new Map();

function getConfRating(conf: string | null): number {
  if (!conf) return 0;
  return CONF_RATING[conf] ?? 0;
}

function getTeamRating(teamId: string): number {
  return teamRatings.get(teamId)?.rating ?? 0;
}

function getGamesPlayed(teamId: string): number {
  return teamRatings.get(teamId)?.games ?? 0;
}

function predictSpread(
  homeTeamId: string,
  awayTeamId: string,
  homeConf: string | null,
  awayConf: string | null
): number {
  const homeRating = getTeamRating(homeTeamId) + getConfRating(homeConf);
  const awayRating = getTeamRating(awayTeamId) + getConfRating(awayConf);
  return awayRating - homeRating - HOME_ADV;
}

function updateRatings(
  homeTeamId: string,
  awayTeamId: string,
  homeConf: string | null,
  awayConf: string | null,
  homeScore: number,
  awayScore: number
): void {
  const predicted = predictSpread(homeTeamId, awayTeamId, homeConf, awayConf);
  const actual = awayScore - homeScore;
  const error = actual - predicted;

  const homeData = teamRatings.get(homeTeamId) || { rating: 0, games: 0 };
  homeData.rating -= error * LEARNING_RATE;
  homeData.games += 1;
  teamRatings.set(homeTeamId, homeData);

  const awayData = teamRatings.get(awayTeamId) || { rating: 0, games: 0 };
  awayData.rating += error * LEARNING_RATE;
  awayData.games += 1;
  teamRatings.set(awayTeamId, awayData);
}

function resetSeason(): void {
  for (const [teamId, data] of teamRatings) {
    data.rating *= SEASON_DECAY;
    data.games = 0;
  }
}

interface BetResult {
  season: number;
  gameId: string;
  modelSpread: number;
  marketSpread: number;
  edge: number;
  absEdge: number;
  betSide: 'home' | 'away';
  isUnderdog: boolean;
  isFavorite: boolean;
  spreadSize: number;
  homeGames: number;
  awayGames: number;
  actualMargin: number;
  covered: boolean;
  profit: number;
}

async function main() {
  console.log('=== CBB New Model Backtest ===\n');

  // Load teams with conferences
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name, conference');

  const teamConf = new Map<string, string>();
  for (const t of teams || []) {
    teamConf.set(t.id, t.conference);
  }

  // Load all games with betting lines (2022-2025)
  const { data: allGames } = await supabase
    .from('cbb_games')
    .select(`
      id, season, start_date,
      home_team_id, away_team_id,
      home_score, away_score,
      cbb_betting_lines (spread_home)
    `)
    .in('season', [2022, 2023, 2024, 2025])
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  console.log(`Loaded ${allGames?.length} completed games\n`);

  // Process games chronologically, track bet results
  const results: BetResult[] = [];
  let currentSeason = 0;

  for (const game of allGames || []) {
    // Handle season transitions
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) {
        resetSeason();
      }
      currentSeason = game.season;
    }

    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const marketSpread = line?.spread_home;

    // Get pre-game prediction (before updating ratings)
    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;
    const homeGames = getGamesPlayed(game.home_team_id);
    const awayGames = getGamesPlayed(game.away_team_id);

    // Only track if we have market line
    if (marketSpread !== null && marketSpread !== undefined) {
      const modelSpread = predictSpread(
        game.home_team_id,
        game.away_team_id,
        homeConf,
        awayConf
      );

      const edge = marketSpread - modelSpread;
      const absEdge = Math.abs(edge);
      const spreadSize = Math.abs(marketSpread);
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';

      const isUnderdog = (betSide === 'home' && marketSpread > 0) ||
                         (betSide === 'away' && marketSpread < 0);
      const isFavorite = !isUnderdog;

      // Calculate if bet covered
      const actualMargin = game.home_score - game.away_score;
      let covered: boolean;

      if (betSide === 'home') {
        // Home covers if: home_margin + spread > 0
        covered = actualMargin + marketSpread > 0;
      } else {
        // Away covers if: away_margin + (-spread) > 0 → -home_margin - spread > 0
        covered = -actualMargin - marketSpread > 0;
      }

      const profit = covered ? 0.91 : -1.0;

      results.push({
        season: game.season,
        gameId: game.id,
        modelSpread,
        marketSpread,
        edge,
        absEdge,
        betSide,
        isUnderdog,
        isFavorite,
        spreadSize,
        homeGames,
        awayGames,
        actualMargin,
        covered,
        profit,
      });
    }

    // Update ratings AFTER recording bet
    updateRatings(
      game.home_team_id,
      game.away_team_id,
      homeConf,
      awayConf,
      game.home_score,
      game.away_score
    );
  }

  console.log(`Games with betting lines: ${results.length}\n`);

  // Analysis functions
  function analyze(bets: BetResult[], label: string) {
    if (bets.length === 0) return;
    const wins = bets.filter(b => b.covered).length;
    const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
    const winRate = wins / bets.length;
    const roi = totalProfit / bets.length;
    console.log(`${label}: ${bets.length} bets, ${(winRate * 100).toFixed(1)}% win, ${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}% ROI`);
  }

  // ============================================
  // ANALYSIS BY EDGE SIZE
  // ============================================
  console.log('\n=== BY EDGE SIZE (all bets) ===\n');

  for (const minEdge of [0, 1, 2, 2.5, 3, 4, 5, 6, 7, 8]) {
    const maxEdge = minEdge + 1;
    const bets = results.filter(r => r.absEdge >= minEdge && r.absEdge < maxEdge);
    analyze(bets, `Edge ${minEdge}-${maxEdge}`);
  }

  const bigEdge = results.filter(r => r.absEdge >= 8);
  analyze(bigEdge, `Edge 8+`);

  // ============================================
  // UNDERDOG VS FAVORITE
  // ============================================
  console.log('\n=== UNDERDOG VS FAVORITE ===\n');

  for (const minEdge of [0, 2, 3, 4, 5]) {
    const underdogs = results.filter(r => r.absEdge >= minEdge && r.isUnderdog);
    const favorites = results.filter(r => r.absEdge >= minEdge && r.isFavorite);
    console.log(`Edge ${minEdge}+:`);
    analyze(underdogs, `  Underdogs`);
    analyze(favorites, `  Favorites`);
  }

  // ============================================
  // BY SPREAD SIZE
  // ============================================
  console.log('\n=== BY SPREAD SIZE (edge 3+) ===\n');

  const edge3plus = results.filter(r => r.absEdge >= 3);

  for (const [minSpread, maxSpread] of [[0, 5], [5, 10], [10, 15], [15, 20], [20, 100]]) {
    const bets = edge3plus.filter(r => r.spreadSize >= minSpread && r.spreadSize < maxSpread);
    analyze(bets, `Spread ${minSpread}-${maxSpread === 100 ? '∞' : maxSpread}`);
  }

  // ============================================
  // BY GAMES PLAYED
  // ============================================
  console.log('\n=== BY GAMES PLAYED (edge 3+) ===\n');

  for (const minGames of [0, 3, 5, 8, 10]) {
    const bets = edge3plus.filter(r => r.homeGames >= minGames && r.awayGames >= minGames);
    analyze(bets, `Both teams ${minGames}+ games`);
  }

  // ============================================
  // BY SEASON
  // ============================================
  console.log('\n=== BY SEASON (edge 3+) ===\n');

  for (const season of [2022, 2023, 2024, 2025]) {
    const bets = edge3plus.filter(r => r.season === season);
    analyze(bets, `${season}`);
  }

  // ============================================
  // BEST COMBINATIONS
  // ============================================
  console.log('\n=== TESTING COMBINATIONS ===\n');

  // Test various filter combos
  const combos = [
    { name: 'Edge 3-6, any', filter: (r: BetResult) => r.absEdge >= 3 && r.absEdge <= 6 },
    { name: 'Edge 3-6, underdog', filter: (r: BetResult) => r.absEdge >= 3 && r.absEdge <= 6 && r.isUnderdog },
    { name: 'Edge 3-6, favorite', filter: (r: BetResult) => r.absEdge >= 3 && r.absEdge <= 6 && r.isFavorite },
    { name: 'Edge 4-7, any', filter: (r: BetResult) => r.absEdge >= 4 && r.absEdge <= 7 },
    { name: 'Edge 4-7, underdog', filter: (r: BetResult) => r.absEdge >= 4 && r.absEdge <= 7 && r.isUnderdog },
    { name: 'Edge 4-7, favorite', filter: (r: BetResult) => r.absEdge >= 4 && r.absEdge <= 7 && r.isFavorite },
    { name: 'Edge 5+, any', filter: (r: BetResult) => r.absEdge >= 5 },
    { name: 'Edge 5+, underdog', filter: (r: BetResult) => r.absEdge >= 5 && r.isUnderdog },
    { name: 'Edge 5+, favorite', filter: (r: BetResult) => r.absEdge >= 5 && r.isFavorite },
    { name: 'Edge 3+, spread 10+, dog', filter: (r: BetResult) => r.absEdge >= 3 && r.spreadSize >= 10 && r.isUnderdog },
    { name: 'Edge 3+, spread 10+, fav', filter: (r: BetResult) => r.absEdge >= 3 && r.spreadSize >= 10 && r.isFavorite },
    { name: 'Edge 3+, spread <10, dog', filter: (r: BetResult) => r.absEdge >= 3 && r.spreadSize < 10 && r.isUnderdog },
    { name: 'Edge 3+, spread <10, fav', filter: (r: BetResult) => r.absEdge >= 3 && r.spreadSize < 10 && r.isFavorite },
    { name: 'Edge 4+, 5+ games both', filter: (r: BetResult) => r.absEdge >= 4 && r.homeGames >= 5 && r.awayGames >= 5 },
    { name: 'Edge 5+, 5+ games both', filter: (r: BetResult) => r.absEdge >= 5 && r.homeGames >= 5 && r.awayGames >= 5 },
    { name: 'Edge 3-5, 5+ games, dog', filter: (r: BetResult) => r.absEdge >= 3 && r.absEdge <= 5 && r.homeGames >= 5 && r.awayGames >= 5 && r.isUnderdog },
    { name: 'Edge 3-5, 5+ games, fav', filter: (r: BetResult) => r.absEdge >= 3 && r.absEdge <= 5 && r.homeGames >= 5 && r.awayGames >= 5 && r.isFavorite },
  ];

  for (const combo of combos) {
    const bets = results.filter(combo.filter);
    analyze(bets, combo.name);
  }

  // ============================================
  // HOLDOUT TEST (Train 2022-2024, Test 2025)
  // ============================================
  console.log('\n=== HOLDOUT TEST (Train 2022-2024, Test 2025) ===\n');

  const trainResults = results.filter(r => r.season <= 2024);
  const testResults = results.filter(r => r.season === 2025);

  // Find best strategy on training data
  console.log('Training set (2022-2024):');
  const trainCombos = [
    { name: 'Edge 3+', filter: (r: BetResult) => r.absEdge >= 3 },
    { name: 'Edge 4+', filter: (r: BetResult) => r.absEdge >= 4 },
    { name: 'Edge 5+', filter: (r: BetResult) => r.absEdge >= 5 },
    { name: 'Edge 4-7', filter: (r: BetResult) => r.absEdge >= 4 && r.absEdge <= 7 },
    { name: 'Edge 5-8', filter: (r: BetResult) => r.absEdge >= 5 && r.absEdge <= 8 },
  ];

  for (const combo of trainCombos) {
    const bets = trainResults.filter(combo.filter);
    analyze(bets, `  ${combo.name}`);
  }

  console.log('\nTest set (2025 holdout):');
  for (const combo of trainCombos) {
    const bets = testResults.filter(combo.filter);
    analyze(bets, `  ${combo.name}`);
  }

  // ============================================
  // TOP PROFITABLE STRATEGIES
  // ============================================
  console.log('\n=== TOP STRATEGIES RANKED BY ROI ===\n');

  interface Strategy {
    name: string;
    filter: (r: BetResult) => boolean;
  }

  const allStrategies: Strategy[] = [
    { name: 'All edge 2+', filter: r => r.absEdge >= 2 },
    { name: 'All edge 3+', filter: r => r.absEdge >= 3 },
    { name: 'All edge 4+', filter: r => r.absEdge >= 4 },
    { name: 'All edge 5+', filter: r => r.absEdge >= 5 },
    { name: 'All edge 6+', filter: r => r.absEdge >= 6 },
    { name: 'Edge 3-5', filter: r => r.absEdge >= 3 && r.absEdge <= 5 },
    { name: 'Edge 4-6', filter: r => r.absEdge >= 4 && r.absEdge <= 6 },
    { name: 'Edge 5-7', filter: r => r.absEdge >= 5 && r.absEdge <= 7 },
    { name: 'Edge 3+, underdog', filter: r => r.absEdge >= 3 && r.isUnderdog },
    { name: 'Edge 3+, favorite', filter: r => r.absEdge >= 3 && r.isFavorite },
    { name: 'Edge 4+, underdog', filter: r => r.absEdge >= 4 && r.isUnderdog },
    { name: 'Edge 4+, favorite', filter: r => r.absEdge >= 4 && r.isFavorite },
    { name: 'Edge 5+, underdog', filter: r => r.absEdge >= 5 && r.isUnderdog },
    { name: 'Edge 5+, favorite', filter: r => r.absEdge >= 5 && r.isFavorite },
    { name: 'Edge 3+, spread<7', filter: r => r.absEdge >= 3 && r.spreadSize < 7 },
    { name: 'Edge 3+, spread 7-14', filter: r => r.absEdge >= 3 && r.spreadSize >= 7 && r.spreadSize < 14 },
    { name: 'Edge 3+, spread 14+', filter: r => r.absEdge >= 3 && r.spreadSize >= 14 },
    { name: 'Edge 4+, 5+games', filter: r => r.absEdge >= 4 && r.homeGames >= 5 && r.awayGames >= 5 },
    { name: 'Edge 5+, 5+games', filter: r => r.absEdge >= 5 && r.homeGames >= 5 && r.awayGames >= 5 },
    { name: 'Edge 4+, 5+games, dog', filter: r => r.absEdge >= 4 && r.homeGames >= 5 && r.awayGames >= 5 && r.isUnderdog },
    { name: 'Edge 4+, 5+games, fav', filter: r => r.absEdge >= 4 && r.homeGames >= 5 && r.awayGames >= 5 && r.isFavorite },
  ];

  const strategyResults = allStrategies.map(s => {
    const bets = results.filter(s.filter);
    const wins = bets.filter(b => b.covered).length;
    const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
    return {
      name: s.name,
      bets: bets.length,
      wins,
      winRate: bets.length > 0 ? wins / bets.length : 0,
      roi: bets.length > 0 ? totalProfit / bets.length : 0,
      profit: totalProfit,
    };
  }).filter(s => s.bets >= 50) // Minimum sample size
    .sort((a, b) => b.roi - a.roi);

  for (const s of strategyResults.slice(0, 15)) {
    console.log(`${s.name}: ${s.bets} bets, ${(s.winRate * 100).toFixed(1)}% win, ${s.roi >= 0 ? '+' : ''}${(s.roi * 100).toFixed(1)}% ROI, ${s.profit >= 0 ? '+' : ''}${s.profit.toFixed(1)}u`);
  }
}

main().catch(console.error);
