/**
 * V2c Backtest: Elo + Net PPA (Offensive - Defensive)
 *
 * Net PPA = off_ppa - def_ppa
 * Higher net PPA = better overall efficiency
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
  homeNetPPA: number | null;
  awayNetPPA: number | null;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
}

// Project with Net PPA (off_ppa - def_ppa)
function projectSpreadV2c(
  homeElo: number,
  awayElo: number,
  homeNetPPA: number | null,
  awayNetPPA: number | null,
  netPPAWeight: number
): number {
  const eloComponent = (homeElo - awayElo) / 25;
  const hfaComponent = 2.5;

  const netPPADiff =
    homeNetPPA !== null && awayNetPPA !== null
      ? homeNetPPA - awayNetPPA
      : 0;
  const netPPAComponent = netPPADiff * netPPAWeight;

  return -(eloComponent + hfaComponent + netPPAComponent);
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

  const ppaMap = new Map<string, { offPPA: number; defPPA: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_stats_snapshots').select('team_id, season, week, off_ppa, def_ppa').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) ppaMap.set(`${s.team_id}-${s.season}-${s.week}`, { offPPA: s.off_ppa, defPPA: s.def_ppa });
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
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    const eloWeek = Math.max(0, week - 1);
    let homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    let awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    const ppaWeek = Math.max(1, week - 1);
    const homePPA = ppaMap.get(`${homeTeamId}-${season}-${ppaWeek}`);
    const awayPPA = ppaMap.get(`${awayTeamId}-${season}-${ppaWeek}`);

    // Net PPA = off_ppa - def_ppa (higher = better)
    const homeNetPPA = homePPA ? homePPA.offPPA - homePPA.defPPA : null;
    const awayNetPPA = awayPPA ? awayPPA.offPPA - awayPPA.defPPA : null;

    games.push({
      eventId: event.id,
      season,
      week,
      homeTeamName: (event.home_team as any)?.name || 'Unknown',
      awayTeamName: (event.away_team as any)?.name || 'Unknown',
      homeElo,
      awayElo,
      homeNetPPA,
      awayNetPPA,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
    });
  }

  return games;
}

function runBacktest(games: BacktestGame[], weight: number) {
  let wins = 0, losses = 0, totalProfit = 0, brierSum = 0, brierCount = 0;
  const buckets = [{ min: 0, max: 1, w: 0, l: 0, p: 0 }, { min: 1, max: 2, w: 0, l: 0, p: 0 }, { min: 2, max: 3, w: 0, l: 0, p: 0 }, { min: 3, max: 99, w: 0, l: 0, p: 0 }];

  for (const game of games) {
    const modelSpreadHome = weight === 0
      ? v1ProjectSpread(game.homeElo, game.awayElo).modelSpreadHome
      : projectSpreadV2c(game.homeElo, game.awayElo, game.homeNetPPA, game.awayNetPPA, weight);

    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);
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

  return { wins, losses, winRate: wins / (wins + losses), roi, avgBrier, bucketROIs, mono };
}

async function main() {
  console.log('=== V2c: Testing Net PPA (off - def) ===\n');

  const games = await loadData();
  const ppaCount = games.filter(g => g.homeNetPPA !== null && g.awayNetPPA !== null).length;
  console.log(`Test games: ${games.length}, with PPA: ${ppaCount}\n`);

  // Test different weights
  const weights = [0, 3, 5, 7, 10, 15];

  console.log('Weight    WinRate    ROI       Brier     Mono   Buckets (0-1, 1-2, 2-3, 3+)');
  console.log('─'.repeat(85));

  for (const w of weights) {
    const r = runBacktest(games, w);
    const label = w === 0 ? 'V1' : `V2c(${w})`;
    console.log(
      `${label.padEnd(10)}${(r.winRate * 100).toFixed(1).padEnd(11)}${r.roi.toFixed(2).padEnd(10)}${r.avgBrier.toFixed(4).padEnd(10)}${(r.mono ? 'Yes' : 'No').padEnd(7)}${r.bucketROIs.map(x => x.toFixed(1) + '%').join(', ')}`
    );
  }

  // Decision
  const v1 = runBacktest(games, 0);
  const best = weights.slice(1).map(w => ({ w, ...runBacktest(games, w) })).sort((a, b) => b.roi - a.roi)[0];

  console.log(`\n${'═'.repeat(85)}`);
  let improvements = 0;
  if (best.avgBrier < v1.avgBrier) improvements++;
  if (best.mono && !v1.mono) improvements++;

  console.log(`Best V2c weight: ${best.w} (ROI: ${best.roi.toFixed(2)}% vs V1: ${v1.roi.toFixed(2)}%)`);
  console.log(`DECISION: ${improvements >= 2 ? 'KEEP V2c' : 'KEEP V1'} (${improvements}/3 criteria improved)`);
}

main().catch(console.error);
