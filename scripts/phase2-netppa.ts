/**
 * Phase 2: Net PPA Test
 *
 * Acceptance Criteria:
 * 1. Test-set Brier improves vs V1
 * 2. Improvement is stable across sub-periods (early vs late season)
 *
 * Net PPA = off_ppa - def_ppa (higher = better team)
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
  homeTeamId: string;
  awayTeamId: string;
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

// V2 projection: Elo + Net PPA
function projectSpreadV2(
  homeElo: number,
  awayElo: number,
  homeNetPPA: number | null,
  awayNetPPA: number | null,
  netPPAWeight: number
): number {
  // Base Elo projection (same as V1)
  const eloComponent = (homeElo - awayElo) / 25;
  const hfaComponent = 2.5;

  // Net PPA component (only if both teams have data)
  let netPPAComponent = 0;
  if (homeNetPPA !== null && awayNetPPA !== null) {
    const netPPADiff = homeNetPPA - awayNetPPA;
    netPPAComponent = netPPADiff * netPPAWeight;
  }

  const projectedHomeMargin = eloComponent + hfaComponent + netPPAComponent;
  return -projectedHomeMargin; // Convert to spread format
}

async function loadData(): Promise<{ train: BacktestGame[]; test: BacktestGame[] }> {
  console.log('Loading data...');

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

  // Load PPA (for Net PPA calculation)
  const ppaMap = new Map<string, { offPPA: number; defPPA: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_stats_snapshots').select('team_id, season, week, off_ppa, def_ppa').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) {
      if (s.off_ppa !== null && s.def_ppa !== null) {
        ppaMap.set(`${s.team_id}-${s.season}-${s.week}`, { offPPA: s.off_ppa, defPPA: s.def_ppa });
      }
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  PPA records: ${ppaMap.size}`);

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

  const train: BacktestGame[] = [];
  const test: BacktestGame[] = [];

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    if (season < 2022 || season > 2024) continue;

    const week = getWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;

    const result = resultMap.get(event.id);
    const closing = closingMap.get(event.id);
    if (!result || !closing) continue;

    // Get Elo (required)
    const eloWeek = Math.max(0, week - 1);
    const homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    const awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    // Get PPA (optional - will be null if not available)
    const ppaWeek = Math.max(1, week - 1);
    const homePPA = ppaMap.get(`${homeTeamId}-${season}-${ppaWeek}`);
    const awayPPA = ppaMap.get(`${awayTeamId}-${season}-${ppaWeek}`);

    // Calculate Net PPA
    const homeNetPPA = homePPA ? homePPA.offPPA - homePPA.defPPA : null;
    const awayNetPPA = awayPPA ? awayPPA.offPPA - awayPPA.defPPA : null;

    const game: BacktestGame = {
      eventId: event.id,
      season,
      week,
      homeTeamId,
      awayTeamId,
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
    };

    if (season <= 2023) train.push(game);
    else if (season === 2024) test.push(game);
  }

  // Count PPA coverage
  const trainWithPPA = train.filter(g => g.homeNetPPA !== null && g.awayNetPPA !== null).length;
  const testWithPPA = test.filter(g => g.homeNetPPA !== null && g.awayNetPPA !== null).length;

  console.log(`  Train: ${train.length} games (${trainWithPPA} with PPA, ${(trainWithPPA/train.length*100).toFixed(1)}%)`);
  console.log(`  Test: ${test.length} games (${testWithPPA} with PPA, ${(testWithPPA/test.length*100).toFixed(1)}%)`);

  return { train, test };
}

interface BacktestResult {
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  avgBrier: number;
}

function runBacktest(games: BacktestGame[], netPPAWeight: number): BacktestResult {
  let wins = 0, losses = 0, totalProfit = 0, brierSum = 0, brierCount = 0;

  for (const game of games) {
    // Project spread
    const modelSpreadHome = netPPAWeight === 0
      ? v1ProjectSpread(game.homeElo, game.awayElo).modelSpreadHome
      : projectSpreadV2(game.homeElo, game.awayElo, game.homeNetPPA, game.awayNetPPA, netPPAWeight);

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
  }

  return {
    bets: wins + losses,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    roi: wins + losses > 0 ? (totalProfit / ((wins + losses) * 100)) * 100 : 0,
    avgBrier: brierCount > 0 ? brierSum / brierCount : 0,
  };
}

function runSubPeriodBacktest(games: BacktestGame[], netPPAWeight: number): { early: BacktestResult; late: BacktestResult } {
  const early = games.filter(g => g.week <= 8);
  const late = games.filter(g => g.week > 8);

  return {
    early: runBacktest(early, netPPAWeight),
    late: runBacktest(late, netPPAWeight),
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              PHASE 2: NET PPA TEST                             ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Acceptance: Brier improves + stable across sub-periods         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const { train, test } = await loadData();

  // Coarse weight grid
  const weights = [0, 3, 5, 7, 10];

  // Find best weight on train set
  console.log('\n=== TRAIN SET: Weight Search ===');
  console.log('Weight    Bets    WinRate    ROI       Brier');
  console.log('─'.repeat(55));

  let bestWeight = 0;
  let bestTrainBrier = Infinity;

  for (const w of weights) {
    const r = runBacktest(train, w);
    const label = w === 0 ? 'V1' : `V2(${w})`;
    console.log(
      `${label.padEnd(10)}${r.bets.toString().padEnd(8)}${(r.winRate * 100).toFixed(1).padEnd(11)}` +
      `${r.roi.toFixed(2).padEnd(10)}${r.avgBrier.toFixed(4)}`
    );

    if (w > 0 && r.avgBrier < bestTrainBrier) {
      bestTrainBrier = r.avgBrier;
      bestWeight = w;
    }
  }

  console.log(`\nBest train weight: ${bestWeight}`);

  // Evaluate on test set
  console.log('\n=== TEST SET: V1 vs V2 ===');

  const v1Test = runBacktest(test, 0);
  const v2Test = runBacktest(test, bestWeight);

  console.log('\n         Bets    WinRate    ROI       Brier');
  console.log('─'.repeat(55));
  console.log(`V1       ${v1Test.bets.toString().padEnd(8)}${(v1Test.winRate * 100).toFixed(1).padEnd(11)}${v1Test.roi.toFixed(2).padEnd(10)}${v1Test.avgBrier.toFixed(4)}`);
  console.log(`V2(${bestWeight})    ${v2Test.bets.toString().padEnd(8)}${(v2Test.winRate * 100).toFixed(1).padEnd(11)}${v2Test.roi.toFixed(2).padEnd(10)}${v2Test.avgBrier.toFixed(4)}`);

  const brierImproved = v2Test.avgBrier < v1Test.avgBrier;
  console.log(`\nBrier: ${v1Test.avgBrier.toFixed(4)} → ${v2Test.avgBrier.toFixed(4)} (${brierImproved ? 'IMPROVED' : 'WORSE'})`);

  // Sub-period stability
  console.log('\n=== SUB-PERIOD STABILITY (Test Set) ===');

  const v1SubPeriod = runSubPeriodBacktest(test, 0);
  const v2SubPeriod = runSubPeriodBacktest(test, bestWeight);

  console.log('\nEarly Season (W1-8):');
  console.log(`  V1: Brier=${v1SubPeriod.early.avgBrier.toFixed(4)} (${v1SubPeriod.early.bets} bets)`);
  console.log(`  V2: Brier=${v2SubPeriod.early.avgBrier.toFixed(4)} (${v2SubPeriod.early.bets} bets)`);
  const earlyImproved = v2SubPeriod.early.avgBrier < v1SubPeriod.early.avgBrier;
  console.log(`  ${earlyImproved ? '✓ IMPROVED' : '✗ WORSE'}`);

  console.log('\nLate Season (W9+):');
  console.log(`  V1: Brier=${v1SubPeriod.late.avgBrier.toFixed(4)} (${v1SubPeriod.late.bets} bets)`);
  console.log(`  V2: Brier=${v2SubPeriod.late.avgBrier.toFixed(4)} (${v2SubPeriod.late.bets} bets)`);
  const lateImproved = v2SubPeriod.late.avgBrier < v1SubPeriod.late.avgBrier;
  console.log(`  ${lateImproved ? '✓ IMPROVED' : '✗ WORSE'}`);

  // Final decision
  console.log('\n' + '═'.repeat(60));
  console.log('DECISION');
  console.log('═'.repeat(60));

  const stable = earlyImproved === lateImproved; // Both improved or both worse = stable
  const accept = brierImproved && stable && earlyImproved && lateImproved;

  console.log(`\nBrier improved: ${brierImproved ? 'YES' : 'NO'}`);
  console.log(`Sub-period stable: ${stable ? 'YES' : 'NO'} (Early: ${earlyImproved ? '+' : '-'}, Late: ${lateImproved ? '+' : '-'})`);
  console.log(`\n${accept ? '✓ KEEP Net PPA (weight=' + bestWeight + ')' : '✗ REJECT Net PPA - Keep V1'}`);
}

main().catch(console.error);
