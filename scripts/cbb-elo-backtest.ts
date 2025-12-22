/**
 * CBB In-Season Elo Backtest
 *
 * Builds fresh Elo ratings that update after every game.
 * For each game:
 *   1. Use CURRENT Elo to generate our spread
 *   2. Compare to market spread
 *   3. Bet when edge exists
 *   4. Update Elo AFTER the game
 *
 * This mimics real-time betting with fresh information.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// ============ TYPES ============

interface Game {
  id: string;
  season: number;
  start_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  spread_t60: number | null;
}

interface BetResult {
  won: boolean;
  profit: number;
  edge: number;
  homeElo: number;
  awayElo: number;
  modelSpread: number;
  marketSpread: number;
  betSide: 'home' | 'away';
  homeGames: number;
  awayGames: number;
}

// ============ ELO SYSTEM ============

class CbbEloSystem {
  private ratings: Map<string, number> = new Map();
  private gamesPlayed: Map<string, number> = new Map();
  private seasonGames: Map<string, number> = new Map(); // games this season only

  // Tunable parameters
  private readonly BASE_ELO = 1500;
  private readonly K_FACTOR = 20;
  private readonly MARGIN_MULTIPLIER = 0.8;
  private readonly SEASON_CARRYOVER = 0.6; // How much prior season Elo carries over

  // For spread calculation
  public ELO_DIVISOR = 25; // Elo diff / divisor = spread pts
  public HOME_ADVANTAGE = 3.5;

  constructor() {}

  // Reset for new season (partial carryover)
  resetSeason(season: number) {
    // Regress everyone toward mean
    for (const [team, elo] of this.ratings) {
      const regressed = this.BASE_ELO + (elo - this.BASE_ELO) * this.SEASON_CARRYOVER;
      this.ratings.set(team, regressed);
    }
    // Reset season game counts
    this.seasonGames.clear();
  }

  getElo(team: string): number {
    if (!this.ratings.has(team)) {
      this.ratings.set(team, this.BASE_ELO);
      this.gamesPlayed.set(team, 0);
      this.seasonGames.set(team, 0);
    }
    return this.ratings.get(team)!;
  }

  getSeasonGames(team: string): number {
    return this.seasonGames.get(team) || 0;
  }

  getTotalGames(team: string): number {
    return this.gamesPlayed.get(team) || 0;
  }

  // Calculate model spread (negative = home favored)
  getSpread(homeTeam: string, awayTeam: string): number {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);
    // Spread from home perspective: positive = home underdog
    return (awayElo - homeElo) / this.ELO_DIVISOR - this.HOME_ADVANTAGE;
  }

  // Update Elo after a game
  update(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number) {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);

    // Expected outcome for home team
    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - this.HOME_ADVANTAGE * this.ELO_DIVISOR / 10) / 400));

    // Actual outcome
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;

    // Margin of victory multiplier (log scale)
    const margin = Math.abs(homeScore - awayScore);
    const marginMult = Math.log(margin + 1) * this.MARGIN_MULTIPLIER;

    // Elo change
    const change = this.K_FACTOR * marginMult * (actualHome - expectedHome);

    this.ratings.set(homeTeam, homeElo + change);
    this.ratings.set(awayTeam, awayElo - change);

    // Update game counts
    this.gamesPlayed.set(homeTeam, (this.gamesPlayed.get(homeTeam) || 0) + 1);
    this.gamesPlayed.set(awayTeam, (this.gamesPlayed.get(awayTeam) || 0) + 1);
    this.seasonGames.set(homeTeam, (this.seasonGames.get(homeTeam) || 0) + 1);
    this.seasonGames.set(awayTeam, (this.seasonGames.get(awayTeam) || 0) + 1);
  }

  // Get top teams by Elo
  getTopTeams(n: number = 25): Array<{ team: string; elo: number }> {
    return Array.from(this.ratings.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([team, elo]) => ({ team, elo }));
  }
}

// ============ DATA LOADING ============

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

async function loadGames(): Promise<Game[]> {
  console.log('Loading games...');

  // Get all completed games
  const games = await fetchAllRows<any>(
    'cbb_games',
    'id, season, start_date, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );
  console.log(`  Found ${games.length} completed games`);

  // Get betting lines
  const lines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );
  console.log(`  Found ${lines.length} games with T-60 spreads`);

  const lineMap = new Map<string, number>();
  for (const l of lines) {
    lineMap.set(l.game_id, l.spread_t60);
  }

  // Combine and sort chronologically
  const combined: Game[] = games
    .filter((g: any) => g.away_team_id) // Need both teams
    .map((g: any) => ({
      id: g.id,
      season: g.season,
      start_date: g.start_date,
      home_team_id: g.home_team_id,
      away_team_id: g.away_team_id,
      home_score: g.home_score,
      away_score: g.away_score,
      spread_t60: lineMap.get(g.id) ?? null,
    }))
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

  console.log(`  Combined dataset: ${combined.length} games\n`);
  return combined;
}

// ============ BACKTEST ============

interface BacktestConfig {
  minEdge: number;
  maxEdge: number;
  minGames: number; // Minimum games each team must have played
  eloDivisor: number;
  hfa: number;
}

function runBacktest(games: Game[], config: BacktestConfig): BetResult[] {
  const elo = new CbbEloSystem();
  elo.ELO_DIVISOR = config.eloDivisor;
  elo.HOME_ADVANTAGE = config.hfa;

  const results: BetResult[] = [];
  let currentSeason = 0;

  for (const game of games) {
    // Reset Elo at season boundary
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) {
        elo.resetSeason(game.season);
      }
      currentSeason = game.season;
    }

    // Only bet on games with T-60 spread
    if (game.spread_t60 !== null) {
      const homeElo = elo.getElo(game.home_team_id);
      const awayElo = elo.getElo(game.away_team_id);
      const homeGames = elo.getSeasonGames(game.home_team_id);
      const awayGames = elo.getSeasonGames(game.away_team_id);

      // Check minimum games requirement
      if (homeGames >= config.minGames && awayGames >= config.minGames) {
        const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_t60;

        // Edge = how much market disagrees with us
        // Positive edge on home = market has home as bigger dog than we do
        const edge = marketSpread - modelSpread;
        const absEdge = Math.abs(edge);

        if (absEdge >= config.minEdge && absEdge <= config.maxEdge) {
          // Bet our model's direction
          const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
          const actualMargin = game.home_score - game.away_score;

          let won: boolean;
          if (betSide === 'home') {
            won = actualMargin > -marketSpread;
          } else {
            won = actualMargin < -marketSpread;
          }

          // Skip pushes
          if (actualMargin !== -marketSpread) {
            results.push({
              won,
              profit: won ? 0.91 : -1.0,
              edge: absEdge,
              homeElo,
              awayElo,
              modelSpread,
              marketSpread,
              betSide,
              homeGames,
              awayGames,
            });
          }
        }
      }
    }

    // Always update Elo after game (even if we didn't bet)
    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  return results;
}

// ============ ANALYSIS ============

function summarize(results: BetResult[], label: string) {
  if (results.length === 0) {
    console.log(`${label}: No bets`);
    return { wins: 0, total: 0, roi: 0 };
  }

  const wins = results.filter(r => r.won).length;
  const winRate = wins / results.length;
  const profit = results.reduce((sum, r) => sum + r.profit, 0);
  const roi = profit / results.length;

  const homeBets = results.filter(r => r.betSide === 'home').length;
  const homeWins = results.filter(r => r.betSide === 'home' && r.won).length;
  const awayWins = results.filter(r => r.betSide === 'away' && r.won).length;

  console.log(`${label}:`);
  console.log(`  Bets: ${results.length} | Record: ${wins}-${results.length - wins} (${(winRate * 100).toFixed(1)}%)`);
  console.log(`  Profit: ${profit > 0 ? '+' : ''}${profit.toFixed(2)} units | ROI: ${(roi * 100).toFixed(2)}%`);
  console.log(`  Home: ${homeBets} bets (${homeWins} wins) | Away: ${results.length - homeBets} bets (${awayWins} wins)`);

  return { wins, total: results.length, roi };
}

function gridSearch(games: Game[]) {
  console.log('\n=== GRID SEARCH FOR OPTIMAL PARAMETERS ===\n');

  const divisors = [20, 25, 30, 35];
  const hfas = [2.5, 3.0, 3.5, 4.0];
  const minGamesOptions = [3, 5, 7, 10];
  const edgeRanges = [
    { min: 2, max: 6 },
    { min: 2.5, max: 5 },
    { min: 3, max: 7 },
    { min: 4, max: 8 },
  ];

  interface SearchResult {
    divisor: number;
    hfa: number;
    minGames: number;
    edgeMin: number;
    edgeMax: number;
    bets: number;
    winRate: number;
    roi: number;
  }

  const searchResults: SearchResult[] = [];

  for (const divisor of divisors) {
    for (const hfa of hfas) {
      for (const minGames of minGamesOptions) {
        for (const edge of edgeRanges) {
          const results = runBacktest(games, {
            minEdge: edge.min,
            maxEdge: edge.max,
            minGames,
            eloDivisor: divisor,
            hfa,
          });

          if (results.length >= 100) {
            const wins = results.filter(r => r.won).length;
            const roi = results.reduce((sum, r) => sum + r.profit, 0) / results.length;

            searchResults.push({
              divisor,
              hfa,
              minGames,
              edgeMin: edge.min,
              edgeMax: edge.max,
              bets: results.length,
              winRate: wins / results.length,
              roi,
            });
          }
        }
      }
    }
  }

  // Sort by ROI
  searchResults.sort((a, b) => b.roi - a.roi);

  console.log('Top 10 Configurations:\n');
  console.log('  Divisor  HFA  MinGm  Edge     Bets   Win%    ROI');
  console.log('  ' + '─'.repeat(55));

  for (let i = 0; i < Math.min(10, searchResults.length); i++) {
    const r = searchResults[i];
    const edgeStr = `${r.edgeMin}-${r.edgeMax}`.padEnd(5);
    console.log(
      `  ${r.divisor.toString().padStart(5)}  ` +
      `${r.hfa.toFixed(1).padStart(4)}  ` +
      `${r.minGames.toString().padStart(5)}  ` +
      `${edgeStr}  ` +
      `${r.bets.toString().padStart(5)}  ` +
      `${(r.winRate * 100).toFixed(1).padStart(5)}%  ` +
      `${(r.roi * 100).toFixed(1).padStart(6)}%`
    );
  }

  return searchResults[0]; // Return best config
}

// ============ MAIN ============

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              CBB IN-SEASON ELO BACKTEST                            ║');
  console.log('║  Fresh ratings that update after every game                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const games = await loadGames();

  // Filter to seasons we want
  const testGames = games.filter(g => g.season >= 2022 && g.season <= 2024);
  console.log(`Testing on seasons 2022-2024: ${testGames.length} games`);
  console.log(`Games with T-60 spreads: ${testGames.filter(g => g.spread_t60 !== null).length}\n`);

  // Grid search for best parameters
  const best = gridSearch(testGames);

  if (best) {
    console.log(`\nBest config: Divisor=${best.divisor}, HFA=${best.hfa}, MinGames=${best.minGames}, Edge=${best.edgeMin}-${best.edgeMax}`);

    // Run detailed analysis with best config
    console.log('\n' + '═'.repeat(70));
    console.log('                    DETAILED ANALYSIS');
    console.log('═'.repeat(70) + '\n');

    const results = runBacktest(testGames, {
      minEdge: best.edgeMin,
      maxEdge: best.edgeMax,
      minGames: best.minGames,
      eloDivisor: best.divisor,
      hfa: best.hfa,
    });

    summarize(results, 'All Bets (Best Config)');

    // By edge bucket
    console.log('\nBy Edge Size:');
    const edgeBuckets = [
      { min: 2, max: 3, label: '2-3 pts' },
      { min: 3, max: 4, label: '3-4 pts' },
      { min: 4, max: 5, label: '4-5 pts' },
      { min: 5, max: 6, label: '5-6 pts' },
      { min: 6, max: 8, label: '6-8 pts' },
    ];

    for (const bucket of edgeBuckets) {
      const bucketResults = results.filter(r => r.edge >= bucket.min && r.edge < bucket.max);
      if (bucketResults.length > 0) {
        const wins = bucketResults.filter(r => r.won).length;
        const roi = bucketResults.reduce((sum, r) => sum + r.profit, 0) / bucketResults.length;
        console.log(`  ${bucket.label}: ${bucketResults.length} bets, ${(wins/bucketResults.length*100).toFixed(1)}% win, ${(roi*100).toFixed(1)}% ROI`);
      }
    }

    // By minimum games threshold
    console.log('\nBy Team Experience (min season games):');
    for (const minG of [3, 5, 7, 10, 15]) {
      const filtered = results.filter(r => r.homeGames >= minG && r.awayGames >= minG);
      if (filtered.length > 50) {
        const wins = filtered.filter(r => r.won).length;
        const roi = filtered.reduce((sum, r) => sum + r.profit, 0) / filtered.length;
        console.log(`  ${minG}+ games: ${filtered.length} bets, ${(wins/filtered.length*100).toFixed(1)}% win, ${(roi*100).toFixed(1)}% ROI`);
      }
    }

    // Year by year
    console.log('\nBy Season:');
    for (const season of [2022, 2023, 2024]) {
      const seasonGames = testGames.filter(g => g.season === season);
      const seasonResults = runBacktest(seasonGames, {
        minEdge: best.edgeMin,
        maxEdge: best.edgeMax,
        minGames: best.minGames,
        eloDivisor: best.divisor,
        hfa: best.hfa,
      });
      if (seasonResults.length > 0) {
        const wins = seasonResults.filter(r => r.won).length;
        const roi = seasonResults.reduce((sum, r) => sum + r.profit, 0) / seasonResults.length;
        console.log(`  ${season}: ${seasonResults.length} bets, ${(wins/seasonResults.length*100).toFixed(1)}% win, ${(roi*100).toFixed(1)}% ROI`);
      }
    }
  }

  // Also test with default/baseline params
  console.log('\n' + '═'.repeat(70));
  console.log('                    BASELINE COMPARISON');
  console.log('═'.repeat(70) + '\n');

  const baselineConfigs = [
    { label: 'Wide filter (2-8 pts, 3+ games)', minEdge: 2, maxEdge: 8, minGames: 3, eloDivisor: 25, hfa: 3.5 },
    { label: 'Tight filter (3-5 pts, 5+ games)', minEdge: 3, maxEdge: 5, minGames: 5, eloDivisor: 25, hfa: 3.5 },
    { label: 'Large edge (5-10 pts, 5+ games)', minEdge: 5, maxEdge: 10, minGames: 5, eloDivisor: 25, hfa: 3.5 },
  ];

  for (const cfg of baselineConfigs) {
    const results = runBacktest(testGames, cfg);
    summarize(results, cfg.label);
    console.log('');
  }

  // Assessment
  console.log('═'.repeat(70));
  console.log('                        ASSESSMENT');
  console.log('═'.repeat(70) + '\n');

  if (best && best.roi > 0.02) {
    console.log('✅ PROMISING: In-season Elo shows potential edge (ROI > +2%)');
    console.log('   Worth further testing with out-of-sample data.');
  } else if (best && best.roi > -0.02) {
    console.log('⚠️ MARGINAL: Near break-even');
    console.log('   May need better data (KenPom) to find consistent edge.');
  } else {
    console.log('❌ NO EDGE: In-season Elo does not beat market');
    console.log('   CBB market efficiently prices fresh information.');
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
