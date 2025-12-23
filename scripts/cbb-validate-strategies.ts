/**
 * Validate the top strategies found in win/loss analysis
 * Check year-by-year consistency and holdout performance
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Model parameters
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
  modelSpread: number;
  marketSpread: number;
  edge: number;
  absEdge: number;
  betSide: 'home' | 'away';
  isUnderdog: boolean;
  spreadSize: number;
  homeConf: string | null;
  awayConf: string | null;
  homeConfTier: string;
  awayConfTier: string;
  covered: boolean;
  profit: number;
}

async function main() {
  console.log('=== CBB Strategy Validation ===\n');

  const { data: teams } = await supabase.from('cbb_teams').select('id, name, conference');
  const teamConf = new Map<string, string>();
  for (const t of teams || []) teamConf.set(t.id, t.conference);

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

  for (const game of allGames || []) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) resetSeason();
      currentSeason = game.season;
    }

    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const marketSpread = line?.spread_home;

    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;

    if (marketSpread !== null && marketSpread !== undefined) {
      const modelSpread = predictSpread(game.home_team_id, game.away_team_id, homeConf, awayConf);
      const edge = marketSpread - modelSpread;
      const absEdge = Math.abs(edge);
      const spreadSize = Math.abs(marketSpread);
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
      const isUnderdog = (betSide === 'home' && marketSpread > 0) || (betSide === 'away' && marketSpread < 0);

      const actualMargin = game.home_score - game.away_score;
      let covered: boolean;
      if (betSide === 'home') {
        covered = actualMargin + marketSpread > 0;
      } else {
        covered = -actualMargin - marketSpread > 0;
      }

      records.push({
        season: game.season,
        modelSpread,
        marketSpread,
        edge,
        absEdge,
        betSide,
        isUnderdog,
        spreadSize,
        homeConf,
        awayConf,
        homeConfTier: getConfTier(homeConf),
        awayConfTier: getConfTier(awayConf),
        covered,
        profit: covered ? 0.91 : -1.0,
      });
    }

    updateRatings(game.home_team_id, game.away_team_id, homeConf, awayConf, game.home_score, game.away_score);
  }

  // Analysis helper
  function analyze(bets: BetRecord[]) {
    if (bets.length === 0) return { bets: 0, wins: 0, winRate: 0, roi: 0, profit: 0 };
    const wins = bets.filter(b => b.covered).length;
    const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
    return { bets: bets.length, wins, winRate: wins / bets.length, roi: totalProfit / bets.length, profit: totalProfit };
  }

  function print(label: string, stats: ReturnType<typeof analyze>) {
    if (stats.bets === 0) return;
    const roiStr = stats.roi >= 0 ? `+${(stats.roi * 100).toFixed(1)}%` : `${(stats.roi * 100).toFixed(1)}%`;
    const profitStr = stats.profit >= 0 ? `+${stats.profit.toFixed(1)}u` : `${stats.profit.toFixed(1)}u`;
    console.log(`${label}: ${stats.bets} bets, ${(stats.winRate * 100).toFixed(1)}% win, ${roiStr} ROI, ${profitStr}`);
  }

  const betTeamTier = (r: BetRecord) => r.betSide === 'home' ? r.homeConfTier : r.awayConfTier;

  // ============================================
  // STRATEGY 1: Bet low/bottom tier, edge 5+
  // ============================================
  console.log('=== STRATEGY 1: Bet low/bottom tier team, edge 5+ ===\n');

  const strat1 = (r: BetRecord) => ['low', 'bottom'].includes(betTeamTier(r)) && r.absEdge >= 5;

  print('Overall', analyze(records.filter(strat1)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat1(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat1(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat1(r))));

  // ============================================
  // STRATEGY 2: Cross-tier, edge 5+, underdog
  // ============================================
  console.log('\n=== STRATEGY 2: Cross-tier game, edge 5+, underdog ===\n');

  const crossTier = (r: BetRecord) => r.homeConfTier !== r.awayConfTier;
  const strat2 = (r: BetRecord) => crossTier(r) && r.absEdge >= 5 && r.isUnderdog;

  print('Overall', analyze(records.filter(strat2)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat2(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat2(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat2(r))));

  // ============================================
  // STRATEGY 3: Spread 7-14, edge 3+
  // ============================================
  console.log('\n=== STRATEGY 3: Spread 7-14, edge 3+ ===\n');

  const strat3 = (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= 3;

  print('Overall', analyze(records.filter(strat3)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat3(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat3(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat3(r))));

  // Sub-analysis
  console.log('\nBreakdown by side:');
  print('  Underdog', analyze(records.filter(r => strat3(r) && r.isUnderdog)));
  print('  Favorite', analyze(records.filter(r => strat3(r) && !r.isUnderdog)));

  // ============================================
  // STRATEGY 4: Spread 7-14, edge 5+
  // ============================================
  console.log('\n=== STRATEGY 4: Spread 7-14, edge 5+ ===\n');

  const strat4 = (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= 5;

  print('Overall', analyze(records.filter(strat4)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat4(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat4(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat4(r))));

  // ============================================
  // STRATEGY 5: Bet bottom tier, edge 4+
  // ============================================
  console.log('\n=== STRATEGY 5: Bet bottom tier team, edge 4+ ===\n');

  const strat5 = (r: BetRecord) => betTeamTier(r) === 'bottom' && r.absEdge >= 4;

  print('Overall', analyze(records.filter(strat5)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat5(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat5(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat5(r))));

  // ============================================
  // STRATEGY 6: Combine best signals
  // ============================================
  console.log('\n=== STRATEGY 6: Low/bottom tier + spread 7-14 + edge 4+ ===\n');

  const strat6 = (r: BetRecord) =>
    ['low', 'bottom'].includes(betTeamTier(r)) &&
    r.spreadSize >= 7 && r.spreadSize < 14 &&
    r.absEdge >= 4;

  print('Overall', analyze(records.filter(strat6)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat6(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat6(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat6(r))));

  // ============================================
  // STRATEGY 7: Underdog + edge 5+ + spread 5-15
  // ============================================
  console.log('\n=== STRATEGY 7: Underdog + edge 5+ + spread 5-15 ===\n');

  const strat7 = (r: BetRecord) => r.isUnderdog && r.absEdge >= 5 && r.spreadSize >= 5 && r.spreadSize < 15;

  print('Overall', analyze(records.filter(strat7)));
  console.log('\nBy year:');
  for (const year of [2022, 2023, 2024, 2025]) {
    print(`  ${year}`, analyze(records.filter(r => r.season === year && strat7(r))));
  }

  console.log('\nHoldout test:');
  print('  Train (2022-2024)', analyze(records.filter(r => r.season <= 2024 && strat7(r))));
  print('  Test (2025)', analyze(records.filter(r => r.season === 2025 && strat7(r))));

  // ============================================
  // FIND OPTIMAL EDGE THRESHOLD FOR EACH STRATEGY
  // ============================================
  console.log('\n=== EDGE THRESHOLD OPTIMIZATION ===\n');

  console.log('Low/bottom tier betting by edge:');
  for (const minEdge of [3, 4, 5, 6, 7, 8]) {
    const filter = (r: BetRecord) => ['low', 'bottom'].includes(betTeamTier(r)) && r.absEdge >= minEdge;
    print(`  Edge ${minEdge}+`, analyze(records.filter(filter)));
  }

  console.log('\nSpread 7-14 by edge:');
  for (const minEdge of [2, 3, 4, 5, 6, 7]) {
    const filter = (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= minEdge;
    print(`  Edge ${minEdge}+`, analyze(records.filter(filter)));
  }

  console.log('\nCross-tier underdog by edge:');
  for (const minEdge of [3, 4, 5, 6, 7, 8]) {
    const filter = (r: BetRecord) => crossTier(r) && r.isUnderdog && r.absEdge >= minEdge;
    print(`  Edge ${minEdge}+`, analyze(records.filter(filter)));
  }
}

main().catch(console.error);
