/**
 * CBB Conference Segmentation Backtest
 *
 * Tests if market efficiency varies by conference tier:
 * - Power conferences (ACC, Big 12, Big Ten, SEC, Big East)
 * - Mid-majors (A-10, MWC, WCC, etc.)
 * - Low-majors (everything else)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Conference tiers
const POWER_CONFERENCES = new Set([
  'ACC', 'Big 12', 'Big Ten', 'SEC', 'Big East'
]);

const MID_MAJOR_CONFERENCES = new Set([
  'A-10', 'American', 'MWC', 'WCC', 'MVC', 'MAC', 'C-USA', 'Sun Belt', 'WAC', 'Horizon', 'CAA', 'ASUN'
]);

// Everything else is low-major

interface TeamInfo {
  id: string;
  conference: string;
}

interface BacktestGame {
  game_id: string;
  season: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  spread_t60: number;
  home_net_rating: number;
  away_net_rating: number;
  home_conference: string;
  away_conference: string;
  game_type: 'power_vs_power' | 'power_vs_mid' | 'mid_vs_mid' | 'low_major' | 'mixed';
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

function getConferenceTier(conf: string): 'power' | 'mid' | 'low' {
  if (POWER_CONFERENCES.has(conf)) return 'power';
  if (MID_MAJOR_CONFERENCES.has(conf)) return 'mid';
  return 'low';
}

function classifyGame(homeConf: string, awayConf: string): BacktestGame['game_type'] {
  const homeTier = getConferenceTier(homeConf);
  const awayTier = getConferenceTier(awayConf);

  if (homeTier === 'power' && awayTier === 'power') return 'power_vs_power';
  if (homeTier === 'power' && awayTier === 'mid') return 'power_vs_mid';
  if (homeTier === 'mid' && awayTier === 'power') return 'power_vs_mid';
  if (homeTier === 'mid' && awayTier === 'mid') return 'mid_vs_mid';
  if (homeTier === 'low' || awayTier === 'low') return 'low_major';
  return 'mixed';
}

async function buildDataset(): Promise<BacktestGame[]> {
  console.log('\n=== Building Conference-Segmented Dataset ===\n');

  // Get all teams with conferences
  console.log('Fetching teams...');
  const teams = await fetchAllRows<any>('cbb_teams', 'id, conference');
  const teamConf = new Map<string, string>();
  for (const t of teams) {
    teamConf.set(t.id, t.conference || 'Unknown');
  }
  console.log(`Loaded ${teams.length} teams`);

  // Get betting lines with T-60 spreads
  console.log('Fetching betting lines...');
  const bettingLines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );
  console.log(`Found ${bettingLines.length} games with T-60 spreads`);

  const linesByGame = new Map<string, number>();
  for (const line of bettingLines) {
    linesByGame.set(line.game_id, line.spread_t60);
  }

  // Get games with scores
  console.log('Fetching games...');
  const gameData = await fetchAllRows<any>(
    'cbb_games',
    'id, season, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );
  console.log(`Found ${gameData.length} completed games`);

  // Get ratings
  console.log('Fetching ratings...');
  const ratings = await fetchAllRows<any>('cbb_team_ratings', 'team_id, season, net_rating');
  const ratingsMap = new Map<string, Map<number, number>>();
  for (const r of ratings) {
    if (!ratingsMap.has(r.team_id)) {
      ratingsMap.set(r.team_id, new Map());
    }
    ratingsMap.get(r.team_id)!.set(r.season, r.net_rating);
  }
  console.log(`Loaded ${ratings.length} ratings`);

  // Build dataset
  const games: BacktestGame[] = [];
  let noLine = 0, noRating = 0, noConf = 0;

  for (const game of gameData) {
    if (game.season !== 2023 && game.season !== 2024) continue;

    const line = linesByGame.get(game.id);
    if (line === undefined) {
      noLine++;
      continue;
    }

    const priorSeason = game.season - 1;
    const homeRating = ratingsMap.get(game.home_team_id)?.get(priorSeason);
    const awayRating = ratingsMap.get(game.away_team_id)?.get(priorSeason);

    if (homeRating === undefined || awayRating === undefined) {
      noRating++;
      continue;
    }

    const homeConf = teamConf.get(game.home_team_id);
    const awayConf = teamConf.get(game.away_team_id);

    if (!homeConf || !awayConf) {
      noConf++;
      continue;
    }

    games.push({
      game_id: game.id,
      season: game.season,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
      home_score: game.home_score,
      away_score: game.away_score,
      spread_t60: line,
      home_net_rating: homeRating,
      away_net_rating: awayRating,
      home_conference: homeConf,
      away_conference: awayConf,
      game_type: classifyGame(homeConf, awayConf),
    });
  }

  console.log(`\nDataset built: ${games.length} games`);
  console.log(`  Skipped - no line: ${noLine}`);
  console.log(`  Skipped - no rating: ${noRating}`);
  console.log(`  Skipped - no conference: ${noConf}`);

  return games;
}

function calculateModelSpread(homeNet: number, awayNet: number, K: number, HFA: number): number {
  return (awayNet - homeNet) / K + HFA;
}

interface BetResult {
  won: boolean;
  profit: number;
  edge: number;
}

function runBacktest(games: BacktestGame[], K: number, HFA: number, minEdge: number, maxEdge: number): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const modelSpread = calculateModelSpread(game.home_net_rating, game.away_net_rating, K, HFA);
    const edge = game.spread_t60 - modelSpread;
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

function summarize(results: BetResult[], label: string): { bets: number; winRate: number; roi: number } {
  if (results.length === 0) {
    console.log(`${label}: No bets`);
    return { bets: 0, winRate: 0, roi: -1 };
  }

  const wins = results.filter(r => r.won).length;
  const winRate = wins / results.length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const roi = totalProfit / results.length;

  console.log(`${label}: ${results.length} bets | ${wins}-${results.length - wins} | ${(winRate * 100).toFixed(1)}% | ROI: ${(roi * 100).toFixed(1)}%`);

  return { bets: results.length, winRate, roi };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       CBB CONFERENCE SEGMENTATION BACKTEST                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const allGames = await buildDataset();
  if (allGames.length === 0) {
    console.error('No games found!');
    return;
  }

  // Count games by type
  console.log('\n=== Game Distribution by Type ===\n');
  const byType = new Map<string, number>();
  for (const g of allGames) {
    byType.set(g.game_type, (byType.get(g.game_type) || 0) + 1);
  }
  for (const [type, count] of byType) {
    console.log(`${type}: ${count} games`);
  }

  // Best parameters from previous backtest
  const K = 3.5;
  const HFA = 3.0;

  console.log('\n=== BASELINE: All Games (K=3.5, HFA=3.0) ===\n');

  // Test different edge ranges
  const ranges = [
    { min: 0, max: 100, label: 'All edges' },
    { min: 2.5, max: 5.0, label: '2.5-5 pts (CFB sweet spot)' },
    { min: 3.0, max: 6.0, label: '3-6 pts' },
    { min: 5.0, max: 10.0, label: '5-10 pts' },
  ];

  for (const range of ranges) {
    const results = runBacktest(allGames, K, HFA, range.min, range.max);
    summarize(results, range.label);
  }

  console.log('\n=== BY CONFERENCE TIER (All Edges) ===\n');

  const gameTypes: BacktestGame['game_type'][] = ['power_vs_power', 'power_vs_mid', 'mid_vs_mid', 'low_major'];

  for (const type of gameTypes) {
    const typeGames = allGames.filter(g => g.game_type === type);
    if (typeGames.length < 50) {
      console.log(`${type}: Only ${typeGames.length} games (skipping)`);
      continue;
    }
    const results = runBacktest(typeGames, K, HFA, 0, 100);
    summarize(results, type);
  }

  console.log('\n=== BY CONFERENCE TIER (2.5-5 pt Edge) ===\n');

  for (const type of gameTypes) {
    const typeGames = allGames.filter(g => g.game_type === type);
    if (typeGames.length < 50) continue;
    const results = runBacktest(typeGames, K, HFA, 2.5, 5.0);
    summarize(results, type);
  }

  console.log('\n=== BY CONFERENCE TIER (5-10 pt Edge) ===\n');

  for (const type of gameTypes) {
    const typeGames = allGames.filter(g => g.game_type === type);
    if (typeGames.length < 50) continue;
    const results = runBacktest(typeGames, K, HFA, 5.0, 10.0);
    summarize(results, type);
  }

  // Test specific conferences
  console.log('\n=== TOP INDIVIDUAL CONFERENCES (All Edges) ===\n');

  const confGames = new Map<string, BacktestGame[]>();
  for (const g of allGames) {
    // Count games where at least one team is from this conference
    for (const conf of [g.home_conference, g.away_conference]) {
      if (!confGames.has(conf)) {
        confGames.set(conf, []);
      }
      confGames.get(conf)!.push(g);
    }
  }

  // Sort by game count
  const sortedConfs = [...confGames.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15);

  for (const [conf, games] of sortedConfs) {
    // Dedupe games (a game might be counted twice if both teams from same conf type)
    const uniqueGames = [...new Map(games.map(g => [g.game_id, g])).values()];
    const results = runBacktest(uniqueGames, K, HFA, 0, 100);
    const tier = getConferenceTier(conf);
    summarize(results, `${conf} (${tier})`);
  }

  console.log('\n=== YEAR-BY-YEAR BY TIER ===\n');

  for (const season of [2023, 2024]) {
    console.log(`\n--- ${season} Season ---`);
    const seasonGames = allGames.filter(g => g.season === season);

    for (const type of gameTypes) {
      const typeGames = seasonGames.filter(g => g.game_type === type);
      if (typeGames.length < 30) continue;
      const results = runBacktest(typeGames, K, HFA, 0, 100);
      summarize(results, type);
    }
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
