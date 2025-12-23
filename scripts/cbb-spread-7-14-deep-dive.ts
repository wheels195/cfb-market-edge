/**
 * Deep dive into Spread 7-14, Favorite strategy
 * Find the optimal filters and validate rigorously
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const HOME_ADV = 7.4;
const LEARNING_RATE = 0.08;
const SEASON_DECAY = 0.7;

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

function getTotalRating(teamId: string, conf: string | null): number {
  return getTeamRating(teamId) + getConfRating(conf);
}

function predictSpread(homeTeamId: string, awayTeamId: string, homeConf: string | null, awayConf: string | null): number {
  const homeRating = getTotalRating(homeTeamId, homeConf);
  const awayRating = getTotalRating(awayTeamId, awayConf);
  return awayRating - homeRating - HOME_ADV;
}

function updateRatings(homeTeamId: string, awayTeamId: string, homeConf: string | null, awayConf: string | null, homeScore: number, awayScore: number): void {
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

function getConfTier(conf: string | null): string {
  const rating = getConfRating(conf);
  if (rating >= 9) return 'elite';
  if (rating >= 5) return 'high';
  if (rating >= 0) return 'mid';
  if (rating >= -6) return 'low';
  return 'bottom';
}

interface BetRecord {
  season: number;
  gameId: string;
  homeName: string;
  awayName: string;
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
  homeConf: string | null;
  awayConf: string | null;
  homeConfTier: string;
  awayConfTier: string;
  betTeamConf: string | null;
  betTeamTier: string;
  oppTeamTier: string;
  actualMargin: number;
  covered: boolean;
  profit: number;
  weekOfSeason: number;
  isHomeTeamFavorite: boolean;
}

async function main() {
  console.log('=== CBB Spread 7-14 Favorite Deep Dive ===\n');

  const { data: teams } = await supabase.from('cbb_teams').select('id, name, conference');
  const teamConf = new Map<string, string>();
  const teamName = new Map<string, string>();
  for (const t of teams || []) {
    teamConf.set(t.id, t.conference);
    teamName.set(t.id, t.name);
  }

  const { data: allGames } = await supabase
    .from('cbb_games')
    .select(`id, season, start_date, home_team_id, away_team_id, home_score, away_score, cbb_betting_lines (spread_home)`)
    .in('season', [2022, 2023, 2024, 2025])
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  const records: BetRecord[] = [];
  let currentSeason = 0;
  let seasonStartDate: Date | null = null;

  for (const game of allGames || []) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) resetSeason();
      currentSeason = game.season;
      seasonStartDate = new Date(game.start_date);
    }

    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const marketSpread = line?.spread_home;

    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;
    const homeGames = getGamesPlayed(game.home_team_id);
    const awayGames = getGamesPlayed(game.away_team_id);

    if (marketSpread !== null && marketSpread !== undefined) {
      const modelSpread = predictSpread(game.home_team_id, game.away_team_id, homeConf, awayConf);
      const edge = marketSpread - modelSpread;
      const absEdge = Math.abs(edge);
      const spreadSize = Math.abs(marketSpread);
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
      const isUnderdog = (betSide === 'home' && marketSpread > 0) || (betSide === 'away' && marketSpread < 0);
      const isFavorite = !isUnderdog;

      const actualMargin = game.home_score - game.away_score;
      let covered: boolean;
      if (betSide === 'home') {
        covered = actualMargin + marketSpread > 0;
      } else {
        covered = -actualMargin - marketSpread > 0;
      }

      const homeConfTier = getConfTier(homeConf);
      const awayConfTier = getConfTier(awayConf);
      const betTeamConf = betSide === 'home' ? homeConf : awayConf;
      const betTeamTier = betSide === 'home' ? homeConfTier : awayConfTier;
      const oppTeamTier = betSide === 'home' ? awayConfTier : homeConfTier;

      const gameDate = new Date(game.start_date);
      const weekOfSeason = Math.floor((gameDate.getTime() - (seasonStartDate?.getTime() || 0)) / (7 * 24 * 60 * 60 * 1000));

      // Is home team the favorite? (marketSpread < 0 means home favored)
      const isHomeTeamFavorite = marketSpread < 0;

      records.push({
        season: game.season,
        gameId: game.id,
        homeName: teamName.get(game.home_team_id) || 'Unknown',
        awayName: teamName.get(game.away_team_id) || 'Unknown',
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
        homeConf,
        awayConf,
        homeConfTier,
        awayConfTier,
        betTeamConf,
        betTeamTier,
        oppTeamTier,
        actualMargin,
        covered,
        profit: covered ? 0.91 : -1.0,
        weekOfSeason,
        isHomeTeamFavorite,
      });
    }

    updateRatings(game.home_team_id, game.away_team_id, homeConf, awayConf, game.home_score, game.away_score);
  }

  // Filter to spread 7-14, favorite only
  const baseFilter = records.filter(r => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite);

  console.log(`Total records: ${records.length}`);
  console.log(`Spread 7-14, Favorite: ${baseFilter.length}\n`);

  function analyze(bets: BetRecord[]) {
    if (bets.length === 0) return null;
    const wins = bets.filter(b => b.covered).length;
    const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
    return { bets: bets.length, wins, winRate: wins / bets.length, roi: totalProfit / bets.length, profit: totalProfit };
  }

  function print(label: string, stats: ReturnType<typeof analyze>) {
    if (!stats) return;
    const roiStr = stats.roi >= 0 ? `+${(stats.roi * 100).toFixed(1)}%` : `${(stats.roi * 100).toFixed(1)}%`;
    const profitStr = stats.profit >= 0 ? `+${stats.profit.toFixed(1)}u` : `${stats.profit.toFixed(1)}u`;
    console.log(`${label}: ${stats.bets} bets, ${(stats.winRate * 100).toFixed(1)}% win, ${roiStr} ROI, ${profitStr}`);
  }

  // ============================================
  // BASELINE: Spread 7-14, Favorite
  // ============================================
  console.log('=== BASELINE: Spread 7-14, Favorite ===\n');

  print('Overall', analyze(baseFilter));

  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(baseFilter.filter(r => r.season === year)));
  }

  console.log('\nHoldout:');
  print('  Train (2022-2024)', analyze(baseFilter.filter(r => r.season <= 2024)));
  print('  Test (2025)', analyze(baseFilter.filter(r => r.season === 2025)));

  // ============================================
  // BY EDGE SIZE
  // ============================================
  console.log('\n=== BY EDGE SIZE (Spread 7-14, Favorite) ===\n');

  for (const minEdge of [0, 2, 3, 4, 5, 6, 7, 8]) {
    const filtered = baseFilter.filter(r => r.absEdge >= minEdge);
    print(`Edge ${minEdge}+`, analyze(filtered));
  }

  console.log('\nEdge ranges:');
  for (const [min, max] of [[2, 4], [3, 5], [4, 6], [5, 7], [3, 6], [4, 7], [5, 8]]) {
    const filtered = baseFilter.filter(r => r.absEdge >= min && r.absEdge < max);
    print(`Edge ${min}-${max}`, analyze(filtered));
  }

  // ============================================
  // BY SPREAD SIZE (within 7-14)
  // ============================================
  console.log('\n=== BY SPREAD SIZE (Favorite, edge 3+) ===\n');

  const edge3fav = baseFilter.filter(r => r.absEdge >= 3);

  for (const [min, max] of [[7, 9], [9, 11], [11, 14], [7, 10], [10, 14], [8, 12]]) {
    const filtered = edge3fav.filter(r => r.spreadSize >= min && r.spreadSize < max);
    print(`Spread ${min}-${max}`, analyze(filtered));
  }

  // ============================================
  // HOME VS AWAY FAVORITE
  // ============================================
  console.log('\n=== HOME VS AWAY FAVORITE (edge 3+) ===\n');

  print('Betting home favorite', analyze(edge3fav.filter(r => r.betSide === 'home' && r.isHomeTeamFavorite)));
  print('Betting away favorite', analyze(edge3fav.filter(r => r.betSide === 'away' && !r.isHomeTeamFavorite)));

  // ============================================
  // BY CONFERENCE TIER OF FAVORITE
  // ============================================
  console.log('\n=== BY FAVORITE TEAM TIER (edge 3+) ===\n');

  for (const tier of ['elite', 'high', 'mid', 'low', 'bottom']) {
    const filtered = edge3fav.filter(r => r.betTeamTier === tier);
    print(`Favorite is ${tier} tier`, analyze(filtered));
  }

  // ============================================
  // BY TIER MATCHUP
  // ============================================
  console.log('\n=== TIER MATCHUPS (edge 3+) ===\n');

  print('Elite fav vs lower', analyze(edge3fav.filter(r => r.betTeamTier === 'elite' && ['mid', 'low', 'bottom'].includes(r.oppTeamTier))));
  print('High fav vs lower', analyze(edge3fav.filter(r => r.betTeamTier === 'high' && ['mid', 'low', 'bottom'].includes(r.oppTeamTier))));
  print('Mid fav vs low/bottom', analyze(edge3fav.filter(r => r.betTeamTier === 'mid' && ['low', 'bottom'].includes(r.oppTeamTier))));
  print('Same tier matchups', analyze(edge3fav.filter(r => r.betTeamTier === r.oppTeamTier)));
  print('Cross-tier (any)', analyze(edge3fav.filter(r => r.betTeamTier !== r.oppTeamTier)));

  // ============================================
  // BY GAMES PLAYED
  // ============================================
  console.log('\n=== BY GAMES PLAYED (edge 3+) ===\n');

  const minGames = (r: BetRecord) => Math.min(r.homeGames, r.awayGames);

  for (const min of [0, 3, 5, 8, 10, 12]) {
    const filtered = edge3fav.filter(r => minGames(r) >= min);
    print(`Both teams ${min}+ games`, analyze(filtered));
  }

  // ============================================
  // BY WEEK OF SEASON
  // ============================================
  console.log('\n=== BY WEEK OF SEASON (edge 3+) ===\n');

  for (const [minW, maxW, label] of [
    [0, 4, 'Weeks 0-3 (early)'],
    [4, 8, 'Weeks 4-7'],
    [8, 12, 'Weeks 8-11'],
    [12, 16, 'Weeks 12-15'],
    [16, 25, 'Weeks 16+'],
  ] as const) {
    const filtered = edge3fav.filter(r => r.weekOfSeason >= minW && r.weekOfSeason < maxW);
    print(label as string, analyze(filtered));
  }

  // ============================================
  // OPTIMAL COMBINATION SEARCH
  // ============================================
  console.log('\n=== OPTIMAL COMBINATIONS ===\n');

  const combos = [
    { name: 'Spread 7-14, fav, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 3 },
    { name: 'Spread 7-14, fav, edge 4+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 4 },
    { name: 'Spread 7-14, fav, edge 5+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 5 },
    { name: 'Spread 7-12, fav, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 12 && r.isFavorite && r.absEdge >= 3 },
    { name: 'Spread 7-12, fav, edge 4+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 12 && r.isFavorite && r.absEdge >= 4 },
    { name: 'Spread 8-13, fav, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 8 && r.spreadSize < 13 && r.isFavorite && r.absEdge >= 3 },
    { name: 'Spread 8-13, fav, edge 4+', filter: (r: BetRecord) => r.spreadSize >= 8 && r.spreadSize < 13 && r.isFavorite && r.absEdge >= 4 },
    { name: 'Spread 7-14, fav, edge 3+, 5+ games', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 3 && minGames(r) >= 5 },
    { name: 'Spread 7-14, fav, edge 4+, 5+ games', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 4 && minGames(r) >= 5 },
    { name: 'Spread 7-14, fav, edge 3+, elite/high', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 3 && ['elite', 'high'].includes(r.betTeamTier) },
    { name: 'Spread 7-14, fav, edge 3+, cross-tier', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 3 && r.betTeamTier !== r.oppTeamTier },
    { name: 'Spread 7-14, fav, edge 4+, cross-tier', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 4 && r.betTeamTier !== r.oppTeamTier },
    { name: 'Spread 7-14, home fav, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 3 && r.betSide === 'home' },
    { name: 'Spread 7-14, away fav, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.isFavorite && r.absEdge >= 3 && r.betSide === 'away' },
  ];

  interface Result {
    name: string;
    overall: ReturnType<typeof analyze>;
    train: ReturnType<typeof analyze>;
    test: ReturnType<typeof analyze>;
  }

  const results: Result[] = [];

  for (const combo of combos) {
    const filtered = records.filter(combo.filter);
    const result = {
      name: combo.name,
      overall: analyze(filtered),
      train: analyze(filtered.filter(r => r.season <= 2024)),
      test: analyze(filtered.filter(r => r.season === 2025)),
    };
    results.push(result);
  }

  // Sort by test ROI
  results.sort((a, b) => (b.test?.roi || -999) - (a.test?.roi || -999));

  console.log('Ranked by TEST (2025) ROI:\n');
  for (const r of results) {
    if (!r.overall || !r.train || !r.test) continue;
    const trainRoi = r.train.roi >= 0 ? `+${(r.train.roi * 100).toFixed(1)}%` : `${(r.train.roi * 100).toFixed(1)}%`;
    const testRoi = r.test.roi >= 0 ? `+${(r.test.roi * 100).toFixed(1)}%` : `${(r.test.roi * 100).toFixed(1)}%`;
    console.log(`${r.name}`);
    console.log(`  Overall: ${r.overall.bets} bets, ${(r.overall.winRate * 100).toFixed(1)}% win, ${r.overall.roi >= 0 ? '+' : ''}${(r.overall.roi * 100).toFixed(1)}% ROI`);
    console.log(`  Train: ${r.train.bets} bets, ${trainRoi} | Test: ${r.test.bets} bets, ${testRoi}`);
    console.log();
  }

  // ============================================
  // BEST STRATEGY YEAR BY YEAR
  // ============================================
  console.log('\n=== BEST STRATEGY: Spread 7-14, fav, edge 4+, cross-tier ===\n');

  const best = records.filter(r =>
    r.spreadSize >= 7 && r.spreadSize < 14 &&
    r.isFavorite && r.absEdge >= 4 &&
    r.betTeamTier !== r.oppTeamTier
  );

  print('Overall', analyze(best));

  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(best.filter(r => r.season === year)));
  }

  // ============================================
  // SAMPLE WINNING AND LOSING BETS
  // ============================================
  console.log('\n=== SAMPLE BETS (Spread 7-14, fav, edge 3+) ===\n');

  const sample = edge3fav.slice(-20); // Last 20 bets

  console.log('Recent bets:');
  for (const b of sample) {
    const result = b.covered ? 'WIN' : 'LOSS';
    const betTeam = b.betSide === 'home' ? b.homeName : b.awayName;
    const spreadStr = b.marketSpread < 0 ? b.marketSpread.toFixed(1) : `+${b.marketSpread.toFixed(1)}`;
    console.log(`${result}: ${betTeam} ${spreadStr} (edge ${b.absEdge.toFixed(1)}) - ${b.awayName} @ ${b.homeName}`);
  }
}

main().catch(console.error);
