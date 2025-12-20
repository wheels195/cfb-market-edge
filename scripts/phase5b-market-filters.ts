/**
 * Phase 5B: Market-Type Filtering
 *
 * BASELINE LOCKED: Top 10 bets/week
 *
 * Test each filter independently:
 * 1. Home vs Away (home only, away only)
 * 2. Favorites vs Underdogs (fav only, dog only)
 * 3. Spread bands (≤3, 3-7, 7+)
 * 4. Conference vs non-conference
 *
 * Keep filters that: improve ROI AND don't materially increase drawdown
 */

import { createClient } from '@supabase/supabase-js';
import {
  projectSpread as v1ProjectSpread,
  calculateEdge,
  didCover,
  calculateProfit,
} from '../src/lib/models/v1-elo-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface BacktestGame {
  eventId: string;
  season: number;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeConference: string | null;
  awayConference: string | null;
  homeElo: number;
  awayElo: number;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
  modelSpreadHome: number;
  edge: number;
  absEdge: number;
  side: 'home' | 'away';
}

async function loadData(): Promise<BacktestGame[]> {
  console.log('Loading test data (2024)...');

  // Load events
  let allEvents: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('events')
      .select(`id, commence_time, home_team_id, away_team_id,
        home_team:home_team_id(id, name, conference),
        away_team:away_team_id(id, name, conference)`)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allEvents = allEvents.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Load results
  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('results').select('event_id, home_score, away_score').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Load Elo
  const eloMap = new Map<string, number>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_elo_snapshots').select('team_id, season, week, elo').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) eloMap.set(`${s.team_id}-${s.season}-${s.week}`, s.elo);
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Load closing lines
  const closingMap = new Map<string, { spreadHome: number; priceHome: number; priceAway: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('odds_ticks').select('event_id, side, spread_points_home, price_american')
      .eq('tick_type', 'close').eq('market_type', 'spread').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const existing = closingMap.get(t.event_id) || { spreadHome: 0, priceHome: -110, priceAway: -110 };
      existing.spreadHome = t.spread_points_home;
      if (t.side === 'home') existing.priceHome = t.price_american;
      else existing.priceAway = t.price_american;
      closingMap.set(t.event_id, existing);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  const getSeason = (date: string): number => {
    const d = new Date(date);
    return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  };

  const getWeek = (date: string, season: number): number => {
    const d = new Date(date);
    const month = d.getMonth();
    if (month === 0) return 16;
    if (month === 7) return d.getDate() < 25 ? 0 : 1;
    const sept1 = new Date(season, 8, 1).getTime();
    const daysSince = Math.floor((d.getTime() - sept1) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(16, 1 + Math.floor(daysSince / 7)));
  };

  const games: BacktestGame[] = [];

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    if (season !== 2024) continue;

    const week = getWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;
    const homeConference = (event.home_team as any)?.conference || null;
    const awayConference = (event.away_team as any)?.conference || null;

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    const eloWeek = Math.max(0, week - 1);
    const homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    const awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    const { modelSpreadHome } = v1ProjectSpread(homeElo, awayElo);
    const { edge, side } = calculateEdge(closing.spreadHome, modelSpreadHome);

    games.push({
      eventId: event.id,
      season,
      week,
      homeTeamId,
      awayTeamId,
      homeConference,
      awayConference,
      homeElo,
      awayElo,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
      modelSpreadHome,
      edge,
      absEdge: Math.abs(edge),
      side,
    });
  }

  console.log(`  Loaded ${games.length} games`);
  return games;
}

interface FilterResult {
  label: string;
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  maxDrawdown: number;
  profit: number;
}

type FilterFn = (game: BacktestGame) => boolean;

function runFilteredBacktest(
  games: BacktestGame[],
  filterFn: FilterFn,
  label: string
): FilterResult {
  // Group by week
  const byWeek = new Map<number, BacktestGame[]>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week)!.push(g);
  }

  let wins = 0, losses = 0;
  let totalProfit = 0;
  let peak = 0;
  let maxDrawdown = 0;

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  for (const week of weeks) {
    let weekGames = byWeek.get(week)!;

    // Sort by absolute edge descending
    weekGames.sort((a, b) => b.absEdge - a.absEdge);

    // Take top 10 (LOCKED baseline)
    weekGames = weekGames.slice(0, 10);

    // Apply filter AFTER top 10 selection
    weekGames = weekGames.filter(filterFn);

    for (const game of weekGames) {
      const priceAmerican = game.side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
      const covered = didCover(game.homeMargin, game.marketSpreadHome, game.side);
      const profit = calculateProfit(covered, priceAmerican);

      if (covered === true) wins++;
      else if (covered === false) losses++;

      if (covered !== null) {
        totalProfit += profit;
      }
    }

    // Track drawdown
    if (totalProfit > peak) peak = totalProfit;
    const drawdown = peak - totalProfit;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalBets = wins + losses;
  const roi = totalBets > 0 ? (totalProfit / (totalBets * 100)) * 100 : 0;

  return {
    label,
    bets: totalBets,
    wins,
    losses,
    winRate: totalBets > 0 ? wins / totalBets : 0,
    roi,
    maxDrawdown,
    profit: totalProfit,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         PHASE 5B: MARKET-TYPE FILTERING                        ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ BASELINE LOCKED: Top 10 bets/week                              ║');
  console.log('║ Testing filters applied AFTER top 10 selection                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const games = await loadData();

  // Baseline: Top 10/week, no filter
  const baseline = runFilteredBacktest(games, () => true, 'Top 10 (baseline)');

  console.log('=== BASELINE ===\n');
  console.log(`Top 10/week: ${baseline.bets} bets, ${(baseline.winRate * 100).toFixed(1)}% win rate, ${baseline.roi.toFixed(2)}% ROI, $${baseline.maxDrawdown.toFixed(0)} max DD\n`);

  // Define all filters
  const filters: { label: string; fn: FilterFn }[] = [
    // Home vs Away
    { label: 'Home only', fn: (g) => g.side === 'home' },
    { label: 'Away only', fn: (g) => g.side === 'away' },

    // Favorites vs Underdogs
    { label: 'Favorite only', fn: (g) => {
      // Favorite = team with negative spread (favored to win)
      // If betting home and home spread < 0, home is favorite
      // If betting away and home spread > 0, away is favorite
      if (g.side === 'home') return g.marketSpreadHome < 0;
      else return g.marketSpreadHome > 0;
    }},
    { label: 'Underdog only', fn: (g) => {
      if (g.side === 'home') return g.marketSpreadHome > 0;
      else return g.marketSpreadHome < 0;
    }},

    // Spread bands (absolute value of market spread)
    { label: 'Small spread (≤3)', fn: (g) => Math.abs(g.marketSpreadHome) <= 3 },
    { label: 'Medium spread (3-7)', fn: (g) => Math.abs(g.marketSpreadHome) > 3 && Math.abs(g.marketSpreadHome) <= 7 },
    { label: 'Large spread (7+)', fn: (g) => Math.abs(g.marketSpreadHome) > 7 },

    // Conference
    { label: 'Conference game', fn: (g) => g.homeConference !== null && g.awayConference !== null && g.homeConference === g.awayConference },
    { label: 'Non-conference', fn: (g) => g.homeConference === null || g.awayConference === null || g.homeConference !== g.awayConference },
  ];

  // Run all filters
  const results: FilterResult[] = [baseline];
  for (const filter of filters) {
    results.push(runFilteredBacktest(games, filter.fn, filter.label));
  }

  // Display results
  console.log('=== FILTER RESULTS ===\n');
  console.log('Filter               Bets    W-L       WinRate   ROI       MaxDD     vs Baseline');
  console.log('─'.repeat(85));

  for (const r of results) {
    const roiDiff = r.roi - baseline.roi;
    const ddDiff = r.maxDrawdown - baseline.maxDrawdown;
    const roiSign = roiDiff >= 0 ? '+' : '';
    const ddSign = ddDiff >= 0 ? '+' : '';

    let verdict = '';
    if (r.label !== 'Top 10 (baseline)') {
      if (roiDiff > 0 && ddDiff <= 0) verdict = '✓ KEEP';
      else if (roiDiff > 0 && ddDiff > 0 && ddDiff < 500) verdict = '? MAYBE';
      else verdict = '✗ SKIP';
    }

    console.log(
      `${r.label.padEnd(21)}` +
      `${r.bets.toString().padEnd(8)}` +
      `${(r.wins + '-' + r.losses).padEnd(10)}` +
      `${(r.winRate * 100).toFixed(1).padEnd(10)}` +
      `${r.roi.toFixed(2).padEnd(10)}` +
      `$${r.maxDrawdown.toFixed(0).padEnd(10)}` +
      `${r.label === 'Top 10 (baseline)' ? '—' : `ROI ${roiSign}${roiDiff.toFixed(2)}, DD ${ddSign}$${ddDiff.toFixed(0)} ${verdict}`}`
    );
  }

  // Summary of recommended filters
  console.log('\n' + '═'.repeat(60));
  console.log('RECOMMENDATIONS');
  console.log('═'.repeat(60));

  const keepers = results.filter(r => {
    if (r.label === 'Top 10 (baseline)') return false;
    const roiDiff = r.roi - baseline.roi;
    const ddDiff = r.maxDrawdown - baseline.maxDrawdown;
    return roiDiff > 0 && ddDiff <= 200; // Improve ROI, don't materially increase DD
  });

  if (keepers.length === 0) {
    console.log('\nNo filters meet criteria (improve ROI without materially increasing drawdown).');
    console.log('Recommendation: Keep Top 10/week baseline without additional filters.');
  } else {
    console.log('\nFilters that improve ROI without materially increasing drawdown:');
    for (const k of keepers) {
      const roiDiff = k.roi - baseline.roi;
      const ddDiff = k.maxDrawdown - baseline.maxDrawdown;
      console.log(`  ✓ ${k.label}: ROI +${roiDiff.toFixed(2)}%, DD ${ddDiff >= 0 ? '+' : ''}$${ddDiff.toFixed(0)}`);
    }
  }

  // Detailed breakdown for each category
  console.log('\n=== CATEGORY BREAKDOWN ===\n');

  const categories = [
    { name: 'Side', filters: ['Home only', 'Away only'] },
    { name: 'Fav/Dog', filters: ['Favorite only', 'Underdog only'] },
    { name: 'Spread Size', filters: ['Small spread (≤3)', 'Medium spread (3-7)', 'Large spread (7+)'] },
    { name: 'Conference', filters: ['Conference game', 'Non-conference'] },
  ];

  for (const cat of categories) {
    console.log(`${cat.name}:`);
    for (const fname of cat.filters) {
      const r = results.find(x => x.label === fname);
      if (r) {
        const roiDiff = r.roi - baseline.roi;
        console.log(`  ${fname}: ${r.bets} bets, ${r.roi.toFixed(2)}% ROI (${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(2)} vs baseline)`);
      }
    }
    console.log('');
  }
}

main().catch(console.error);
