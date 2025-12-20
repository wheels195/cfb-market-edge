/**
 * Phase 5B: Combined Filter Test
 *
 * Test: Top 10/week excluding spreads 3-7 (keep ≤3 or ≥7 only)
 * Compare to Top 10 baseline
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
      season,
      week,
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
  weeklyReturns: number[];
}

function runBacktest(games: BacktestGame[], excludeMedium: boolean): BacktestResult {
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

    // Sort by absolute edge descending
    weekGames.sort((a, b) => b.absEdge - a.absEdge);

    // Take top 10 (LOCKED baseline)
    weekGames = weekGames.slice(0, 10);

    // Apply filter if enabled: exclude medium spreads (3-7)
    if (excludeMedium) {
      weekGames = weekGames.filter(g => {
        const absSpread = Math.abs(g.marketSpreadHome);
        return absSpread <= 3 || absSpread >= 7;
      });
    }

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

  const avgReturn = weeklyReturns.reduce((a, b) => a + b, 0) / weeklyReturns.length;
  const variance = weeklyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / weeklyReturns.length;
  const volatility = Math.sqrt(variance) * 100;

  return {
    label: excludeMedium ? 'Top 10 (excl 3-7)' : 'Top 10 (baseline)',
    bets: totalBets,
    wins,
    losses,
    winRate: totalBets > 0 ? wins / totalBets : 0,
    roi,
    maxDrawdown,
    volatility,
    weeklyReturns,
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║      COMBINED FILTER TEST: Exclude Medium Spreads (3-7)        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const games = await loadData();

  const baseline = runBacktest(games, false);
  const filtered = runBacktest(games, true);

  console.log('=== COMPARISON ===\n');
  console.log('Strategy              Bets    W-L       WinRate   ROI       MaxDD     Volatility');
  console.log('─'.repeat(85));

  for (const r of [baseline, filtered]) {
    console.log(
      `${r.label.padEnd(22)}` +
      `${r.bets.toString().padEnd(8)}` +
      `${(r.wins + '-' + r.losses).padEnd(10)}` +
      `${(r.winRate * 100).toFixed(1)}%`.padEnd(10) +
      `${r.roi.toFixed(2)}%`.padEnd(10) +
      `$${r.maxDrawdown.toFixed(0)}`.padEnd(10) +
      `${r.volatility.toFixed(1)}%`
    );
  }

  // Differences
  const roiDiff = filtered.roi - baseline.roi;
  const ddDiff = filtered.maxDrawdown - baseline.maxDrawdown;
  const volDiff = filtered.volatility - baseline.volatility;
  const betsDiff = filtered.bets - baseline.bets;

  console.log('\n=== IMPACT ===\n');
  console.log(`Bets:       ${baseline.bets} → ${filtered.bets} (${betsDiff >= 0 ? '+' : ''}${betsDiff})`);
  console.log(`ROI:        ${baseline.roi.toFixed(2)}% → ${filtered.roi.toFixed(2)}% (${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(2)})`);
  console.log(`Max DD:     $${baseline.maxDrawdown.toFixed(0)} → $${filtered.maxDrawdown.toFixed(0)} (${ddDiff >= 0 ? '+' : ''}$${ddDiff.toFixed(0)})`);
  console.log(`Volatility: ${baseline.volatility.toFixed(1)}% → ${filtered.volatility.toFixed(1)}% (${volDiff >= 0 ? '+' : ''}${volDiff.toFixed(1)})`);

  // Weekly stability comparison
  console.log('\n=== WEEKLY RETURNS ===\n');
  console.log('Week    Baseline    Filtered    Diff');
  console.log('─'.repeat(45));

  const weeks = [...new Set(games.map(g => g.week))].sort((a, b) => a - b);
  let baselineWins = 0, filteredWins = 0, ties = 0;

  for (let i = 0; i < baseline.weeklyReturns.length; i++) {
    const bRet = baseline.weeklyReturns[i] * 100;
    const fRet = filtered.weeklyReturns[i] * 100;
    const diff = fRet - bRet;
    const marker = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';

    if (diff > 0) filteredWins++;
    else if (diff < 0) baselineWins++;
    else ties++;

    console.log(
      `W${weeks[i].toString().padEnd(6)}` +
      `${bRet.toFixed(1)}%`.padEnd(12) +
      `${fRet.toFixed(1)}%`.padEnd(12) +
      `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% ${marker}`
    );
  }

  console.log('\n=== STABILITY ===\n');
  console.log(`Weeks where filtered beats baseline: ${filteredWins}/${baseline.weeklyReturns.length}`);
  console.log(`Weeks where baseline beats filtered: ${baselineWins}/${baseline.weeklyReturns.length}`);
  console.log(`Ties: ${ties}`);

  // Verdict
  console.log('\n' + '═'.repeat(60));
  console.log('VERDICT');
  console.log('═'.repeat(60));

  const improved = roiDiff > 0;
  const ddSafe = ddDiff <= 0;
  const volAcceptable = volDiff < 20; // Less than 20% volatility increase

  console.log(`\nROI improved: ${improved ? 'YES' : 'NO'} (${roiDiff >= 0 ? '+' : ''}${roiDiff.toFixed(2)}%)`);
  console.log(`Drawdown safe: ${ddSafe ? 'YES' : 'NO'} (${ddDiff >= 0 ? '+' : ''}$${ddDiff.toFixed(0)})`);
  console.log(`Volatility acceptable: ${volAcceptable ? 'YES' : 'NO'} (${volDiff >= 0 ? '+' : ''}${volDiff.toFixed(1)}%)`);

  if (improved && ddSafe) {
    console.log('\n✓ RECOMMEND: Adopt "Top 10/week excluding spreads 3-7" as new baseline');
  } else {
    console.log('\n✗ KEEP: Stay with Top 10/week baseline');
  }
}

main().catch(console.error);
