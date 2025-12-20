/**
 * V2 Backtest: Elo + Offensive PPA
 *
 * LOCKED GUARDRAILS (same as V1):
 * 1. Freeze dataset: Snapshot cohort at runtime, log counts
 * 2. Explicit exclusions: Hard-exclude missing Elo, log by season
 * 3. Train/Test split: Train = 2022-2023, Test = 2024. NO LEAKAGE.
 * 4. Price sanity: Assert non-null spread prices, fail loud
 * 5. Metrics: CLV, Brier, ROI with bootstrap CIs
 *
 * NEW: Compare V1 (Elo-only) vs V2 (Elo + off_ppa)
 * Keep V2 only if it improves at least 2 of:
 *   - CLV
 *   - Brier (calibration)
 *   - Edge-bucket monotonicity
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
import {
  projectSpreadV2,
  DEFAULT_V2_CONFIG,
  V2ModelConfig,
} from '../src/lib/models/v2-ppa-model';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// ============================================================================
// TYPES
// ============================================================================

interface BacktestGame {
  eventId: string;
  season: number;
  week: number;
  commenceTime: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeElo: number;
  awayElo: number;
  homeOffPPA: number | null;
  awayOffPPA: number | null;
  marketSpreadHome: number;
  spreadPriceHome: number;
  spreadPriceAway: number;
  homeScore: number;
  awayScore: number;
  homeMargin: number;
}

interface BetResult {
  eventId: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  modelSpreadHome: number;
  marketSpreadHome: number;
  edge: number;
  side: 'home' | 'away';
  priceAmerican: number;
  homeMargin: number;
  covered: boolean | null;
  profit: number;
  clv: number;
  brierScore: number;
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadBacktestData(): Promise<{
  train: BacktestGame[];
  test: BacktestGame[];
  exclusions: { season: number; reason: string; count: number }[];
}> {
  console.log('=== Loading Backtest Data ===\n');

  const exclusions: { season: number; reason: string; count: number }[] = [];

  // Load all final events with pagination
  console.log('Loading events...');
  let allEvents: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:home_team_id(id, name),
        away_team:away_team_id(id, name)
      `)
      .eq('status', 'final')
      .order('commence_time')
      .range(offset, offset + 999);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allEvents = allEvents.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${allEvents.length} final events`);

  // Load all results
  console.log('Loading results...');
  const resultMap = new Map<string, { homeScore: number; awayScore: number }>();
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('results')
      .select('event_id, home_score, away_score')
      .range(offset, offset + 999);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      resultMap.set(r.event_id, { homeScore: r.home_score, awayScore: r.away_score });
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${resultMap.size} results`);

  // Load all Elo snapshots
  console.log('Loading Elo snapshots...');
  const eloMap = new Map<string, number>();
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('team_elo_snapshots')
      .select('team_id, season, week, elo')
      .range(offset, offset + 999);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const s of data) {
      eloMap.set(`${s.team_id}-${s.season}-${s.week}`, s.elo);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${eloMap.size} Elo snapshots`);

  // Load all PPA snapshots
  console.log('Loading PPA snapshots...');
  const ppaMap = new Map<string, { offPPA: number; defPPA: number }>();
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('team_stats_snapshots')
      .select('team_id, season, week, off_ppa, def_ppa')
      .range(offset, offset + 999);

    if (error) {
      console.log(`  Note: PPA table error - ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const s of data) {
      ppaMap.set(`${s.team_id}-${s.season}-${s.week}`, {
        offPPA: s.off_ppa,
        defPPA: s.def_ppa,
      });
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${ppaMap.size} PPA snapshots`);

  // Load all closing line ticks
  console.log('Loading closing lines...');
  const closingMap = new Map<string, { spreadHome: number; priceHome: number; priceAway: number }>();
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('odds_ticks')
      .select('event_id, side, spread_points_home, price_american')
      .eq('tick_type', 'close')
      .eq('market_type', 'spread')
      .range(offset, offset + 999);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const t of data) {
      const existing = closingMap.get(t.event_id) || { spreadHome: 0, priceHome: -110, priceAway: -110 };
      existing.spreadHome = t.spread_points_home;
      if (t.side === 'home') {
        existing.priceHome = t.price_american;
      } else {
        existing.priceAway = t.price_american;
      }
      closingMap.set(t.event_id, existing);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded closing lines for ${closingMap.size} events`);

  // Build games with all data
  console.log('\nBuilding backtest cohort...');

  const getSeason = (date: string): number => {
    const d = new Date(date);
    const month = d.getMonth();
    const year = d.getFullYear();
    return month === 0 ? year - 1 : year;
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

  const missingBySeasonReason: Record<string, number> = {};
  let ppaAvailable = 0;
  let ppaMissing = 0;

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    const week = getWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;
    const homeTeamName = (event.home_team as any)?.name || 'Unknown';
    const awayTeamName = (event.away_team as any)?.name || 'Unknown';

    if (season > 2024) continue;

    const result = resultMap.get(event.id);
    if (!result) {
      const key = `${season}-missing_result`;
      missingBySeasonReason[key] = (missingBySeasonReason[key] || 0) + 1;
      continue;
    }

    const closing = closingMap.get(event.id);
    if (!closing) {
      const key = `${season}-missing_closing`;
      missingBySeasonReason[key] = (missingBySeasonReason[key] || 0) + 1;
      continue;
    }

    if (closing.priceHome === null || closing.priceAway === null) {
      throw new Error(`SANITY CHECK FAILED: Null spread price for event ${event.id}`);
    }

    const eloWeek = Math.max(0, week - 1);
    let homeElo = eloMap.get(`${homeTeamId}-${season}-${eloWeek}`);
    let awayElo = eloMap.get(`${awayTeamId}-${season}-${eloWeek}`);

    if (!homeElo) homeElo = eloMap.get(`${homeTeamId}-${season}-0`);
    if (!awayElo) awayElo = eloMap.get(`${awayTeamId}-${season}-0`);

    if (!homeElo || !awayElo) {
      const key = `${season}-missing_elo`;
      missingBySeasonReason[key] = (missingBySeasonReason[key] || 0) + 1;
      continue;
    }

    // Get PPA (use week-1, allow null for missing)
    const ppaWeek = Math.max(1, week - 1);
    const homePPA = ppaMap.get(`${homeTeamId}-${season}-${ppaWeek}`);
    const awayPPA = ppaMap.get(`${awayTeamId}-${season}-${ppaWeek}`);

    const homeOffPPA = homePPA?.offPPA ?? null;
    const awayOffPPA = awayPPA?.offPPA ?? null;

    if (homeOffPPA !== null && awayOffPPA !== null) {
      ppaAvailable++;
    } else {
      ppaMissing++;
    }

    const game: BacktestGame = {
      eventId: event.id,
      season,
      week,
      commenceTime: event.commence_time,
      homeTeamId,
      awayTeamId,
      homeTeamName,
      awayTeamName,
      homeElo,
      awayElo,
      homeOffPPA,
      awayOffPPA,
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      homeMargin: result.homeScore - result.awayScore,
    };

    if (season <= 2023) {
      train.push(game);
    } else if (season === 2024) {
      test.push(game);
    }
  }

  for (const key of Object.keys(missingBySeasonReason).sort()) {
    const [season, reason] = key.split('-');
    exclusions.push({
      season: parseInt(season),
      reason,
      count: missingBySeasonReason[key],
    });
  }

  console.log('\n=== Dataset Frozen ===');
  console.log(`Train (2022-2023): ${train.length} games`);
  console.log(`Test (2024): ${test.length} games`);
  console.log(`PPA available: ${ppaAvailable}, PPA missing: ${ppaMissing}`);

  console.log('\nExclusions by season and reason:');
  for (const ex of exclusions) {
    console.log(`  ${ex.season} - ${ex.reason}: ${ex.count}`);
  }

  return { train, test, exclusions };
}

// ============================================================================
// BACKTEST EXECUTION
// ============================================================================

function runBacktestV1(games: BacktestGame[], edgeThreshold: number = 0): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const { modelSpreadHome } = v1ProjectSpread(game.homeElo, game.awayElo);
    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);

    if (Math.abs(edge) < edgeThreshold) continue;

    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);
    const profit = calculateProfit(covered, priceAmerican);
    const clv = calculateCLV(game.marketSpreadHome, game.marketSpreadHome, side);
    const impliedProb = impliedProbability(priceAmerican);
    const brier = covered !== null ? brierScore(impliedProb, covered) : 0;

    results.push({
      eventId: game.eventId,
      season: game.season,
      homeTeam: game.homeTeamName,
      awayTeam: game.awayTeamName,
      modelSpreadHome,
      marketSpreadHome: game.marketSpreadHome,
      edge,
      side,
      priceAmerican,
      homeMargin: game.homeMargin,
      covered,
      profit,
      clv,
      brierScore: brier,
    });
  }

  return results;
}

function runBacktestV2(
  games: BacktestGame[],
  config: V2ModelConfig,
  edgeThreshold: number = 0
): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    const { modelSpreadHome } = projectSpreadV2(
      game.homeElo,
      game.awayElo,
      game.homeOffPPA,
      game.awayOffPPA,
      config
    );
    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);

    if (Math.abs(edge) < edgeThreshold) continue;

    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);
    const profit = calculateProfit(covered, priceAmerican);
    const clv = calculateCLV(game.marketSpreadHome, game.marketSpreadHome, side);
    const impliedProb = impliedProbability(priceAmerican);
    const brier = covered !== null ? brierScore(impliedProb, covered) : 0;

    results.push({
      eventId: game.eventId,
      season: game.season,
      homeTeam: game.homeTeamName,
      awayTeam: game.awayTeamName,
      modelSpreadHome,
      marketSpreadHome: game.marketSpreadHome,
      edge,
      side,
      priceAmerican,
      homeMargin: game.homeMargin,
      covered,
      profit,
      clv,
      brierScore: brier,
    });
  }

  return results;
}

// ============================================================================
// METRICS
// ============================================================================

function bootstrapCI(
  values: number[],
  statFn: (arr: number[]) => number,
  iterations: number = 1000,
  alpha: number = 0.05
): { estimate: number; lower: number; upper: number } {
  if (values.length === 0) return { estimate: 0, lower: 0, upper: 0 };

  const estimate = statFn(values);
  const bootstrapStats: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const sample: number[] = [];
    for (let j = 0; j < values.length; j++) {
      sample.push(values[Math.floor(Math.random() * values.length)]);
    }
    bootstrapStats.push(statFn(sample));
  }

  bootstrapStats.sort((a, b) => a - b);
  const lowerIdx = Math.floor((alpha / 2) * iterations);
  const upperIdx = Math.floor((1 - alpha / 2) * iterations);

  return {
    estimate,
    lower: bootstrapStats[lowerIdx],
    upper: bootstrapStats[upperIdx],
  };
}

interface Metrics {
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: { estimate: number; lower: number; upper: number };
  avgCLV: { estimate: number; lower: number; upper: number };
  avgBrier: { estimate: number; lower: number; upper: number };
  edgeBuckets: {
    bucket: string;
    bets: number;
    winRate: number;
    roi: number;
  }[];
}

function calculateMetrics(results: BetResult[]): Metrics {
  const wins = results.filter(r => r.covered === true).length;
  const losses = results.filter(r => r.covered === false).length;
  const pushes = results.filter(r => r.covered === null).length;

  const profits = results.filter(r => r.covered !== null).map(r => r.profit);
  const roiCI = bootstrapCI(profits, arr => {
    const total = arr.reduce((s, v) => s + v, 0);
    return arr.length > 0 ? (total / (arr.length * 100)) * 100 : 0;
  });

  const clvs = results.map(r => r.clv);
  const clvCI = bootstrapCI(clvs, arr =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  );

  const briers = results.filter(r => r.covered !== null).map(r => r.brierScore);
  const brierCI = bootstrapCI(briers, arr =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  );

  // Edge bucket analysis
  const buckets = [
    { min: 0, max: 1, label: '0-1 pts' },
    { min: 1, max: 2, label: '1-2 pts' },
    { min: 2, max: 3, label: '2-3 pts' },
    { min: 3, max: Infinity, label: '3+ pts' },
  ];

  const edgeBuckets = buckets.map(bucket => {
    const bucketResults = results.filter(
      r => Math.abs(r.edge) >= bucket.min && Math.abs(r.edge) < bucket.max
    );
    const bWins = bucketResults.filter(r => r.covered === true).length;
    const bLosses = bucketResults.filter(r => r.covered === false).length;
    const bProfit = bucketResults.reduce((s, r) => s + r.profit, 0);
    const bROI = bWins + bLosses > 0 ? (bProfit / ((bWins + bLosses) * 100)) * 100 : 0;

    return {
      bucket: bucket.label,
      bets: bucketResults.length,
      winRate: bWins + bLosses > 0 ? bWins / (bWins + bLosses) : 0,
      roi: bROI,
    };
  });

  return {
    bets: results.length,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    roi: roiCI,
    avgCLV: clvCI,
    avgBrier: brierCI,
    edgeBuckets,
  };
}

function checkMonotonicity(buckets: { bucket: string; roi: number }[]): boolean {
  // Check if ROI increases with edge size
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].roi < buckets[i - 1].roi) {
      return false;
    }
  }
  return true;
}

function printComparison(v1: Metrics, v2: Metrics): void {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                     V1 vs V2 COMPARISON                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  console.log('                          V1 (Elo)        V2 (Elo+PPA)   Better?');
  console.log('─'.repeat(70));

  // Bets
  console.log(`Bets:                     ${v1.bets.toString().padEnd(16)} ${v2.bets.toString().padEnd(14)}`);

  // Win Rate
  const v1WR = (v1.winRate * 100).toFixed(1) + '%';
  const v2WR = (v2.winRate * 100).toFixed(1) + '%';
  const wrBetter = v2.winRate > v1.winRate ? 'V2' : v1.winRate > v2.winRate ? 'V1' : '=';
  console.log(`Win Rate:                 ${v1WR.padEnd(16)} ${v2WR.padEnd(14)} ${wrBetter}`);

  // ROI
  const v1ROI = `${v1.roi.estimate.toFixed(2)}%`;
  const v2ROI = `${v2.roi.estimate.toFixed(2)}%`;
  const roiBetter = v2.roi.estimate > v1.roi.estimate ? 'V2' : v1.roi.estimate > v2.roi.estimate ? 'V1' : '=';
  console.log(`ROI:                      ${v1ROI.padEnd(16)} ${v2ROI.padEnd(14)} ${roiBetter}`);

  // CLV (higher is better)
  const v1CLV = v1.avgCLV.estimate.toFixed(4);
  const v2CLV = v2.avgCLV.estimate.toFixed(4);
  const clvBetter = v2.avgCLV.estimate > v1.avgCLV.estimate ? 'V2' : v1.avgCLV.estimate > v2.avgCLV.estimate ? 'V1' : '=';
  console.log(`Avg CLV:                  ${v1CLV.padEnd(16)} ${v2CLV.padEnd(14)} ${clvBetter}`);

  // Brier (lower is better)
  const v1Brier = v1.avgBrier.estimate.toFixed(4);
  const v2Brier = v2.avgBrier.estimate.toFixed(4);
  const brierBetter = v2.avgBrier.estimate < v1.avgBrier.estimate ? 'V2' : v1.avgBrier.estimate < v2.avgBrier.estimate ? 'V1' : '=';
  console.log(`Avg Brier:                ${v1Brier.padEnd(16)} ${v2Brier.padEnd(14)} ${brierBetter} (lower=better)`);

  // Monotonicity
  const v1Mono = checkMonotonicity(v1.edgeBuckets) ? 'Yes' : 'No';
  const v2Mono = checkMonotonicity(v2.edgeBuckets) ? 'Yes' : 'No';
  const monoBetter = v2Mono === 'Yes' && v1Mono === 'No' ? 'V2' : v1Mono === 'Yes' && v2Mono === 'No' ? 'V1' : '=';
  console.log(`Edge Monotonic:           ${v1Mono.padEnd(16)} ${v2Mono.padEnd(14)} ${monoBetter}`);

  console.log('\n─'.repeat(70));
  console.log('Edge Bucket Analysis:');
  console.log('                     V1 ROI           V2 ROI');

  for (let i = 0; i < v1.edgeBuckets.length; i++) {
    const b1 = v1.edgeBuckets[i];
    const b2 = v2.edgeBuckets[i];
    const v1r = `${b1.roi.toFixed(1)}% (n=${b1.bets})`;
    const v2r = `${b2.roi.toFixed(1)}% (n=${b2.bets})`;
    console.log(`  ${b1.bucket.padEnd(10)}         ${v1r.padEnd(16)} ${v2r}`);
  }

  // Decision
  console.log('\n═'.repeat(70));
  let improvements = 0;
  if (v2.avgCLV.estimate > v1.avgCLV.estimate) improvements++;
  if (v2.avgBrier.estimate < v1.avgBrier.estimate) improvements++;
  if (checkMonotonicity(v2.edgeBuckets) && !checkMonotonicity(v1.edgeBuckets)) improvements++;

  const decision = improvements >= 2 ? 'KEEP V2' : 'KEEP V1';
  console.log(`\nDECISION: ${decision} (${improvements}/3 criteria improved)`);
  console.log('═'.repeat(70));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              V2 BACKTEST: Elo + Offensive PPA                  ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Guardrails:                                                    ║');
  console.log('║   • Train: 2022-2023 | Test: 2024 (NO LEAKAGE)                ║');
  console.log('║   • Compare V1 (Elo-only) vs V2 (Elo + off_ppa)               ║');
  console.log('║   • Keep V2 only if improves 2+ of: CLV, Brier, Monotonicity  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const { train, test, exclusions } = await loadBacktestData();

  console.log(`\nModel Configs:`);
  console.log(`  V1: eloPointsFactor=${DEFAULT_V1_CONFIG.eloPointsFactor}, HFA=${DEFAULT_V1_CONFIG.homeFieldAdvantage}`);
  console.log(`  V2: + offPPAWeight=${DEFAULT_V2_CONFIG.offPPAWeight}`);

  // Run V1 on test set
  console.log('\n' + '='.repeat(70));
  console.log('Running V1 (Elo-only) on TEST set...');
  const v1Results = runBacktestV1(test, 0);
  const v1Metrics = calculateMetrics(v1Results);

  // Run V2 on test set
  console.log('Running V2 (Elo + off_ppa) on TEST set...');
  const v2Results = runBacktestV2(test, DEFAULT_V2_CONFIG, 0);
  const v2Metrics = calculateMetrics(v2Results);

  // Compare
  printComparison(v1Metrics, v2Metrics);

  // Sample V2 bets with PPA info
  console.log('\n' + '='.repeat(70));
  console.log('SAMPLE V2 BETS (first 5 with PPA data)');
  console.log('='.repeat(70) + '\n');

  const gamesWithPPA = test.filter(g => g.homeOffPPA !== null && g.awayOffPPA !== null);
  for (const game of gamesWithPPA.slice(0, 5)) {
    const v1Proj = v1ProjectSpread(game.homeElo, game.awayElo);
    const v2Proj = projectSpreadV2(game.homeElo, game.awayElo, game.homeOffPPA, game.awayOffPPA);

    console.log(`${game.awayTeamName} @ ${game.homeTeamName} (Week ${game.week})`);
    console.log(`  Elo: ${game.awayElo} vs ${game.homeElo}`);
    console.log(`  off_ppa: ${game.awayOffPPA?.toFixed(3)} vs ${game.homeOffPPA?.toFixed(3)}`);
    console.log(`  V1 Model: ${v1Proj.modelSpreadHome.toFixed(1)} | V2 Model: ${v2Proj.modelSpreadHome.toFixed(1)} | Market: ${game.marketSpreadHome}`);
    console.log(`  V2 Components: Elo=${v2Proj.eloComponent.toFixed(1)}, HFA=${v2Proj.hfaComponent.toFixed(1)}, PPA=${v2Proj.offPPAComponent.toFixed(1)}`);
    console.log(`  Result: ${game.homeMargin > 0 ? 'Home' : 'Away'} by ${Math.abs(game.homeMargin)}`);
    console.log('');
  }
}

main().catch(console.error);
