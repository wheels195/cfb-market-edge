/**
 * CBB Elo Comprehensive Analysis
 *
 * Questions to answer:
 * 1. What seasons have betting lines?
 * 2. How does min games threshold affect bet volume and ROI?
 * 3. What edge range is optimal?
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

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

class CbbEloSystem {
  private ratings: Map<string, number> = new Map();
  private seasonGames: Map<string, number> = new Map();

  private readonly BASE_ELO = 1500;
  private readonly K_FACTOR = 20;
  private readonly MARGIN_MULTIPLIER = 0.8;
  private readonly SEASON_CARRYOVER = 0.6;

  public ELO_DIVISOR = 25;
  public HOME_ADVANTAGE = 2.5;

  resetSeason() {
    for (const [team, elo] of this.ratings) {
      const regressed = this.BASE_ELO + (elo - this.BASE_ELO) * this.SEASON_CARRYOVER;
      this.ratings.set(team, regressed);
    }
    this.seasonGames.clear();
  }

  getElo(team: string): number {
    if (!this.ratings.has(team)) {
      this.ratings.set(team, this.BASE_ELO);
      this.seasonGames.set(team, 0);
    }
    return this.ratings.get(team)!;
  }

  getSeasonGames(team: string): number {
    return this.seasonGames.get(team) || 0;
  }

  getSpread(homeTeam: string, awayTeam: string): number {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);
    return (awayElo - homeElo) / this.ELO_DIVISOR - this.HOME_ADVANTAGE;
  }

  update(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number) {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);

    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - this.HOME_ADVANTAGE * this.ELO_DIVISOR / 10) / 400));
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
    const margin = Math.abs(homeScore - awayScore);
    const marginMult = Math.log(margin + 1) * this.MARGIN_MULTIPLIER;
    const change = this.K_FACTOR * marginMult * (actualHome - expectedHome);

    this.ratings.set(homeTeam, homeElo + change);
    this.ratings.set(awayTeam, awayElo - change);
    this.seasonGames.set(homeTeam, (this.seasonGames.get(homeTeam) || 0) + 1);
    this.seasonGames.set(awayTeam, (this.seasonGames.get(awayTeam) || 0) + 1);
  }
}

async function fetchAllRows<T>(table: string, select: string, filters?: any[]): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (filters) {
      for (const f of filters) {
        if (f.op === 'not.is') query = query.not(f.column, 'is', f.value);
      }
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) hasMore = false;
    else {
      allData = allData.concat(data as T[]);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }
  return allData;
}

async function loadGames(): Promise<Game[]> {
  const games = await fetchAllRows<any>(
    'cbb_games',
    'id, season, start_date, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );

  const lines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );

  const lineMap = new Map<string, number>();
  for (const l of lines) lineMap.set(l.game_id, l.spread_t60);

  return games
    .filter((g: any) => g.away_team_id)
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
}

interface BetResult {
  season: number;
  won: boolean;
  profit: number;
  edge: number;
  homeGames: number;
  awayGames: number;
}

function runBacktest(games: Game[], minGames: number, minEdge: number, maxEdge: number): BetResult[] {
  const elo = new CbbEloSystem();
  const results: BetResult[] = [];
  let currentSeason = 0;

  for (const game of games) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) elo.resetSeason();
      currentSeason = game.season;
    }

    if (game.spread_t60 !== null) {
      const homeGames = elo.getSeasonGames(game.home_team_id);
      const awayGames = elo.getSeasonGames(game.away_team_id);

      if (homeGames >= minGames && awayGames >= minGames) {
        const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_t60;
        const edge = marketSpread - modelSpread;
        const absEdge = Math.abs(edge);

        if (absEdge >= minEdge && absEdge <= maxEdge) {
          const betSide = edge > 0 ? 'home' : 'away';
          const actualMargin = game.home_score - game.away_score;

          let won: boolean;
          if (betSide === 'home') won = actualMargin > -marketSpread;
          else won = actualMargin < -marketSpread;

          if (actualMargin !== -marketSpread) {
            results.push({
              season: game.season,
              won,
              profit: won ? 0.91 : -1.0,
              edge: absEdge,
              homeGames,
              awayGames,
            });
          }
        }
      }
    }

    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB ELO COMPREHENSIVE ANALYSIS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const games = await loadGames();

  // 1. Betting lines by season
  console.log('=== BETTING LINES COVERAGE BY SEASON ===\n');

  const linesBySeason = new Map<number, number>();
  for (const g of games) {
    if (g.spread_t60 !== null) {
      linesBySeason.set(g.season, (linesBySeason.get(g.season) || 0) + 1);
    }
  }

  for (const [season, count] of Array.from(linesBySeason.entries()).sort()) {
    console.log(`  ${season}: ${count} games with T-60 spreads`);
  }

  // 2. Effect of minimum games threshold
  console.log('\n\n=== EFFECT OF MIN GAMES THRESHOLD ===\n');
  console.log('(Edge filter: 2.5-5 pts, All seasons with betting lines)\n');

  console.log('  MinGames   Bets   Win%    ROI    Bets/Season');
  console.log('  ' + '─'.repeat(50));

  for (const minGames of [3, 5, 7, 10, 15, 20]) {
    const results = runBacktest(games, minGames, 2.5, 5);
    if (results.length === 0) continue;

    const wins = results.filter(r => r.won).length;
    const profit = results.reduce((sum, r) => sum + r.profit, 0);
    const seasons = new Set(results.map(r => r.season)).size;

    console.log(
      `  ${minGames.toString().padStart(8)}  ` +
      `${results.length.toString().padStart(5)}  ` +
      `${(wins / results.length * 100).toFixed(1).padStart(5)}%  ` +
      `${(profit / results.length * 100).toFixed(1).padStart(5)}%  ` +
      `${(results.length / seasons).toFixed(0).padStart(10)}`
    );
  }

  // 3. Effect of edge range
  console.log('\n\n=== EFFECT OF EDGE RANGE ===\n');
  console.log('(MinGames: 5, All seasons with betting lines)\n');

  console.log('  Edge Range   Bets   Win%    ROI');
  console.log('  ' + '─'.repeat(40));

  const edgeRanges = [
    { min: 0, max: 100, label: 'All edges' },
    { min: 2, max: 4, label: '2-4 pts' },
    { min: 2, max: 5, label: '2-5 pts' },
    { min: 2.5, max: 5, label: '2.5-5 pts' },
    { min: 3, max: 6, label: '3-6 pts' },
    { min: 3, max: 7, label: '3-7 pts' },
    { min: 4, max: 8, label: '4-8 pts' },
    { min: 5, max: 10, label: '5-10 pts' },
  ];

  for (const range of edgeRanges) {
    const results = runBacktest(games, 5, range.min, range.max);
    if (results.length === 0) continue;

    const wins = results.filter(r => r.won).length;
    const profit = results.reduce((sum, r) => sum + r.profit, 0);

    console.log(
      `  ${range.label.padEnd(10)}  ` +
      `${results.length.toString().padStart(5)}  ` +
      `${(wins / results.length * 100).toFixed(1).padStart(5)}%  ` +
      `${(profit / results.length * 100).toFixed(1).padStart(5)}%`
    );
  }

  // 4. Best config by season (MinGames=5, Edge=2.5-5)
  console.log('\n\n=== SEASON-BY-SEASON (MinGames=5, Edge=2.5-5) ===\n');

  const results = runBacktest(games, 5, 2.5, 5);
  const bySeason = new Map<number, BetResult[]>();
  for (const r of results) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season)!.push(r);
  }

  console.log('  Season   Bets   Win%    ROI    Profit');
  console.log('  ' + '─'.repeat(45));

  let totalBets = 0;
  let totalWins = 0;
  let totalProfit = 0;

  for (const [season, seasonResults] of Array.from(bySeason.entries()).sort()) {
    const wins = seasonResults.filter(r => r.won).length;
    const profit = seasonResults.reduce((sum, r) => sum + r.profit, 0);

    totalBets += seasonResults.length;
    totalWins += wins;
    totalProfit += profit;

    console.log(
      `  ${season}   ` +
      `${seasonResults.length.toString().padStart(5)}  ` +
      `${(wins / seasonResults.length * 100).toFixed(1).padStart(5)}%  ` +
      `${(profit / seasonResults.length * 100).toFixed(1).padStart(5)}%  ` +
      `${profit > 0 ? '+' : ''}${profit.toFixed(1).padStart(7)}`
    );
  }

  console.log('  ' + '─'.repeat(45));
  console.log(
    `  TOTAL   ` +
    `${totalBets.toString().padStart(5)}  ` +
    `${(totalWins / totalBets * 100).toFixed(1).padStart(5)}%  ` +
    `${(totalProfit / totalBets * 100).toFixed(1).padStart(5)}%  ` +
    `${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(1).padStart(7)}`
  );

  // 5. Early season vs late season
  console.log('\n\n=== EARLY VS LATE SEASON (MinGames=5, Edge=2.5-5) ===\n');

  const earlyBets = results.filter(r => Math.min(r.homeGames, r.awayGames) < 15);
  const lateBets = results.filter(r => Math.min(r.homeGames, r.awayGames) >= 15);

  console.log('  Period         Bets   Win%    ROI');
  console.log('  ' + '─'.repeat(40));

  if (earlyBets.length > 0) {
    const wins = earlyBets.filter(r => r.won).length;
    const profit = earlyBets.reduce((sum, r) => sum + r.profit, 0);
    console.log(
      `  Early (5-14)   ` +
      `${earlyBets.length.toString().padStart(5)}  ` +
      `${(wins / earlyBets.length * 100).toFixed(1).padStart(5)}%  ` +
      `${(profit / earlyBets.length * 100).toFixed(1).padStart(5)}%`
    );
  }

  if (lateBets.length > 0) {
    const wins = lateBets.filter(r => r.won).length;
    const profit = lateBets.reduce((sum, r) => sum + r.profit, 0);
    console.log(
      `  Late (15+)     ` +
      `${lateBets.length.toString().padStart(5)}  ` +
      `${(wins / lateBets.length * 100).toFixed(1).padStart(5)}%  ` +
      `${(profit / lateBets.length * 100).toFixed(1).padStart(5)}%`
    );
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
