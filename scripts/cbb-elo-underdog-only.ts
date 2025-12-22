/**
 * CBB Elo - Pure Underdog Strategy
 *
 * Only bet underdogs when model says market is overvaluing the favorite.
 * Test various filters to find optimal configuration.
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

interface BetDetail {
  date: string;
  season: number;
  month: string;
  spreadSize: number;
  edge: number;
  won: boolean;
  profit: number;
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

interface Config {
  minGames: number;
  minEdge: number;
  maxEdge: number;
  minSpread: number; // minimum absolute spread size
  underdogOnly: boolean;
  excludeDecember: boolean;
}

function runBacktest(games: Game[], config: Config): BetDetail[] {
  const elo = new CbbEloSystem();
  const results: BetDetail[] = [];
  let currentSeason = 0;

  for (const game of games) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) elo.resetSeason();
      currentSeason = game.season;
    }

    if (game.spread_t60 !== null) {
      const homeGames = elo.getSeasonGames(game.home_team_id);
      const awayGames = elo.getSeasonGames(game.away_team_id);

      if (homeGames >= config.minGames && awayGames >= config.minGames) {
        const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_t60;
        const edge = marketSpread - modelSpread;
        const absEdge = Math.abs(edge);
        const spreadSize = Math.abs(marketSpread);

        // Determine bet side and if betting underdog
        // marketSpread < 0 means home is favorite
        // marketSpread > 0 means away is favorite (home is underdog)
        const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
        const bettingUnderdog = (betSide === 'home' && marketSpread > 0) ||
                                 (betSide === 'away' && marketSpread < 0);

        // Apply filters
        if (absEdge < config.minEdge || absEdge > config.maxEdge) continue;
        if (spreadSize < config.minSpread) continue;
        if (config.underdogOnly && !bettingUnderdog) continue;

        // Exclude December if configured
        const month = game.start_date.substring(5, 7);
        if (config.excludeDecember && month === '12') continue;

        const actualMargin = game.home_score - game.away_score;

        let won: boolean;
        if (betSide === 'home') won = actualMargin > -marketSpread;
        else won = actualMargin < -marketSpread;

        if (actualMargin !== -marketSpread) {
          results.push({
            date: game.start_date.split('T')[0],
            season: game.season,
            month: game.start_date.substring(0, 7),
            spreadSize,
            edge: absEdge,
            won,
            profit: won ? 0.91 : -1.0,
          });
        }
      }
    }

    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  return results;
}

function summarize(bets: BetDetail[], label: string): { bets: number; winPct: number; roi: number } {
  if (bets.length === 0) {
    console.log(`  ${label}: No bets`);
    return { bets: 0, winPct: 0, roi: 0 };
  }
  const wins = bets.filter(b => b.won).length;
  const profit = bets.reduce((sum, b) => sum + b.profit, 0);
  const winPct = wins / bets.length;
  const roi = profit / bets.length;

  console.log(
    `  ${label.padEnd(35)} ${bets.length.toString().padStart(4)} bets | ` +
    `${wins}-${bets.length - wins} (${(winPct * 100).toFixed(1)}%) | ` +
    `ROI: ${(roi * 100).toFixed(1)}%`
  );

  return { bets: bets.length, winPct, roi };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB ELO - PURE UNDERDOG STRATEGY                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const games = await loadGames();

  // Test various configurations
  console.log('=== STRATEGY COMPARISON ===\n');

  const configs: { label: string; config: Config }[] = [
    {
      label: 'Baseline (all bets)',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 0, underdogOnly: false, excludeDecember: false }
    },
    {
      label: 'Underdogs only',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 0, underdogOnly: true, excludeDecember: false }
    },
    {
      label: 'Underdogs + spread 5+',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 5, underdogOnly: true, excludeDecember: false }
    },
    {
      label: 'Underdogs + spread 7+',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 7, underdogOnly: true, excludeDecember: false }
    },
    {
      label: 'Underdogs + spread 10+',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 10, underdogOnly: true, excludeDecember: false }
    },
    {
      label: 'Underdogs + spread 10+ + no Dec',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 10, underdogOnly: true, excludeDecember: true }
    },
    {
      label: 'Underdogs + spread 7+ + no Dec',
      config: { minGames: 5, minEdge: 2.5, maxEdge: 5, minSpread: 7, underdogOnly: true, excludeDecember: true }
    },
  ];

  const results: { label: string; bets: BetDetail[] }[] = [];

  for (const { label, config } of configs) {
    const bets = runBacktest(games, config);
    summarize(bets, label);
    results.push({ label, bets });
  }

  // Find best strategy
  const best = results
    .filter(r => r.bets.length >= 50)
    .sort((a, b) => {
      const roiA = a.bets.reduce((s, b) => s + b.profit, 0) / a.bets.length;
      const roiB = b.bets.reduce((s, b) => s + b.profit, 0) / b.bets.length;
      return roiB - roiA;
    })[0];

  console.log(`\n  Best strategy: ${best.label}`);

  // Detailed analysis of best strategy
  console.log('\n\n' + '═'.repeat(70));
  console.log(`                    BEST STRATEGY ANALYSIS`);
  console.log('═'.repeat(70) + '\n');

  const bestBets = best.bets;

  // By season
  console.log('By Season:');
  for (const season of [2022, 2023, 2024]) {
    const seasonBets = bestBets.filter(b => b.season === season);
    if (seasonBets.length > 0) {
      const wins = seasonBets.filter(b => b.won).length;
      const profit = seasonBets.reduce((s, b) => s + b.profit, 0);
      console.log(`  ${season}: ${seasonBets.length} bets, ${(wins/seasonBets.length*100).toFixed(1)}% win, ${(profit/seasonBets.length*100).toFixed(1)}% ROI`);
    }
  }

  // By month
  console.log('\nBy Month:');
  const months = ['11', '12', '01', '02', '03'];
  for (const m of months) {
    const monthBets = bestBets.filter(b => b.month.endsWith('-' + m));
    if (monthBets.length > 0) {
      const monthName = { '11': 'Nov', '12': 'Dec', '01': 'Jan', '02': 'Feb', '03': 'Mar' }[m] || m;
      const wins = monthBets.filter(b => b.won).length;
      const profit = monthBets.reduce((s, b) => s + b.profit, 0);
      console.log(`  ${monthName}: ${monthBets.length} bets, ${(wins/monthBets.length*100).toFixed(1)}% win, ${(profit/monthBets.length*100).toFixed(1)}% ROI`);
    }
  }

  // By spread size
  console.log('\nBy Spread Size:');
  const spreadBuckets = [
    { min: 0, max: 10, label: '0-10' },
    { min: 10, max: 15, label: '10-15' },
    { min: 15, max: 20, label: '15-20' },
    { min: 20, max: 100, label: '20+' },
  ];
  for (const bucket of spreadBuckets) {
    const bucketBets = bestBets.filter(b => b.spreadSize >= bucket.min && b.spreadSize < bucket.max);
    if (bucketBets.length > 0) {
      const wins = bucketBets.filter(b => b.won).length;
      const profit = bucketBets.reduce((s, b) => s + b.profit, 0);
      console.log(`  ${bucket.label} pts: ${bucketBets.length} bets, ${(wins/bucketBets.length*100).toFixed(1)}% win, ${(profit/bucketBets.length*100).toFixed(1)}% ROI`);
    }
  }

  // Risk metrics
  console.log('\nRisk Metrics:');
  let maxDrawdown = 0;
  let peak = 0;
  let cumProfit = 0;
  let maxLosingStreak = 0;
  let currentLosingStreak = 0;

  for (const bet of bestBets) {
    cumProfit += bet.profit;
    if (cumProfit > peak) peak = cumProfit;
    const dd = peak - cumProfit;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (!bet.won) {
      currentLosingStreak++;
      if (currentLosingStreak > maxLosingStreak) maxLosingStreak = currentLosingStreak;
    } else {
      currentLosingStreak = 0;
    }
  }

  const totalProfit = bestBets.reduce((s, b) => s + b.profit, 0);
  const totalWins = bestBets.filter(b => b.won).length;

  console.log(`  Total Bets: ${bestBets.length}`);
  console.log(`  Record: ${totalWins}-${bestBets.length - totalWins} (${(totalWins/bestBets.length*100).toFixed(1)}%)`);
  console.log(`  Total Profit: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} units`);
  console.log(`  ROI: ${(totalProfit/bestBets.length*100).toFixed(1)}%`);
  console.log(`  Max Drawdown: ${maxDrawdown.toFixed(2)} units`);
  console.log(`  Max Losing Streak: ${maxLosingStreak}`);
  console.log(`  Bets per Season: ~${(bestBets.length / 3).toFixed(0)}`);

  // Holdout check
  console.log('\n\nHoldout Test (Train: 2022-2023, Test: 2024):');
  const train = bestBets.filter(b => b.season !== 2024);
  const test = bestBets.filter(b => b.season === 2024);

  if (train.length > 0 && test.length > 0) {
    const trainWins = train.filter(b => b.won).length;
    const testWins = test.filter(b => b.won).length;
    const trainRoi = train.reduce((s, b) => s + b.profit, 0) / train.length;
    const testRoi = test.reduce((s, b) => s + b.profit, 0) / test.length;

    console.log(`  Train: ${train.length} bets, ${(trainWins/train.length*100).toFixed(1)}% win, ${(trainRoi*100).toFixed(1)}% ROI`);
    console.log(`  Test:  ${test.length} bets, ${(testWins/test.length*100).toFixed(1)}% win, ${(testRoi*100).toFixed(1)}% ROI`);

    if (testRoi > 0) {
      console.log('\n  ✅ PASSES HOLDOUT - Test year is profitable');
    } else {
      console.log('\n  ⚠️ FAILS HOLDOUT - Test year is not profitable');
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
