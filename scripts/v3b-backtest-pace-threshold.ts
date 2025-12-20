/**
 * V3b Backtest: Pace as Edge Threshold Modifier
 *
 * Different approach: pace affects WHEN to bet, not probability.
 * High pace games = more variance = need larger edge to bet
 * Low pace games = less variance = can bet on smaller edge
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
  homePace: number | null;
  awayPace: number | null;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
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
      if (s.plays_per_game !== null) paceMap.set(`${s.team_id}-${s.season}-${s.week}`, s.plays_per_game);
    }
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

  const getSeason = (date: string) => {
    const d = new Date(date);
    return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  };

  const getWeek = (date: string, season: number) => {
    const d = new Date(date);
    const month = d.getMonth();
    if (month === 0) return 16;
    if (month === 7) return d.getDate() < 25 ? 0 : 1;
    const sept1 = new Date(season, 8, 1).getTime();
    return Math.max(1, Math.min(16, 1 + Math.floor((d.getTime() - sept1) / (7 * 24 * 60 * 60 * 1000))));
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

    const paceWeek = Math.max(1, week - 1);
    const homePace = paceMap.get(`${homeTeamId}-${season}-${paceWeek}`) ?? null;
    const awayPace = paceMap.get(`${awayTeamId}-${season}-${paceWeek}`) ?? null;

    games.push({
      eventId: event.id, season, week, homeTeamName: (event.home_team as any)?.name || '', awayTeamName: (event.away_team as any)?.name || '',
      homeElo, awayElo, homePace, awayPace,
      marketSpreadHome: closing.spreadHome, spreadPriceHome: closing.priceHome, spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
    });
  }

  const withPace = games.filter(g => g.homePace !== null && g.awayPace !== null).length;
  console.log(`  Test games: ${games.length}, with pace: ${withPace}`);
  return games;
}

// Dynamic threshold based on pace
function getThreshold(homePace: number | null, awayPace: number | null, baseThreshold: number, paceCoef: number): number {
  if (homePace === null || awayPace === null) return baseThreshold;

  const combinedPace = homePace + awayPace;
  const avgPace = 140;
  const paceDeviation = (combinedPace - avgPace) / avgPace;

  // High pace = higher threshold (need more edge)
  // Low pace = lower threshold (can bet on less edge)
  return Math.max(0, baseThreshold * (1 + paceCoef * paceDeviation));
}

function runBacktest(games: BacktestGame[], baseThreshold: number, paceCoef: number) {
  let wins = 0, losses = 0, totalProfit = 0, brierSum = 0, brierCount = 0;
  let betsPlaced = 0;

  const buckets = [
    { min: 0, max: 1, w: 0, l: 0, p: 0 },
    { min: 1, max: 2, w: 0, l: 0, p: 0 },
    { min: 2, max: 3, w: 0, l: 0, p: 0 },
    { min: 3, max: 99, w: 0, l: 0, p: 0 },
  ];

  for (const game of games) {
    const { modelSpreadHome } = v1ProjectSpread(game.homeElo, game.awayElo);
    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);

    // Dynamic threshold based on pace
    const threshold = getThreshold(game.homePace, game.awayPace, baseThreshold, paceCoef);

    // Only bet if edge exceeds threshold
    if (Math.abs(edge) < threshold) continue;

    betsPlaced++;
    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);
    const profit = calculateProfit(covered, priceAmerican);

    if (covered === true) wins++;
    else if (covered === false) losses++;

    if (covered !== null) {
      totalProfit += profit;
      brierSum += brierScore(impliedProbability(priceAmerican), covered);
      brierCount++;
    }

    const absEdge = Math.abs(edge);
    for (const b of buckets) {
      if (absEdge >= b.min && absEdge < b.max) {
        if (covered === true) b.w++;
        else if (covered === false) b.l++;
        if (covered !== null) b.p += profit;
        break;
      }
    }
  }

  const roi = wins + losses > 0 ? (totalProfit / ((wins + losses) * 100)) * 100 : 0;
  const avgBrier = brierCount > 0 ? brierSum / brierCount : 0;

  const bucketROIs = buckets.map(b => b.w + b.l > 0 ? (b.p / ((b.w + b.l) * 100)) * 100 : 0);
  let mono = true;
  for (let i = 1; i < bucketROIs.length; i++) if (bucketROIs[i] < bucketROIs[i - 1]) mono = false;

  return { betsPlaced, wins, losses, winRate: wins / (wins + losses), roi, avgBrier, bucketROIs, mono };
}

async function main() {
  console.log('=== V3b: Pace as Edge Threshold Modifier ===\n');

  const games = await loadData();

  // Compare V1 (fixed threshold) vs V3b (pace-adjusted threshold)
  const baseThreshold = 0; // Start with no threshold
  const paceCoefs = [0, 0.3, 0.5, 0.7, 1.0];

  console.log('\nBase threshold = 0 (all bets):');
  console.log('PaceCoef  Bets    WinRate    ROI       Brier     Mono');
  console.log('─'.repeat(60));

  for (const coef of paceCoefs) {
    const r = runBacktest(games, baseThreshold, coef);
    const label = coef === 0 ? 'V1' : `V3b(${coef})`;
    console.log(
      `${label.padEnd(10)}${r.betsPlaced.toString().padEnd(8)}${(r.winRate * 100).toFixed(1).padEnd(11)}` +
      `${r.roi.toFixed(2).padEnd(10)}${r.avgBrier.toFixed(4).padEnd(10)}${r.mono ? 'Yes' : 'No'}`
    );
  }

  // Try with base threshold = 1
  console.log('\nBase threshold = 1:');
  console.log('PaceCoef  Bets    WinRate    ROI       Brier     Mono');
  console.log('─'.repeat(60));

  for (const coef of paceCoefs) {
    const r = runBacktest(games, 1, coef);
    const label = coef === 0 ? 'V1' : `V3b(${coef})`;
    console.log(
      `${label.padEnd(10)}${r.betsPlaced.toString().padEnd(8)}${(r.winRate * 100).toFixed(1).padEnd(11)}` +
      `${r.roi.toFixed(2).padEnd(10)}${r.avgBrier.toFixed(4).padEnd(10)}${r.mono ? 'Yes' : 'No'}`
    );
  }

  // Decision
  const baseline = runBacktest(games, 0, 0);
  const best = paceCoefs.slice(1).map(c => ({ c, ...runBacktest(games, 0, c) })).sort((a, b) => b.roi - a.roi)[0];

  console.log(`\n${'═'.repeat(60)}`);
  let improvements = 0;
  if (best.avgBrier < baseline.avgBrier) improvements++;
  if (best.mono && !baseline.mono) improvements++;

  console.log(`Best pace coef: ${best.c} (ROI: ${best.roi.toFixed(2)}% vs V1: ${baseline.roi.toFixed(2)}%)`);
  console.log(`DECISION: ${improvements >= 2 ? 'KEEP V3b' : 'KEEP V1'} (${improvements}/3 criteria improved)`);
}

main().catch(console.error);
