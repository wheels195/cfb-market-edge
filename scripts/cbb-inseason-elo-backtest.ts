/**
 * CBB In-Season Elo Backtest
 *
 * Builds Elo ratings from game-by-game results and tests if
 * in-season ratings predict better than prior-season ratings.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Elo parameters (tuned for CBB)
const BASE_ELO = 1500;
const K_FACTOR = 20;
const HOME_ADVANTAGE = 100; // ~3.5 points in Elo terms
const ELO_DIVISOR = 28; // Convert Elo diff to spread (CBB-specific)

interface Game {
  id: string;
  season: number;
  start_date: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
}

interface BettingLine {
  game_id: string;
  spread_t60: number;
}

interface PriorSeasonRating {
  team_id: string;
  season: number;
  net_rating: number;
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

class EloSystem {
  private ratings: Map<string, number> = new Map();
  private priorSeasonRatings: Map<string, Map<number, number>> = new Map();

  constructor(priorRatings: PriorSeasonRating[]) {
    // Store prior season ratings for initialization
    for (const r of priorRatings) {
      if (!this.priorSeasonRatings.has(r.team_id)) {
        this.priorSeasonRatings.set(r.team_id, new Map());
      }
      // Convert net rating to Elo (net rating ~0-40 range, Elo ~1200-1800)
      const elo = BASE_ELO + r.net_rating * 10;
      this.priorSeasonRatings.get(r.team_id)!.set(r.season, elo);
    }
  }

  getElo(teamId: string, season: number): number {
    const key = `${teamId}_${season}`;
    if (this.ratings.has(key)) {
      return this.ratings.get(key)!;
    }

    // Initialize from prior season
    const priorSeason = season - 1;
    const priorElo = this.priorSeasonRatings.get(teamId)?.get(priorSeason);

    if (priorElo !== undefined) {
      // Regress toward mean (70% prior + 30% base)
      const initialElo = priorElo * 0.7 + BASE_ELO * 0.3;
      this.ratings.set(key, initialElo);
      return initialElo;
    }

    // No prior data - use base
    this.ratings.set(key, BASE_ELO);
    return BASE_ELO;
  }

  updateElo(homeTeamId: string, awayTeamId: string, homeScore: number, awayScore: number, season: number): void {
    const homeKey = `${homeTeamId}_${season}`;
    const awayKey = `${awayTeamId}_${season}`;

    const homeElo = this.getElo(homeTeamId, season);
    const awayElo = this.getElo(awayTeamId, season);

    // Expected outcome (with home advantage)
    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - HOME_ADVANTAGE) / 400));

    // Actual outcome
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;

    // Margin of victory multiplier
    const marginMultiplier = Math.log(Math.abs(homeScore - awayScore) + 1) * 0.8;

    // Update ratings
    const change = K_FACTOR * marginMultiplier * (actualHome - expectedHome);
    this.ratings.set(homeKey, homeElo + change);
    this.ratings.set(awayKey, awayElo - change);
  }

  getSpreadFromElo(homeElo: number, awayElo: number): number {
    // Positive spread = home is underdog
    const eloDiff = awayElo - homeElo;
    return eloDiff / ELO_DIVISOR + 3.5; // 3.5 pt HFA
  }
}

interface BacktestResult {
  won: boolean;
  profit: number;
  edge: number;
}

function runBacktest(
  games: Array<{
    spread_t60: number;
    home_score: number;
    away_score: number;
    model_spread: number;
  }>,
  minEdge: number,
  maxEdge: number
): BacktestResult[] {
  const results: BacktestResult[] = [];

  for (const game of games) {
    const edge = game.spread_t60 - game.model_spread;
    const absEdge = Math.abs(edge);

    if (absEdge < minEdge || absEdge > maxEdge) continue;

    const betSide = edge > 0 ? 'home' : 'away';
    const actualMargin = game.home_score - game.away_score;

    let won: boolean;
    if (betSide === 'home') {
      won = actualMargin > -game.spread_t60;
    } else {
      won = actualMargin < -game.spread_t60;
    }

    // Handle push
    if (actualMargin === -game.spread_t60) continue;

    results.push({
      won,
      profit: won ? 0.91 : -1.0,
      edge: absEdge,
    });
  }

  return results;
}

function summarize(results: BacktestResult[], label: string): void {
  if (results.length === 0) {
    console.log(`${label}: No bets`);
    return;
  }

  const wins = results.filter(r => r.won).length;
  const winRate = wins / results.length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const roi = totalProfit / results.length;

  console.log(`${label}: ${results.length} bets | ${wins}-${results.length - wins} | ${(winRate * 100).toFixed(1)}% | ROI: ${(roi * 100).toFixed(1)}%`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       CBB IN-SEASON ELO BACKTEST                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Fetch all data
  console.log('\n=== Loading Data ===\n');

  // Get all games (need all seasons for Elo building)
  console.log('Fetching all games...');
  const allGames = await fetchAllRows<Game>(
    'cbb_games',
    'id, season, start_date, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );

  // Filter to games with both teams (some games have null away_team_id)
  const validGames = allGames.filter(g => g.home_team_id && g.away_team_id);
  console.log(`Found ${validGames.length} completed games with both teams`);

  // Sort chronologically
  validGames.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

  // Get betting lines
  console.log('Fetching betting lines...');
  const bettingLines = await fetchAllRows<BettingLine>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );
  console.log(`Found ${bettingLines.length} games with T-60 spreads`);

  const linesByGame = new Map<string, number>();
  for (const line of bettingLines) {
    linesByGame.set(line.game_id, line.spread_t60);
  }

  // Get prior season ratings
  console.log('Fetching prior season ratings...');
  const priorRatings = await fetchAllRows<PriorSeasonRating>(
    'cbb_team_ratings',
    'team_id, season, net_rating'
  );
  console.log(`Loaded ${priorRatings.length} prior season ratings`);

  // Initialize Elo system
  const elo = new EloSystem(priorRatings);

  // Process games and build backtest data
  console.log('\n=== Building In-Season Elo ===\n');

  interface BacktestGame {
    spread_t60: number;
    home_score: number;
    away_score: number;
    model_spread_elo: number; // In-season Elo
    model_spread_prior: number; // Prior season rating
    season: number;
    games_played_home: number;
    games_played_away: number;
  }

  const backtestGames: BacktestGame[] = [];
  const gameCountByTeam = new Map<string, number>();

  // Prior season ratings map (for comparison)
  const priorRatingsMap = new Map<string, Map<number, number>>();
  for (const r of priorRatings) {
    if (!priorRatingsMap.has(r.team_id)) {
      priorRatingsMap.set(r.team_id, new Map());
    }
    priorRatingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }

  let gamesProcessed = 0;
  let gamesWithLines = 0;
  let gamesWithPrior = 0;

  for (const game of validGames) {
    gamesProcessed++;

    // Get current Elo BEFORE this game
    const homeElo = elo.getElo(game.home_team_id, game.season);
    const awayElo = elo.getElo(game.away_team_id!, game.season);

    // Get games played count
    const homeKey = `${game.home_team_id}_${game.season}`;
    const awayKey = `${game.away_team_id}_${game.season}`;
    const homeGamesPlayed = gameCountByTeam.get(homeKey) || 0;
    const awayGamesPlayed = gameCountByTeam.get(awayKey) || 0;

    // Check if this game has betting lines (for backtest)
    const line = linesByGame.get(game.id);
    if (line !== undefined && (game.season === 2023 || game.season === 2024)) {
      gamesWithLines++;

      // Calculate model spread from in-season Elo
      const modelSpreadElo = elo.getSpreadFromElo(homeElo, awayElo);

      // Calculate model spread from prior season ratings
      const priorSeason = game.season - 1;
      const homePrior = priorRatingsMap.get(game.home_team_id)?.get(priorSeason);
      const awayPrior = priorRatingsMap.get(game.away_team_id!)?.get(priorSeason);

      if (homePrior !== undefined && awayPrior !== undefined) {
        gamesWithPrior++;
        const modelSpreadPrior = (awayPrior - homePrior) / 3.5 + 3.0; // Same formula as before

        backtestGames.push({
          spread_t60: line,
          home_score: game.home_score,
          away_score: game.away_score,
          model_spread_elo: modelSpreadElo,
          model_spread_prior: modelSpreadPrior,
          season: game.season,
          games_played_home: homeGamesPlayed,
          games_played_away: awayGamesPlayed,
        });
      }
    }

    // Update Elo AFTER this game
    elo.updateElo(game.home_team_id, game.away_team_id!, game.home_score, game.away_score, game.season);

    // Update game counts
    gameCountByTeam.set(homeKey, homeGamesPlayed + 1);
    gameCountByTeam.set(awayKey, awayGamesPlayed + 1);

    if (gamesProcessed % 5000 === 0) {
      console.log(`Processed ${gamesProcessed} games...`);
    }
  }

  console.log(`\nProcessed ${gamesProcessed} total games`);
  console.log(`Games with betting lines: ${gamesWithLines}`);
  console.log(`Games with prior season ratings: ${gamesWithPrior}`);
  console.log(`Backtest dataset: ${backtestGames.length} games`);

  // Compare In-Season Elo vs Prior Season Ratings
  console.log('\n=== COMPARISON: In-Season Elo vs Prior Season Ratings ===\n');

  const edgeRanges = [
    { min: 0, max: 100, label: 'All edges' },
    { min: 2.5, max: 5.0, label: '2.5-5 pts' },
    { min: 3.0, max: 6.0, label: '3-6 pts' },
    { min: 5.0, max: 10.0, label: '5-10 pts' },
  ];

  for (const range of edgeRanges) {
    console.log(`\n--- Edge Filter: ${range.label} ---`);

    const eloGames = backtestGames.map(g => ({
      spread_t60: g.spread_t60,
      home_score: g.home_score,
      away_score: g.away_score,
      model_spread: g.model_spread_elo,
    }));

    const priorGames = backtestGames.map(g => ({
      spread_t60: g.spread_t60,
      home_score: g.home_score,
      away_score: g.away_score,
      model_spread: g.model_spread_prior,
    }));

    const eloResults = runBacktest(eloGames, range.min, range.max);
    const priorResults = runBacktest(priorGames, range.min, range.max);

    summarize(eloResults, 'In-Season Elo');
    summarize(priorResults, 'Prior Season');
  }

  // Test by games played (early vs late season)
  console.log('\n=== BY SEASON TIMING (In-Season Elo) ===\n');

  const earlySeasonGames = backtestGames.filter(g =>
    g.games_played_home < 5 || g.games_played_away < 5
  );
  const midSeasonGames = backtestGames.filter(g =>
    g.games_played_home >= 5 && g.games_played_home < 15 &&
    g.games_played_away >= 5 && g.games_played_away < 15
  );
  const lateSeasonGames = backtestGames.filter(g =>
    g.games_played_home >= 15 && g.games_played_away >= 15
  );

  console.log(`Early season (0-4 games): ${earlySeasonGames.length} games`);
  console.log(`Mid season (5-14 games): ${midSeasonGames.length} games`);
  console.log(`Late season (15+ games): ${lateSeasonGames.length} games`);

  console.log('\n--- All Edges ---');
  summarize(runBacktest(earlySeasonGames.map(g => ({
    spread_t60: g.spread_t60,
    home_score: g.home_score,
    away_score: g.away_score,
    model_spread: g.model_spread_elo,
  })), 0, 100), 'Early Season (Elo)');

  summarize(runBacktest(midSeasonGames.map(g => ({
    spread_t60: g.spread_t60,
    home_score: g.home_score,
    away_score: g.away_score,
    model_spread: g.model_spread_elo,
  })), 0, 100), 'Mid Season (Elo)');

  summarize(runBacktest(lateSeasonGames.map(g => ({
    spread_t60: g.spread_t60,
    home_score: g.home_score,
    away_score: g.away_score,
    model_spread: g.model_spread_elo,
  })), 0, 100), 'Late Season (Elo)');

  // Year-by-year
  console.log('\n=== YEAR-BY-YEAR ===\n');

  for (const season of [2023, 2024]) {
    const seasonGames = backtestGames.filter(g => g.season === season);
    console.log(`\n--- ${season} Season (${seasonGames.length} games) ---`);

    const eloGames = seasonGames.map(g => ({
      spread_t60: g.spread_t60,
      home_score: g.home_score,
      away_score: g.away_score,
      model_spread: g.model_spread_elo,
    }));

    const priorGames = seasonGames.map(g => ({
      spread_t60: g.spread_t60,
      home_score: g.home_score,
      away_score: g.away_score,
      model_spread: g.model_spread_prior,
    }));

    summarize(runBacktest(eloGames, 0, 100), 'In-Season Elo');
    summarize(runBacktest(priorGames, 0, 100), 'Prior Season');
  }

  // Ensemble: combine in-season Elo with prior season
  console.log('\n=== ENSEMBLE: 50% Elo + 50% Prior ===\n');

  const ensembleGames = backtestGames.map(g => ({
    spread_t60: g.spread_t60,
    home_score: g.home_score,
    away_score: g.away_score,
    model_spread: (g.model_spread_elo + g.model_spread_prior) / 2,
  }));

  for (const range of edgeRanges) {
    summarize(runBacktest(ensembleGames, range.min, range.max), range.label);
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
