/**
 * V2b Backtest: Elo + Defensive PPA
 *
 * Testing def_ppa after off_ppa failed to improve model.
 * Defensive PPA = points allowed per play (lower = better defense)
 */

import { createClient } from '@supabase/supabase-js';
import {
  projectSpread as v1ProjectSpread,
  calculateEdge,
  didCover,
  calculateProfit,
  calculateCLV,
  brierScore,
  impliedProbability,
  DEFAULT_V1_CONFIG,
} from '../src/lib/models/v1-elo-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface V2bConfig {
  eloPointsFactor: number;
  homeFieldAdvantage: number;
  defPPAWeight: number; // Converts def_ppa diff to points
}

const DEFAULT_V2B_CONFIG: V2bConfig = {
  eloPointsFactor: 25,
  homeFieldAdvantage: 2.5,
  defPPAWeight: 10, // Weight for defensive PPA difference
};

// Project with defensive PPA
// def_ppa_diff = away_def_ppa - home_def_ppa (positive = home has better defense)
// Lower def_ppa = better defense, so we flip the sign
function projectSpreadV2b(
  homeElo: number,
  awayElo: number,
  homeDefPPA: number | null,
  awayDefPPA: number | null,
  config: V2bConfig
): { modelSpreadHome: number; defPPAComponent: number } {
  const eloComponent = (homeElo - awayElo) / config.eloPointsFactor;
  const hfaComponent = config.homeFieldAdvantage;

  // Defensive PPA: lower = better
  // If home has lower def_ppa, they're better on defense → should be favored more
  // def_ppa_advantage = away_def_ppa - home_def_ppa (positive = home better)
  const defPPADiff =
    homeDefPPA !== null && awayDefPPA !== null
      ? awayDefPPA - homeDefPPA
      : 0;
  const defPPAComponent = defPPADiff * config.defPPAWeight;

  const projectedHomeMargin = eloComponent + hfaComponent + defPPAComponent;
  return {
    modelSpreadHome: -projectedHomeMargin,
    defPPAComponent,
  };
}

interface BacktestGame {
  eventId: string;
  season: number;
  week: number;
  homeTeamName: string;
  awayTeamName: string;
  homeElo: number;
  awayElo: number;
  homeDefPPA: number | null;
  awayDefPPA: number | null;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeMargin: number;
}

interface BetResult {
  modelSpreadHome: number;
  marketSpreadHome: number;
  edge: number;
  side: 'home' | 'away';
  covered: boolean | null;
  profit: number;
  brierScore: number;
}

async function loadData(): Promise<BacktestGame[]> {
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

  // Load PPA
  const ppaMap = new Map<string, { offPPA: number; defPPA: number }>();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('team_stats_snapshots').select('team_id, season, week, off_ppa, def_ppa').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) ppaMap.set(`${s.team_id}-${s.season}-${s.week}`, { offPPA: s.off_ppa, defPPA: s.def_ppa });
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
    let homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`) || eloMap.get(`${homeTeamId}-${season}-0`);
    let awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`) || eloMap.get(`${awayTeamId}-${season}-0`);
    if (!homeElo || !awayElo) continue;

    const ppaWeek = Math.max(1, week - 1);
    const homePPA = ppaMap.get(`${homeTeamId}-${season}-${ppaWeek}`);
    const awayPPA = ppaMap.get(`${awayTeamId}-${season}-${ppaWeek}`);

    games.push({
      eventId: event.id,
      season,
      week,
      homeTeamName: (event.home_team as any)?.name || 'Unknown',
      awayTeamName: (event.away_team as any)?.name || 'Unknown',
      homeElo,
      awayElo,
      homeDefPPA: homePPA?.defPPA ?? null,
      awayDefPPA: awayPPA?.defPPA ?? null,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeMargin: result.homeScore - result.awayScore,
    });
  }

  console.log(`Loaded ${games.length} test games (2024)`);
  return games;
}

function runBacktest(games: BacktestGame[], useDefPPA: boolean, config: V2bConfig): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    let modelSpreadHome: number;

    if (useDefPPA) {
      const proj = projectSpreadV2b(game.homeElo, game.awayElo, game.homeDefPPA, game.awayDefPPA, config);
      modelSpreadHome = proj.modelSpreadHome;
    } else {
      const proj = v1ProjectSpread(game.homeElo, game.awayElo);
      modelSpreadHome = proj.modelSpreadHome;
    }

    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);
    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);
    const profit = calculateProfit(covered, priceAmerican);
    const impliedProb = impliedProbability(priceAmerican);
    const brier = covered !== null ? brierScore(impliedProb, covered) : 0;

    results.push({ modelSpreadHome, marketSpreadHome: game.marketSpreadHome, edge, side, covered, profit, brierScore: brier });
  }

  return results;
}

function calcMetrics(results: BetResult[]) {
  const wins = results.filter(r => r.covered === true).length;
  const losses = results.filter(r => r.covered === false).length;
  const totalProfit = results.reduce((s, r) => s + r.profit, 0);
  const roi = wins + losses > 0 ? (totalProfit / ((wins + losses) * 100)) * 100 : 0;
  const avgBrier = results.filter(r => r.covered !== null).reduce((s, r) => s + r.brierScore, 0) / results.filter(r => r.covered !== null).length;

  // Edge buckets
  const buckets = [
    { min: 0, max: 1, label: '0-1' },
    { min: 1, max: 2, label: '1-2' },
    { min: 2, max: 3, label: '2-3' },
    { min: 3, max: Infinity, label: '3+' },
  ];

  const bucketROIs = buckets.map(b => {
    const br = results.filter(r => Math.abs(r.edge) >= b.min && Math.abs(r.edge) < b.max);
    const bw = br.filter(r => r.covered === true).length;
    const bl = br.filter(r => r.covered === false).length;
    const bp = br.reduce((s, r) => s + r.profit, 0);
    return { label: b.label, n: br.length, roi: bw + bl > 0 ? (bp / ((bw + bl) * 100)) * 100 : 0 };
  });

  // Check monotonicity
  let mono = true;
  for (let i = 1; i < bucketROIs.length; i++) {
    if (bucketROIs[i].roi < bucketROIs[i - 1].roi) mono = false;
  }

  return { bets: results.length, wins, losses, winRate: wins / (wins + losses), roi, avgBrier, bucketROIs, monotonic: mono };
}

async function main() {
  console.log('=== V2b: Testing Defensive PPA ===\n');

  const games = await loadData();
  const ppaCount = games.filter(g => g.homeDefPPA !== null && g.awayDefPPA !== null).length;
  console.log(`Games with def_ppa: ${ppaCount}/${games.length}\n`);

  // V1 baseline
  const v1Results = runBacktest(games, false, DEFAULT_V2B_CONFIG);
  const v1 = calcMetrics(v1Results);

  // V2b with def_ppa
  const v2bResults = runBacktest(games, true, DEFAULT_V2B_CONFIG);
  const v2b = calcMetrics(v2bResults);

  console.log('                          V1 (Elo)        V2b (Elo+defPPA)  Better?');
  console.log('─'.repeat(70));
  console.log(`Win Rate:                 ${(v1.winRate * 100).toFixed(1)}%            ${(v2b.winRate * 100).toFixed(1)}%             ${v2b.winRate > v1.winRate ? 'V2b' : 'V1'}`);
  console.log(`ROI:                      ${v1.roi.toFixed(2)}%           ${v2b.roi.toFixed(2)}%            ${v2b.roi > v1.roi ? 'V2b' : 'V1'}`);
  console.log(`Brier:                    ${v1.avgBrier.toFixed(4)}          ${v2b.avgBrier.toFixed(4)}           ${v2b.avgBrier < v1.avgBrier ? 'V2b' : 'V1'}`);
  console.log(`Monotonic:                ${v1.monotonic ? 'Yes' : 'No'}               ${v2b.monotonic ? 'Yes' : 'No'}                ${v2b.monotonic && !v1.monotonic ? 'V2b' : '='}`);

  console.log('\nEdge Buckets:');
  for (let i = 0; i < v1.bucketROIs.length; i++) {
    const b1 = v1.bucketROIs[i];
    const b2 = v2b.bucketROIs[i];
    console.log(`  ${b1.label}: V1=${b1.roi.toFixed(1)}% (n=${b1.n})  V2b=${b2.roi.toFixed(1)}% (n=${b2.n})`);
  }

  // Decision
  let improvements = 0;
  if (v2b.avgBrier < v1.avgBrier) improvements++;
  if (v2b.monotonic && !v1.monotonic) improvements++;
  // CLV is 0 for both since we use closing lines

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`DECISION: ${improvements >= 2 ? 'KEEP V2b' : 'KEEP V1'} (${improvements}/3 criteria improved)`);
}

main().catch(console.error);
