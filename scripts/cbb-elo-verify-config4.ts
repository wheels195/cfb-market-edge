/**
 * Verify Config #4 - the only config that held up on holdout
 *
 * Config: Divisor=25, HFA=2.5, MinGames=10, Edge=2.5-5
 * Train (2022-2023): +7.5% ROI
 * Holdout (2024): +6.0% ROI
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
  home_team_name: string;
  away_team_name: string;
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
        if (f.op === 'not.is') query = query.not(f.column, 'is', f.value);
      }
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) {
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
  const games = await fetchAllRows<any>(
    'cbb_games',
    'id, season, start_date, home_team_id, away_team_id, home_team_name, away_team_name, home_score, away_score',
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
      home_team_name: g.home_team_name,
      away_team_name: g.away_team_name,
      home_score: g.home_score,
      away_score: g.away_score,
      spread_t60: lineMap.get(g.id) ?? null,
    }))
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
}

interface BetDetail {
  date: string;
  home: string;
  away: string;
  modelSpread: number;
  marketSpread: number;
  edge: number;
  betSide: string;
  result: string;
  homeScore: number;
  awayScore: number;
  won: boolean;
  profit: number;
  season: number;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB ELO - VERIFY CONFIG #4                              ║');
  console.log('║  Divisor=25, HFA=2.5, MinGames=10, Edge=2.5-5                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const games = await loadGames();
  const testGames = games.filter(g => g.season >= 2022 && g.season <= 2024);

  console.log(`Loaded ${testGames.length} games\n`);

  const elo = new CbbEloSystem();
  const minGames = 10;
  const minEdge = 2.5;
  const maxEdge = 5;

  const allBets: BetDetail[] = [];
  let currentSeason = 0;

  for (const game of testGames) {
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
          if (betSide === 'home') {
            won = actualMargin > -marketSpread;
          } else {
            won = actualMargin < -marketSpread;
          }

          // Skip pushes
          if (actualMargin !== -marketSpread) {
            allBets.push({
              date: game.start_date.split('T')[0],
              home: game.home_team_name,
              away: game.away_team_name,
              modelSpread,
              marketSpread,
              edge: absEdge,
              betSide: betSide === 'home' ? game.home_team_name : game.away_team_name,
              result: `${game.home_score}-${game.away_score}`,
              homeScore: game.home_score,
              awayScore: game.away_score,
              won,
              profit: won ? 0.91 : -1.0,
              season: game.season,
            });
          }
        }
      }
    }

    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  // Summarize by season
  console.log('=== RESULTS BY SEASON ===\n');

  for (const season of [2022, 2023, 2024]) {
    const seasonBets = allBets.filter(b => b.season === season);
    if (seasonBets.length === 0) continue;

    const wins = seasonBets.filter(b => b.won).length;
    const profit = seasonBets.reduce((sum, b) => sum + b.profit, 0);
    const roi = profit / seasonBets.length;

    console.log(`${season}: ${seasonBets.length} bets | ${wins}-${seasonBets.length - wins} (${(wins / seasonBets.length * 100).toFixed(1)}%) | ${profit > 0 ? '+' : ''}${profit.toFixed(2)} units | ROI: ${(roi * 100).toFixed(1)}%`);
  }

  // Combined
  console.log('');
  const totalWins = allBets.filter(b => b.won).length;
  const totalProfit = allBets.reduce((sum, b) => sum + b.profit, 0);
  const totalRoi = totalProfit / allBets.length;
  console.log(`TOTAL: ${allBets.length} bets | ${totalWins}-${allBets.length - totalWins} (${(totalWins / allBets.length * 100).toFixed(1)}%) | ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} units | ROI: ${(totalRoi * 100).toFixed(1)}%`);

  // Monthly breakdown for 2024 to see if it's consistent
  console.log('\n=== 2024 MONTHLY BREAKDOWN ===\n');

  const bets2024 = allBets.filter(b => b.season === 2024);
  const byMonth = new Map<string, BetDetail[]>();

  for (const bet of bets2024) {
    const month = bet.date.substring(0, 7); // YYYY-MM
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(bet);
  }

  const months = Array.from(byMonth.keys()).sort();
  for (const month of months) {
    const monthBets = byMonth.get(month)!;
    const wins = monthBets.filter(b => b.won).length;
    const profit = monthBets.reduce((sum, b) => sum + b.profit, 0);
    const roi = profit / monthBets.length;
    console.log(`${month}: ${monthBets.length.toString().padStart(3)} bets | ${wins}-${monthBets.length - wins} | ${(wins / monthBets.length * 100).toFixed(0).padStart(2)}% | ROI: ${(roi * 100).toFixed(0).padStart(4)}%`);
  }

  // Sample some winning and losing bets
  console.log('\n=== SAMPLE BETS (2024) ===\n');

  const winningBets = bets2024.filter(b => b.won).slice(0, 3);
  const losingBets = bets2024.filter(b => !b.won).slice(0, 3);

  console.log('Winning bets:');
  for (const bet of winningBets) {
    console.log(`  ${bet.date}: ${bet.away} @ ${bet.home}`);
    console.log(`    Model: ${bet.modelSpread > 0 ? bet.away : bet.home} by ${Math.abs(bet.modelSpread).toFixed(1)}`);
    console.log(`    Market: ${bet.marketSpread > 0 ? bet.away : bet.home} by ${Math.abs(bet.marketSpread).toFixed(1)}`);
    console.log(`    Bet: ${bet.betSide} | Result: ${bet.result} | ✓ WON`);
  }

  console.log('\nLosing bets:');
  for (const bet of losingBets) {
    console.log(`  ${bet.date}: ${bet.away} @ ${bet.home}`);
    console.log(`    Model: ${bet.modelSpread > 0 ? bet.away : bet.home} by ${Math.abs(bet.modelSpread).toFixed(1)}`);
    console.log(`    Market: ${bet.marketSpread > 0 ? bet.away : bet.home} by ${Math.abs(bet.marketSpread).toFixed(1)}`);
    console.log(`    Bet: ${bet.betSide} | Result: ${bet.result} | ✗ LOST`);
  }

  // Edge analysis
  console.log('\n=== EDGE BREAKDOWN (2024) ===\n');

  const edgeBuckets = [
    { min: 2.5, max: 3.0 },
    { min: 3.0, max: 3.5 },
    { min: 3.5, max: 4.0 },
    { min: 4.0, max: 5.0 },
  ];

  for (const bucket of edgeBuckets) {
    const bucketBets = bets2024.filter(b => b.edge >= bucket.min && b.edge < bucket.max);
    if (bucketBets.length > 0) {
      const wins = bucketBets.filter(b => b.won).length;
      const roi = bucketBets.reduce((sum, b) => sum + b.profit, 0) / bucketBets.length;
      console.log(`${bucket.min}-${bucket.max} pts: ${bucketBets.length} bets, ${(wins / bucketBets.length * 100).toFixed(0)}% win, ${(roi * 100).toFixed(0)}% ROI`);
    }
  }

  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
