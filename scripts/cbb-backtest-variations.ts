/**
 * CBB Backtest - Test Various Criteria Combinations
 *
 * Tests different parameter combinations to find optimal volume/ROI tradeoff
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Conference tiers
const ELITE_CONFERENCES = ['Big 12', 'SEC', 'Big Ten'];
const HIGH_CONFERENCES = ['Big East', 'ACC', 'Mountain West'];
const MID_CONFERENCES = ['Atlantic 10', 'West Coast', 'American Athletic', 'Missouri Valley', 'Mid-American', 'Sun Belt', 'Pac-12'];

interface BacktestResult {
  name: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  profit: number;
}

interface GameData {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  spread_home: number;
  home_conf: string | null;
  away_conf: string | null;
  home_rating: number;
  away_rating: number;
  season: number;
}

async function loadData(): Promise<GameData[]> {
  console.log('Loading game data...');

  // Load team conferences
  const { data: teams } = await supabase.from('cbb_teams').select('id, conference');
  const teamConf = new Map<string, string>();
  for (const t of teams || []) {
    if (t.conference) teamConf.set(t.id, t.conference);
  }

  // Load completed games with betting lines
  const { data: games } = await supabase
    .from('cbb_games')
    .select(`
      id,
      season,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      cbb_betting_lines (spread_home)
    `)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .gte('season', 2022)
    .lte('season', 2025);

  console.log(`Loaded ${games?.length || 0} completed games`);

  // Load ratings by season
  const { data: ratings } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, season, elo');

  const ratingMap = new Map<string, number>();
  for (const r of ratings || []) {
    ratingMap.set(`${r.team_id}-${r.season}`, r.elo);
  }

  // Conference bonuses
  const confBonus: Record<string, number> = {
    'Big 12': 12, 'SEC': 11, 'Big Ten': 9,
    'Big East': 7, 'ACC': 5, 'Mountain West': 5,
    'Atlantic 10': 4, 'West Coast': 3, 'American Athletic': 2,
    'Missouri Valley': 1, 'Mid-American': 0, 'Sun Belt': 0, 'Pac-12': 2,
  };

  const gameData: GameData[] = [];

  for (const game of games || []) {
    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    if (!line?.spread_home) continue;

    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;

    const homeTeamRating = ratingMap.get(`${game.home_team_id}-${game.season}`) || 0;
    const awayTeamRating = ratingMap.get(`${game.away_team_id}-${game.season}`) || 0;

    const homeRating = homeTeamRating + (confBonus[homeConf || ''] || 0);
    const awayRating = awayTeamRating + (confBonus[awayConf || ''] || 0);

    gameData.push({
      game_id: game.id,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_score: game.home_score,
      away_score: game.away_score,
      spread_home: line.spread_home,
      home_conf: homeConf,
      away_conf: awayConf,
      home_rating: homeRating,
      away_rating: awayRating,
      season: game.season,
    });
  }

  console.log(`Prepared ${gameData.length} games with ratings and lines\n`);
  return gameData;
}

function runBacktest(
  games: GameData[],
  config: {
    name: string;
    minSpread: number;
    maxSpread: number;
    minEdge: number;
    maxEdge?: number;
    conferences: string[];
    favoritesOnly: boolean;
    underdogsOnly: boolean;
  }
): BacktestResult {
  const HOME_ADV = 7.4;
  let wins = 0, losses = 0, pushes = 0;

  for (const game of games) {
    // Calculate model spread
    const modelSpread = game.away_rating - game.home_rating - HOME_ADV;
    const marketSpread = game.spread_home;
    const spreadSize = Math.abs(marketSpread);

    // Check spread range
    if (spreadSize < config.minSpread || spreadSize > config.maxSpread) continue;

    // Determine favorite/underdog
    const homeFavored = marketSpread < 0;
    const homeConf = game.home_conf || '';
    const awayConf = game.away_conf || '';

    // Check conference filter
    const favoriteConf = homeFavored ? homeConf : awayConf;
    if (!config.conferences.includes(favoriteConf)) continue;

    // Calculate edge
    const edge = marketSpread - modelSpread;
    const absEdge = Math.abs(edge);

    // Check edge filter
    if (absEdge < config.minEdge) continue;
    if (config.maxEdge && absEdge > config.maxEdge) continue;

    // Determine bet side
    const betHome = edge > 0; // Model says home is undervalued
    const bettingFavorite = (betHome && homeFavored) || (!betHome && !homeFavored);

    // Apply favorite/underdog filter
    if (config.favoritesOnly && !bettingFavorite) continue;
    if (config.underdogsOnly && bettingFavorite) continue;

    // Grade bet
    const actualMargin = game.home_score - game.away_score;
    const coverMargin = betHome
      ? actualMargin + marketSpread
      : -actualMargin - marketSpread;

    if (coverMargin > 0) wins++;
    else if (coverMargin < 0) losses++;
    else pushes++;
  }

  const total = wins + losses;
  const winRate = total > 0 ? wins / total : 0;
  const profit = wins * 0.909 - losses; // -110 juice
  const roi = total > 0 ? profit / total : 0;

  return {
    name: config.name,
    bets: total,
    wins,
    losses,
    pushes,
    winRate,
    roi,
    profit,
  };
}

async function main() {
  console.log('=== CBB Backtest Variations ===\n');

  const games = await loadData();

  const allConfs = [...ELITE_CONFERENCES, ...HIGH_CONFERENCES];
  const allWithMid = [...allConfs, ...MID_CONFERENCES];

  const configs = [
    // Current production model
    { name: 'CURRENT: Elite/High Fav 7-14 Edge≥3', minSpread: 7, maxSpread: 14, minEdge: 3, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },

    // Spread variations
    { name: 'Spread 5-14 Edge≥3', minSpread: 5, maxSpread: 14, minEdge: 3, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },
    { name: 'Spread 5-18 Edge≥3', minSpread: 5, maxSpread: 18, minEdge: 3, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },
    { name: 'Spread 5-20 Edge≥3', minSpread: 5, maxSpread: 20, minEdge: 3, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },
    { name: 'Spread 3-20 Edge≥3', minSpread: 3, maxSpread: 20, minEdge: 3, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },

    // Edge variations
    { name: 'Spread 7-14 Edge≥2.5', minSpread: 7, maxSpread: 14, minEdge: 2.5, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },
    { name: 'Spread 7-14 Edge≥2', minSpread: 7, maxSpread: 14, minEdge: 2, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },
    { name: 'Spread 5-18 Edge≥2.5', minSpread: 5, maxSpread: 18, minEdge: 2.5, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },
    { name: 'Spread 5-18 Edge≥2', minSpread: 5, maxSpread: 18, minEdge: 2, conferences: allConfs, favoritesOnly: true, underdogsOnly: false },

    // Conference variations
    { name: '+Mid Tier: Spread 7-14 Edge≥3', minSpread: 7, maxSpread: 14, minEdge: 3, conferences: allWithMid, favoritesOnly: true, underdogsOnly: false },
    { name: '+Mid Tier: Spread 5-18 Edge≥2.5', minSpread: 5, maxSpread: 18, minEdge: 2.5, conferences: allWithMid, favoritesOnly: true, underdogsOnly: false },

    // Underdog strategies
    { name: 'UNDERDOGS: Spread 7-14 Edge≥3', minSpread: 7, maxSpread: 14, minEdge: 3, conferences: allConfs, favoritesOnly: false, underdogsOnly: true },
    { name: 'UNDERDOGS: Spread 10+ Edge≥3', minSpread: 10, maxSpread: 30, minEdge: 3, conferences: allConfs, favoritesOnly: false, underdogsOnly: true },
    { name: 'UNDERDOGS: Spread 10+ Edge 2.5-5', minSpread: 10, maxSpread: 30, minEdge: 2.5, maxEdge: 5, conferences: allConfs, favoritesOnly: false, underdogsOnly: true },

    // Both sides
    { name: 'BOTH SIDES: Spread 5-18 Edge≥3', minSpread: 5, maxSpread: 18, minEdge: 3, conferences: allConfs, favoritesOnly: false, underdogsOnly: false },
    { name: 'BOTH SIDES: Spread 5-18 Edge≥2.5', minSpread: 5, maxSpread: 18, minEdge: 2.5, conferences: allConfs, favoritesOnly: false, underdogsOnly: false },

    // Aggressive volume plays
    { name: 'HIGH VOLUME: Spread 3-25 Edge≥2', minSpread: 3, maxSpread: 25, minEdge: 2, conferences: allConfs, favoritesOnly: false, underdogsOnly: false },
    { name: 'HIGH VOLUME +Mid: Spread 3-25 Edge≥2', minSpread: 3, maxSpread: 25, minEdge: 2, conferences: allWithMid, favoritesOnly: false, underdogsOnly: false },
  ];

  const results: BacktestResult[] = [];

  for (const config of configs) {
    const result = runBacktest(games, config);
    results.push(result);
  }

  // Sort by ROI
  results.sort((a, b) => b.roi - a.roi);

  console.log('=== Results Sorted by ROI ===\n');
  console.log('Strategy'.padEnd(45) + 'Bets'.padStart(6) + 'Win%'.padStart(8) + 'ROI'.padStart(8) + 'Profit'.padStart(8));
  console.log('-'.repeat(75));

  for (const r of results) {
    const winPct = (r.winRate * 100).toFixed(1) + '%';
    const roiPct = (r.roi >= 0 ? '+' : '') + (r.roi * 100).toFixed(1) + '%';
    const profit = (r.profit >= 0 ? '+' : '') + r.profit.toFixed(1) + 'u';
    console.log(
      r.name.padEnd(45) +
      r.bets.toString().padStart(6) +
      winPct.padStart(8) +
      roiPct.padStart(8) +
      profit.padStart(8)
    );
  }

  // Highlight best options
  console.log('\n=== Analysis ===\n');

  const profitable = results.filter(r => r.roi > 0 && r.bets >= 100);
  if (profitable.length > 0) {
    console.log('Profitable strategies with 100+ bets:');
    for (const r of profitable.slice(0, 5)) {
      console.log(`  • ${r.name}: ${r.bets} bets, ${(r.winRate * 100).toFixed(1)}% win, ${(r.roi * 100).toFixed(1)}% ROI`);
    }
  }

  const highVolume = results.filter(r => r.bets >= 500 && r.roi > 0);
  if (highVolume.length > 0) {
    console.log('\nHigh volume (500+ bets) profitable:');
    for (const r of highVolume) {
      console.log(`  • ${r.name}: ${r.bets} bets, ${(r.winRate * 100).toFixed(1)}% win, ${(r.roi * 100).toFixed(1)}% ROI`);
    }
  }

  // Year by year for top strategies
  console.log('\n=== Year-by-Year for Top 3 ===\n');
  const top3 = results.slice(0, 3);

  for (const config of configs.filter(c => top3.some(t => t.name === c.name))) {
    console.log(`\n${config.name}:`);
    for (const season of [2022, 2023, 2024, 2025]) {
      const seasonGames = games.filter(g => g.season === season);
      const result = runBacktest(seasonGames, config);
      const winPct = result.bets > 0 ? (result.winRate * 100).toFixed(1) : '0.0';
      const roiPct = result.bets > 0 ? (result.roi * 100).toFixed(1) : '0.0';
      console.log(`  ${season}: ${result.bets} bets, ${winPct}% win, ${result.roi >= 0 ? '+' : ''}${roiPct}% ROI`);
    }
  }
}

main().catch(console.error);
