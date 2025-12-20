/**
 * V3 Backtest: Elo + Pace (Variance Modifier)
 *
 * Pace is orthogonal to Elo - it affects variance, not mean.
 * High pace games = more possessions = more variance = harder to predict
 * Low pace games = fewer possessions = lower variance = more predictable
 *
 * Implementation:
 * - Model spread stays the same (Elo + HFA)
 * - Pace adjusts our confidence in the edge
 * - High pace → regress probability toward 50%
 * - Low pace → trust edge more
 */

import { createClient } from '@supabase/supabase-js';
import {
  projectSpread as v1ProjectSpread,
  calculateEdge,
  didCover,
  calculateProfit,
  brierScore,
  impliedProbability,
} from '../src/lib/models/v1-elo-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface BacktestGame {
  eventId: string;
  season: number;
  week: number;
  homeTeamName: string;
  awayTeamName: string;
  homeElo: number;
  awayElo: number;
  homePace: number | null; // plays per game
  awayPace: number | null;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
}

// Convert edge to implied probability of covering
// Simple logistic: P(cover) = 1 / (1 + exp(-k * edge))
function edgeToProbability(edge: number, k: number = 0.15): number {
  return 1 / (1 + Math.exp(-k * edge));
}

// Adjust probability based on pace (variance modifier)
// High combined pace → regress toward 50%
// Low combined pace → trust edge more
function adjustProbabilityForPace(
  rawProb: number,
  homePace: number | null,
  awayPace: number | null,
  paceCoef: number
): number {
  if (homePace === null || awayPace === null) {
    return rawProb; // No adjustment if pace unknown
  }

  const combinedPace = homePace + awayPace;
  const avgPace = 140; // ~70 plays per team is typical

  // Pace deviation from average
  // Positive = faster than average (more variance)
  // Negative = slower than average (less variance)
  const paceDeviation = (combinedPace - avgPace) / avgPace;

  // Regress probability toward 50% for high-pace games
  // For low-pace games, move away from 50%
  // regression_factor = 1 - paceCoef * paceDeviation
  const regressionFactor = Math.max(0.5, Math.min(1.5, 1 - paceCoef * paceDeviation));

  // Apply regression: move probability toward 50%
  // adjusted = 0.5 + (raw - 0.5) * regressionFactor
  const adjusted = 0.5 + (rawProb - 0.5) * regressionFactor;

  return Math.max(0.01, Math.min(0.99, adjusted));
}

async function loadData(): Promise<BacktestGame[]> {
  console.log('Loading data...');

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

  const paceMap = new Map<string, number>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_stats_snapshots').select('team_id, season, week, plays_per_game').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) {
      if (s.plays_per_game !== null) {
        paceMap.set(`${s.team_id}-${s.season}-${s.week}`, s.plays_per_game);
      }
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${paceMap.size} pace records`);

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

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    const eloWeek = Math.max(0, week - 1);
    let homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    let awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    // Get prior-week pace (point-in-time safe)
    const paceWeek = Math.max(1, week - 1);
    const homePace = paceMap.get(`${homeTeamId}-${season}-${paceWeek}`) ?? null;
    const awayPace = paceMap.get(`${awayTeamId}-${season}-${paceWeek}`) ?? null;

    games.push({
      eventId: event.id,
      season,
      week,
      homeTeamName: (event.home_team as any)?.name || 'Unknown',
      awayTeamName: (event.away_team as any)?.name || 'Unknown',
      homeElo,
      awayElo,
      homePace,
      awayPace,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
    });
  }

  const withPace = games.filter(g => g.homePace !== null && g.awayPace !== null).length;
  console.log(`  Test games: ${games.length}, with pace: ${withPace}`);
  return games;
}

interface BetResult {
  edge: number;
  side: 'home' | 'away';
  rawProb: number;
  adjustedProb: number;
  covered: boolean | null;
  profit: number;
  brierRaw: number;
  brierAdjusted: number;
}

function runBacktest(games: BacktestGame[], paceCoef: number): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const { modelSpreadHome } = v1ProjectSpread(game.homeElo, game.awayElo);
    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);

    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);
    const profit = calculateProfit(covered, priceAmerican);

    // Raw probability from edge
    const rawProb = edgeToProbability(Math.abs(edge));

    // Adjusted probability with pace
    const adjustedProb = adjustProbabilityForPace(rawProb, game.homePace, game.awayPace, paceCoef);

    // Brier scores (lower = better calibration)
    const brierRaw = covered !== null ? Math.pow(rawProb - (covered ? 1 : 0), 2) : 0;
    const brierAdjusted = covered !== null ? Math.pow(adjustedProb - (covered ? 1 : 0), 2) : 0;

    results.push({
      edge,
      side,
      rawProb,
      adjustedProb,
      covered,
      profit,
      brierRaw,
      brierAdjusted,
    });
  }

  return results;
}

function calcMetrics(results: BetResult[]) {
  const resolved = results.filter(r => r.covered !== null);
  const wins = resolved.filter(r => r.covered === true).length;
  const losses = resolved.filter(r => r.covered === false).length;
  const totalProfit = resolved.reduce((s, r) => s + r.profit, 0);
  const roi = resolved.length > 0 ? (totalProfit / (resolved.length * 100)) * 100 : 0;

  const avgBrierRaw = resolved.reduce((s, r) => s + r.brierRaw, 0) / resolved.length;
  const avgBrierAdj = resolved.reduce((s, r) => s + r.brierAdjusted, 0) / resolved.length;

  // Edge bucket monotonicity (based on ROI)
  const buckets = [
    { min: 0, max: 1, p: 0, n: 0 },
    { min: 1, max: 2, p: 0, n: 0 },
    { min: 2, max: 3, p: 0, n: 0 },
    { min: 3, max: 99, p: 0, n: 0 },
  ];

  for (const r of resolved) {
    const absEdge = Math.abs(r.edge);
    for (const b of buckets) {
      if (absEdge >= b.min && absEdge < b.max) {
        b.p += r.profit;
        b.n++;
        break;
      }
    }
  }

  const bucketROIs = buckets.map(b => b.n > 0 ? (b.p / (b.n * 100)) * 100 : 0);
  let mono = true;
  for (let i = 1; i < bucketROIs.length; i++) {
    if (bucketROIs[i] < bucketROIs[i - 1]) mono = false;
  }

  return { wins, losses, winRate: wins / (wins + losses), roi, avgBrierRaw, avgBrierAdj, bucketROIs, mono };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         V3 BACKTEST: Pace as Variance Modifier                 ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Pace affects probability calibration, not spread adjustment    ║');
  console.log('║ High pace → regress probability toward 50%                     ║');
  console.log('║ Low pace → trust edge more                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const games = await loadData();

  // Test different pace coefficients
  const coeffs = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0];

  console.log('\nPaceCoef  WinRate    ROI       Brier(raw) Brier(adj) Improved?  Mono');
  console.log('─'.repeat(80));

  const baseline = runBacktest(games, 0);
  const baseMetrics = calcMetrics(baseline);

  for (const coef of coeffs) {
    const results = runBacktest(games, coef);
    const m = calcMetrics(results);

    const label = coef === 0 ? 'V1' : `V3(${coef})`;
    const brierImproved = m.avgBrierAdj < baseMetrics.avgBrierRaw ? 'Yes' : 'No';

    console.log(
      `${label.padEnd(10)}${(m.winRate * 100).toFixed(1).padEnd(11)}${m.roi.toFixed(2).padEnd(10)}` +
      `${m.avgBrierRaw.toFixed(4).padEnd(11)}${m.avgBrierAdj.toFixed(4).padEnd(11)}` +
      `${brierImproved.padEnd(11)}${m.mono ? 'Yes' : 'No'}`
    );
  }

  // Find best coefficient
  let bestCoef = 0;
  let bestBrier = baseMetrics.avgBrierRaw;

  for (const coef of coeffs.slice(1)) {
    const results = runBacktest(games, coef);
    const m = calcMetrics(results);
    if (m.avgBrierAdj < bestBrier) {
      bestBrier = m.avgBrierAdj;
      bestCoef = coef;
    }
  }

  // Decision
  console.log(`\n${'═'.repeat(80)}`);

  const bestResults = runBacktest(games, bestCoef);
  const bestMetrics = calcMetrics(bestResults);

  let improvements = 0;
  if (bestMetrics.avgBrierAdj < baseMetrics.avgBrierRaw) improvements++; // Brier improved
  if (bestMetrics.mono && !baseMetrics.mono) improvements++; // Monotonicity improved
  // CLV is 0 for both (using closing lines)

  console.log(`\nBest pace coefficient: ${bestCoef}`);
  console.log(`Brier: ${baseMetrics.avgBrierRaw.toFixed(4)} → ${bestMetrics.avgBrierAdj.toFixed(4)} (${bestMetrics.avgBrierAdj < baseMetrics.avgBrierRaw ? 'IMPROVED' : 'worse'})`);
  console.log(`Monotonicity: ${baseMetrics.mono ? 'Yes' : 'No'} → ${bestMetrics.mono ? 'Yes' : 'No'}`);
  console.log(`\nDECISION: ${improvements >= 2 ? 'KEEP V3 (Pace)' : 'KEEP V1'} (${improvements}/3 criteria improved)`);
}

main().catch(console.error);
