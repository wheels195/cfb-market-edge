/**
 * Phase 5: Volume Control Experiments
 *
 * Using frozen V1 Elo-only model:
 * - Rank games by absolute edge each week
 * - Backtest top 5, 10, 20 games/week vs all games
 * - Compare: ROI, drawdown, volatility
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
  homeElo: number;
  awayElo: number;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
  // Computed
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
        home_team:home_team_id(id, name), away_team:away_team_id(id, name)`)
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
    if (season !== 2024) continue; // Test set only

    const week = getWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    const eloWeek = Math.max(0, week - 1);
    const homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    const awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    // V1 frozen model
    const { modelSpreadHome } = v1ProjectSpread(homeElo, awayElo);
    const { edge, side } = calculateEdge(closing.spreadHome, modelSpreadHome);

    games.push({
      eventId: event.id,
      season,
      week,
      homeTeamId,
      awayTeamId,
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

interface VolumeResult {
  label: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalProfit: number;
  roi: number;
  maxDrawdown: number;
  volatility: number;  // Std dev of weekly returns
  weeklyReturns: number[];
}

function runVolumeBacktest(games: BacktestGame[], maxPerWeek: number | null): VolumeResult {
  // Group by week
  const byWeek = new Map<number, BacktestGame[]>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week)!.push(g);
  }

  let wins = 0, losses = 0, pushes = 0;
  let totalProfit = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const weeklyReturns: number[] = [];
  let runningBankroll = 0;

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  for (const week of weeks) {
    let weekGames = byWeek.get(week)!;

    // Sort by absolute edge descending
    weekGames.sort((a, b) => b.absEdge - a.absEdge);

    // Take top N if limited
    if (maxPerWeek !== null) {
      weekGames = weekGames.slice(0, maxPerWeek);
    }

    let weekProfit = 0;

    for (const game of weekGames) {
      const priceAmerican = game.side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
      const covered = didCover(game.homeMargin, game.marketSpreadHome, game.side);
      const profit = calculateProfit(covered, priceAmerican);

      if (covered === true) wins++;
      else if (covered === false) losses++;
      else pushes++;

      if (covered !== null) {
        totalProfit += profit;
        weekProfit += profit;
      }
    }

    // Track weekly return as % of $100 per bet
    const weekBets = weekGames.filter(g => didCover(g.homeMargin, g.marketSpreadHome, g.side) !== null).length;
    if (weekBets > 0) {
      const weekROI = weekProfit / (weekBets * 100);
      weeklyReturns.push(weekROI);
    }

    // Track drawdown
    runningBankroll = totalProfit;
    if (runningBankroll > peak) peak = runningBankroll;
    const drawdown = peak - runningBankroll;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalBets = wins + losses;
  const roi = totalBets > 0 ? (totalProfit / (totalBets * 100)) * 100 : 0;

  // Calculate volatility (std dev of weekly returns)
  const avgReturn = weeklyReturns.reduce((a, b) => a + b, 0) / weeklyReturns.length;
  const variance = weeklyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / weeklyReturns.length;
  const volatility = Math.sqrt(variance) * 100; // As percentage

  return {
    label: maxPerWeek === null ? 'All Games' : `Top ${maxPerWeek}/week`,
    totalBets,
    wins,
    losses,
    pushes,
    winRate: totalBets > 0 ? wins / totalBets : 0,
    totalProfit,
    roi,
    maxDrawdown,
    volatility,
    weeklyReturns,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         PHASE 5: VOLUME CONTROL EXPERIMENTS                    ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Testing: Top 5, 10, 20 games/week vs All games                 ║');
  console.log('║ Model: V1 Elo-only (frozen)                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const games = await loadData();

  // Show weekly game counts
  const byWeek = new Map<number, number>();
  for (const g of games) {
    byWeek.set(g.week, (byWeek.get(g.week) || 0) + 1);
  }
  console.log('\nGames per week:');
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  for (const w of weeks) {
    console.log(`  W${w}: ${byWeek.get(w)} games`);
  }

  // Run experiments
  console.log('\n=== VOLUME CONTROL RESULTS ===\n');

  const volumes = [5, 10, 20, null]; // null = all games
  const results: VolumeResult[] = [];

  for (const vol of volumes) {
    const r = runVolumeBacktest(games, vol);
    results.push(r);
  }

  // Display results
  console.log('Strategy       Bets    W-L      WinRate   ROI      MaxDD    Volatility');
  console.log('─'.repeat(75));

  for (const r of results) {
    console.log(
      `${r.label.padEnd(15)}` +
      `${r.totalBets.toString().padEnd(8)}` +
      `${(r.wins + '-' + r.losses).padEnd(9)}` +
      `${(r.winRate * 100).toFixed(1).padEnd(10)}` +
      `${r.roi.toFixed(2).padEnd(9)}` +
      `$${r.maxDrawdown.toFixed(0).padEnd(8)}` +
      `${r.volatility.toFixed(1)}%`
    );
  }

  // Weekly breakdown for each strategy
  console.log('\n=== WEEKLY PROFIT BREAKDOWN ===\n');

  console.log('Week    All        Top20      Top10      Top5');
  console.log('─'.repeat(55));

  for (let i = 0; i < results[0].weeklyReturns.length; i++) {
    const w = weeks[i];
    console.log(
      `W${w.toString().padEnd(6)}` +
      `${(results[3].weeklyReturns[i] * 100).toFixed(1).padEnd(11)}` +
      `${(results[2].weeklyReturns[i] * 100).toFixed(1).padEnd(11)}` +
      `${(results[1].weeklyReturns[i] * 100).toFixed(1).padEnd(11)}` +
      `${(results[0].weeklyReturns[i] * 100).toFixed(1)}`
    );
  }

  // Edge distribution analysis
  console.log('\n=== EDGE DISTRIBUTION ===\n');

  const allEdges = games.map(g => g.absEdge).sort((a, b) => a - b);
  const p25 = allEdges[Math.floor(allEdges.length * 0.25)];
  const p50 = allEdges[Math.floor(allEdges.length * 0.50)];
  const p75 = allEdges[Math.floor(allEdges.length * 0.75)];
  const p90 = allEdges[Math.floor(allEdges.length * 0.90)];

  console.log(`Absolute Edge Percentiles:`);
  console.log(`  25th: ${p25.toFixed(2)} pts`);
  console.log(`  50th: ${p50.toFixed(2)} pts`);
  console.log(`  75th: ${p75.toFixed(2)} pts`);
  console.log(`  90th: ${p90.toFixed(2)} pts`);

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  const baseline = results.find(r => r.label === 'All Games')!;

  for (const r of results) {
    if (r.label === 'All Games') continue;

    const roiDiff = r.roi - baseline.roi;
    const ddDiff = r.maxDrawdown - baseline.maxDrawdown;
    const volDiff = r.volatility - baseline.volatility;

    console.log(`\n${r.label}:`);
    console.log(`  ROI: ${baseline.roi.toFixed(2)}% → ${r.roi.toFixed(2)}% (${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(2)})`);
    console.log(`  Max Drawdown: $${baseline.maxDrawdown.toFixed(0)} → $${r.maxDrawdown.toFixed(0)} (${ddDiff >= 0 ? '+' : ''}$${ddDiff.toFixed(0)})`);
    console.log(`  Volatility: ${baseline.volatility.toFixed(1)}% → ${r.volatility.toFixed(1)}% (${volDiff >= 0 ? '+' : ''}${volDiff.toFixed(1)})`);
  }
}

main().catch(console.error);
