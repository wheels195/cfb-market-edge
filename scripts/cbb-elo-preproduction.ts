/**
 * CBB Elo Pre-Production Validation
 *
 * Comprehensive analysis before going live:
 * 1. Home vs Away bias
 * 2. Favorites vs Underdogs
 * 3. Conference vs Non-conference
 * 4. Time of season
 * 5. Spread size buckets
 * 6. Drawdown/Risk analysis
 * 7. Month-by-month consistency
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
  conference_game: boolean;
}

interface BetDetail {
  date: string;
  season: number;
  month: string;
  betSide: 'home' | 'away';
  bettingFavorite: boolean;
  spreadSize: number; // absolute value of market spread
  conferenceGame: boolean;
  homeGames: number;
  awayGames: number;
  edge: number;
  won: boolean;
  profit: number;
  cumProfit: number;
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
    'id, season, start_date, home_team_id, away_team_id, home_score, away_score, conference_game',
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
      conference_game: g.conference_game || false,
    }))
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
}

function runDetailedBacktest(games: Game[], minGames: number, minEdge: number, maxEdge: number): BetDetail[] {
  const elo = new CbbEloSystem();
  const results: BetDetail[] = [];
  let currentSeason = 0;
  let cumProfit = 0;

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
          const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
          const actualMargin = game.home_score - game.away_score;

          // Favorite = negative spread side
          // If market spread is -5, home is favorite
          // If we bet home when spread is -5, we're betting the favorite
          const bettingFavorite = (betSide === 'home' && marketSpread < 0) ||
                                   (betSide === 'away' && marketSpread > 0);

          let won: boolean;
          if (betSide === 'home') won = actualMargin > -marketSpread;
          else won = actualMargin < -marketSpread;

          if (actualMargin !== -marketSpread) {
            const profit = won ? 0.91 : -1.0;
            cumProfit += profit;

            results.push({
              date: game.start_date.split('T')[0],
              season: game.season,
              month: game.start_date.substring(0, 7),
              betSide,
              bettingFavorite,
              spreadSize: Math.abs(marketSpread),
              conferenceGame: game.conference_game,
              homeGames,
              awayGames,
              edge: absEdge,
              won,
              profit,
              cumProfit,
            });
          }
        }
      }
    }

    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  return results;
}

function summarize(bets: BetDetail[], label: string) {
  if (bets.length === 0) {
    console.log(`  ${label}: No bets`);
    return;
  }
  const wins = bets.filter(b => b.won).length;
  const profit = bets.reduce((sum, b) => sum + b.profit, 0);
  const roi = profit / bets.length;
  console.log(
    `  ${label.padEnd(25)} ${bets.length.toString().padStart(5)} bets | ` +
    `${wins}-${bets.length - wins} (${(wins / bets.length * 100).toFixed(1)}%) | ` +
    `ROI: ${(roi * 100).toFixed(1)}%`
  );
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB ELO PRE-PRODUCTION VALIDATION                       ║');
  console.log('║  Config: MinGames=5, Edge=2.5-5                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const games = await loadGames();
  const bets = runDetailedBacktest(games, 5, 2.5, 5);

  console.log(`Total bets: ${bets.length}\n`);

  // 1. Home vs Away
  console.log('=== 1. HOME VS AWAY ===\n');
  summarize(bets.filter(b => b.betSide === 'home'), 'Betting Home');
  summarize(bets.filter(b => b.betSide === 'away'), 'Betting Away');

  // 2. Favorites vs Underdogs
  console.log('\n=== 2. FAVORITES VS UNDERDOGS ===\n');
  summarize(bets.filter(b => b.bettingFavorite), 'Betting Favorite');
  summarize(bets.filter(b => !b.bettingFavorite), 'Betting Underdog');

  // 3. Conference vs Non-conference
  console.log('\n=== 3. CONFERENCE VS NON-CONFERENCE ===\n');
  summarize(bets.filter(b => b.conferenceGame), 'Conference Games');
  summarize(bets.filter(b => !b.conferenceGame), 'Non-Conference Games');

  // 4. Spread Size
  console.log('\n=== 4. BY SPREAD SIZE ===\n');
  summarize(bets.filter(b => b.spreadSize < 5), 'Small (< 5 pts)');
  summarize(bets.filter(b => b.spreadSize >= 5 && b.spreadSize < 10), 'Medium (5-10 pts)');
  summarize(bets.filter(b => b.spreadSize >= 10 && b.spreadSize < 15), 'Large (10-15 pts)');
  summarize(bets.filter(b => b.spreadSize >= 15), 'Huge (15+ pts)');

  // 5. By Month
  console.log('\n=== 5. BY MONTH ===\n');
  const months = ['11', '12', '01', '02', '03'];
  for (const m of months) {
    const monthBets = bets.filter(b => b.month.endsWith('-' + m));
    if (monthBets.length > 0) {
      const monthName = {
        '11': 'November',
        '12': 'December',
        '01': 'January',
        '02': 'February',
        '03': 'March',
      }[m] || m;
      summarize(monthBets, monthName);
    }
  }

  // 6. By Edge Size
  console.log('\n=== 6. BY EDGE SIZE ===\n');
  summarize(bets.filter(b => b.edge >= 2.5 && b.edge < 3), '2.5-3 pts');
  summarize(bets.filter(b => b.edge >= 3 && b.edge < 3.5), '3-3.5 pts');
  summarize(bets.filter(b => b.edge >= 3.5 && b.edge < 4), '3.5-4 pts');
  summarize(bets.filter(b => b.edge >= 4 && b.edge < 5), '4-5 pts');

  // 7. Drawdown Analysis
  console.log('\n=== 7. DRAWDOWN & RISK ANALYSIS ===\n');

  let maxDrawdown = 0;
  let peak = 0;
  let currentDrawdown = 0;
  let maxLosingStreak = 0;
  let currentLosingStreak = 0;
  let maxWinningStreak = 0;
  let currentWinningStreak = 0;

  for (const bet of bets) {
    // Drawdown
    if (bet.cumProfit > peak) {
      peak = bet.cumProfit;
    }
    currentDrawdown = peak - bet.cumProfit;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    // Streaks
    if (bet.won) {
      currentWinningStreak++;
      currentLosingStreak = 0;
      if (currentWinningStreak > maxWinningStreak) maxWinningStreak = currentWinningStreak;
    } else {
      currentLosingStreak++;
      currentWinningStreak = 0;
      if (currentLosingStreak > maxLosingStreak) maxLosingStreak = currentLosingStreak;
    }
  }

  const finalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
  const stdDev = Math.sqrt(
    bets.reduce((sum, b) => sum + Math.pow(b.profit - (finalProfit / bets.length), 2), 0) / bets.length
  );

  console.log(`  Final Profit:       ${finalProfit > 0 ? '+' : ''}${finalProfit.toFixed(2)} units`);
  console.log(`  Max Drawdown:       ${maxDrawdown.toFixed(2)} units`);
  console.log(`  Max Losing Streak:  ${maxLosingStreak} bets`);
  console.log(`  Max Winning Streak: ${maxWinningStreak} bets`);
  console.log(`  Profit Std Dev:     ${stdDev.toFixed(3)}`);
  console.log(`  Sharpe-like Ratio:  ${((finalProfit / bets.length) / stdDev).toFixed(3)}`);

  // 8. Rolling Performance (by 100 bets)
  console.log('\n=== 8. ROLLING PERFORMANCE (per 100 bets) ===\n');

  for (let i = 0; i < bets.length; i += 100) {
    const chunk = bets.slice(i, Math.min(i + 100, bets.length));
    const wins = chunk.filter(b => b.won).length;
    const profit = chunk.reduce((sum, b) => sum + b.profit, 0);
    const roi = profit / chunk.length;
    const dateRange = `${chunk[0].date} to ${chunk[chunk.length - 1].date}`;
    console.log(
      `  Bets ${(i + 1).toString().padStart(4)}-${(i + chunk.length).toString().padStart(4)}: ` +
      `${wins}-${chunk.length - wins} (${(wins / chunk.length * 100).toFixed(0)}%) ` +
      `ROI: ${(roi * 100).toFixed(0).padStart(3)}% | ${dateRange}`
    );
  }

  // 9. Season-by-Season Consistency
  console.log('\n=== 9. SEASON CONSISTENCY ===\n');

  for (const season of [2022, 2023, 2024]) {
    const seasonBets = bets.filter(b => b.season === season);
    if (seasonBets.length > 0) {
      const wins = seasonBets.filter(b => b.won).length;
      const profit = seasonBets.reduce((sum, b) => sum + b.profit, 0);

      // Check for consistent profit throughout season
      const firstHalf = seasonBets.slice(0, Math.floor(seasonBets.length / 2));
      const secondHalf = seasonBets.slice(Math.floor(seasonBets.length / 2));

      const firstProfit = firstHalf.reduce((sum, b) => sum + b.profit, 0);
      const secondProfit = secondHalf.reduce((sum, b) => sum + b.profit, 0);

      console.log(`  ${season}: ${seasonBets.length} bets, ${(wins/seasonBets.length*100).toFixed(1)}% win, ${(profit/seasonBets.length*100).toFixed(1)}% ROI`);
      console.log(`    1st half: ${(firstProfit/firstHalf.length*100).toFixed(1)}% ROI | 2nd half: ${(secondProfit/secondHalf.length*100).toFixed(1)}% ROI`);
    }
  }

  // 10. Final Assessment
  console.log('\n' + '═'.repeat(70));
  console.log('                        FINAL ASSESSMENT');
  console.log('═'.repeat(70) + '\n');

  const overallRoi = finalProfit / bets.length;
  const homeBets = bets.filter(b => b.betSide === 'home');
  const awayBets = bets.filter(b => b.betSide === 'away');
  const homeRoi = homeBets.reduce((s, b) => s + b.profit, 0) / homeBets.length;
  const awayRoi = awayBets.reduce((s, b) => s + b.profit, 0) / awayBets.length;

  const checks = [
    { name: 'Overall ROI > 0%', pass: overallRoi > 0 },
    { name: 'Home/Away balanced (within 60/40)', pass: homeBets.length / bets.length > 0.4 && homeBets.length / bets.length < 0.6 },
    { name: 'Both Home and Away profitable', pass: homeRoi > -0.02 && awayRoi > -0.02 },
    { name: 'Max drawdown < 30 units', pass: maxDrawdown < 30 },
    { name: 'No losing streak > 15', pass: maxLosingStreak <= 15 },
    { name: '2023 profitable', pass: bets.filter(b => b.season === 2023).reduce((s, b) => s + b.profit, 0) > 0 },
    { name: '2024 profitable', pass: bets.filter(b => b.season === 2024).reduce((s, b) => s + b.profit, 0) > 0 },
  ];

  let passCount = 0;
  for (const check of checks) {
    console.log(`  ${check.pass ? '✓' : '✗'} ${check.name}`);
    if (check.pass) passCount++;
  }

  console.log(`\n  Passed: ${passCount}/${checks.length} checks`);

  if (passCount >= 6) {
    console.log('\n  ✅ READY FOR PRODUCTION');
  } else if (passCount >= 4) {
    console.log('\n  ⚠️ MARGINAL - Proceed with caution');
  } else {
    console.log('\n  ❌ NOT READY - Address failing checks');
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
