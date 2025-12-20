/**
 * Phase 5C: Edge Cap Refinement
 *
 * PROD_BASELINE_V1: Top 10/week, exclude spreads 3-7
 *
 * Test: Cap edge contribution to reduce volatility
 * - Still rank by edge
 * - But cap max edge at X points (avoid overconfidence on massive lines)
 *
 * Acceptance bar:
 * - ROI ≥ 8.13%
 * - Drawdown ≤ $945
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
  week: number;
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

  let allEvents: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('events')
      .select(`id, commence_time, home_team_id, away_team_id`)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allEvents = allEvents.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('results').select('event_id, home_score, away_score').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
    offset += 1000;
    if (data.length < 1000) break;
  }

  const eloMap = new Map<string, number>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_elo_snapshots').select('team_id, season, week, elo').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) eloMap.set(`${s.team_id}-${s.season}-${s.week}`, s.elo);
    offset += 1000;
    if (data.length < 1000) break;
  }

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
    const homeTeamId = event.home_team_id;
    const awayTeamId = event.away_team_id;

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
      week,
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

  console.log(`  Loaded ${games.length} games\n`);
  return games;
}

interface BacktestResult {
  label: string;
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  maxDrawdown: number;
  volatility: number;
}

// Apply PROD_BASELINE_V1 filter
function applyBaselineFilter(game: BacktestGame): boolean {
  const absSpread = Math.abs(game.marketSpreadHome);
  return absSpread <= 3 || absSpread >= 7;
}

function runBacktest(games: BacktestGame[], edgeCap: number | null, topN: number): BacktestResult {
  const byWeek = new Map<number, BacktestGame[]>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week)!.push(g);
  }

  let wins = 0, losses = 0;
  let totalProfit = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const weeklyReturns: number[] = [];

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  for (const week of weeks) {
    let weekGames = byWeek.get(week)!;

    // For ranking: use capped edge if specified
    if (edgeCap !== null) {
      weekGames = weekGames.map(g => ({
        ...g,
        absEdge: Math.min(g.absEdge, edgeCap),
      }));
    }

    // Sort by absolute edge descending
    weekGames.sort((a, b) => b.absEdge - a.absEdge);

    // Take top N
    weekGames = weekGames.slice(0, topN);

    // Apply baseline filter (exclude spreads 3-7)
    weekGames = weekGames.filter(applyBaselineFilter);

    let weekProfit = 0;
    let weekBets = 0;

    for (const game of weekGames) {
      const priceAmerican = game.side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
      const covered = didCover(game.homeMargin, game.marketSpreadHome, game.side);
      const profit = calculateProfit(covered, priceAmerican);

      if (covered === true) wins++;
      else if (covered === false) losses++;

      if (covered !== null) {
        totalProfit += profit;
        weekProfit += profit;
        weekBets++;
      }
    }

    if (weekBets > 0) {
      weeklyReturns.push(weekProfit / (weekBets * 100));
    }

    if (totalProfit > peak) peak = totalProfit;
    const drawdown = peak - totalProfit;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalBets = wins + losses;
  const roi = totalBets > 0 ? (totalProfit / (totalBets * 100)) * 100 : 0;

  const avgReturn = weeklyReturns.length > 0 ? weeklyReturns.reduce((a, b) => a + b, 0) / weeklyReturns.length : 0;
  const variance = weeklyReturns.length > 0 ? weeklyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / weeklyReturns.length : 0;
  const volatility = Math.sqrt(variance) * 100;

  let label = `Top ${topN}`;
  if (edgeCap !== null) label += ` (cap ${edgeCap})`;

  return {
    label,
    bets: totalBets,
    wins,
    losses,
    winRate: totalBets > 0 ? wins / totalBets : 0,
    roi,
    maxDrawdown,
    volatility,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              PHASE 5C: EDGE CAP REFINEMENT                     ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ PROD_BASELINE_V1: Top 10/week, exclude spreads 3-7             ║');
  console.log('║ Acceptance: ROI ≥ 8.13%, Drawdown ≤ $945                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const games = await loadData();

  // Baseline (PROD_BASELINE_V1)
  const baseline = runBacktest(games, null, 10);

  // Option A: Edge caps (test a few values)
  const edgeCaps = [15, 12, 10, 8];
  const capResults = edgeCaps.map(cap => runBacktest(games, cap, 10));

  // Option B: Top 7 instead of Top 10
  const top7 = runBacktest(games, null, 7);

  console.log('=== BASELINE (PROD_BASELINE_V1) ===\n');
  console.log(`${baseline.label}: ${baseline.bets} bets, ${(baseline.winRate * 100).toFixed(1)}% WR, ${baseline.roi.toFixed(2)}% ROI, $${baseline.maxDrawdown.toFixed(0)} DD, ${baseline.volatility.toFixed(1)}% vol\n`);

  console.log('=== OPTION A: EDGE CAPS ===\n');
  console.log('Strategy           Bets    WinRate   ROI       MaxDD     Vol       vs Baseline');
  console.log('─'.repeat(85));

  for (const r of capResults) {
    const roiDiff = r.roi - baseline.roi;
    const ddDiff = r.maxDrawdown - baseline.maxDrawdown;
    const meetsBar = r.roi >= 8.13 && r.maxDrawdown <= 945;

    console.log(
      `${r.label.padEnd(19)}` +
      `${r.bets.toString().padEnd(8)}` +
      `${(r.winRate * 100).toFixed(1)}%`.padEnd(10) +
      `${r.roi.toFixed(2)}%`.padEnd(10) +
      `$${r.maxDrawdown.toFixed(0)}`.padEnd(10) +
      `${r.volatility.toFixed(1)}%`.padEnd(10) +
      `${meetsBar ? '✓' : '✗'} ROI ${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(2)}, DD ${ddDiff >= 0 ? '+' : ''}$${ddDiff.toFixed(0)}`
    );
  }

  console.log('\n=== OPTION B: TOP 7/WEEK ===\n');
  const roiDiff7 = top7.roi - baseline.roi;
  const ddDiff7 = top7.maxDrawdown - baseline.maxDrawdown;
  const meetsBar7 = top7.roi >= 8.13 && top7.maxDrawdown <= 945;

  console.log(
    `${top7.label.padEnd(19)}` +
    `${top7.bets.toString().padEnd(8)}` +
    `${(top7.winRate * 100).toFixed(1)}%`.padEnd(10) +
    `${top7.roi.toFixed(2)}%`.padEnd(10) +
    `$${top7.maxDrawdown.toFixed(0)}`.padEnd(10) +
    `${top7.volatility.toFixed(1)}%`.padEnd(10) +
    `${meetsBar7 ? '✓' : '✗'} ROI ${roiDiff7 >= 0 ? '+' : ''}${roiDiff7.toFixed(2)}, DD ${ddDiff7 >= 0 ? '+' : ''}$${ddDiff7.toFixed(0)}`
  );

  // Verdict
  console.log('\n' + '═'.repeat(60));
  console.log('VERDICT');
  console.log('═'.repeat(60));

  const allRefinements = [...capResults, top7];
  const passing = allRefinements.filter(r => r.roi >= 8.13 && r.maxDrawdown <= 945);

  if (passing.length === 0) {
    console.log('\n✗ No refinements beat the acceptance bar.');
    console.log('→ KEEP PROD_BASELINE_V1 unchanged. Proceed to Phase 5D (stake sizing).');
  } else {
    // Find best by volatility reduction
    const best = passing.reduce((a, b) => a.volatility < b.volatility ? a : b);
    const volReduction = baseline.volatility - best.volatility;

    console.log(`\n✓ ${passing.length} refinement(s) meet acceptance bar.`);
    console.log(`\nBest volatility reduction: ${best.label}`);
    console.log(`  ROI: ${best.roi.toFixed(2)}% (≥8.13% ✓)`);
    console.log(`  Max DD: $${best.maxDrawdown.toFixed(0)} (≤$945 ✓)`);
    console.log(`  Volatility: ${best.volatility.toFixed(1)}% (${volReduction >= 0 ? '-' : '+'}${Math.abs(volReduction).toFixed(1)}%)`);

    if (volReduction > 2) {
      console.log(`\n→ Consider adopting as PROD_BASELINE_V1.1 for lower volatility.`);
    } else {
      console.log(`\n→ Volatility reduction minimal. KEEP PROD_BASELINE_V1. Proceed to Phase 5D.`);
    }
  }
}

main().catch(console.error);
