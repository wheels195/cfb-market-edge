/**
 * V1 Elo-Only Backtest
 *
 * LOCKED GUARDRAILS:
 * 1. Freeze dataset: Snapshot cohort at runtime, log counts
 * 2. Explicit exclusions: Hard-exclude missing Elo, log by season
 * 3. Train/Test split: Train = 2022-2023, Test = 2024. NO LEAKAGE.
 * 4. Price sanity: Assert non-null spread prices, fail loud
 * 5. Metrics: CLV, Brier, ROI with bootstrap CIs
 * 6. No feature creep: Elo-only + market baseline
 */

import { createClient } from '@supabase/supabase-js';
import {
  projectSpread,
  calculateEdge,
  didCover,
  calculateProfit,
  calculateCLV,
  brierScore,
  impliedProbability,
  V1ModelConfig,
  DEFAULT_V1_CONFIG,
} from '../src/lib/models/v1-elo-model';

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
  homeElo: number;
  awayElo: number;
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

interface SeasonStats {
  season: number;
  totalGames: number;
  betsPlaced: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalProfit: number;
  roi: number;
  avgCLV: number;
  avgBrier: number;
}

// ============================================================================
// DATA LOADING WITH PAGINATION
// ============================================================================

async function paginate<T>(
  query: () => Promise<{ data: T[] | null; error: any }>,
  pageSize: number = 1000
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await query();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

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
  const eloMap = new Map<string, number>(); // `${teamId}-${season}-${week}` -> elo
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

  // Load all closing line ticks (spread only)
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
    return month === 0 ? year - 1 : year; // Jan = previous season
  };

  const getWeek = (date: string, season: number): number => {
    const d = new Date(date);
    const month = d.getMonth();
    if (month === 0) return 16; // Bowl games
    if (month === 7) return d.getDate() < 25 ? 0 : 1; // August
    const sept1 = new Date(season, 8, 1).getTime();
    const daysSince = Math.floor((d.getTime() - sept1) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(16, 1 + Math.floor(daysSince / 7)));
  };

  const train: BacktestGame[] = [];
  const test: BacktestGame[] = [];

  const missingBySeasonReason: Record<string, number> = {};

  for (const event of allEvents) {
    const season = getSeason(event.commence_time);
    const week = getWeek(event.commence_time, season);
    const homeTeamId = (event.home_team as any)?.id;
    const awayTeamId = (event.away_team as any)?.id;
    const homeTeamName = (event.home_team as any)?.name || 'Unknown';
    const awayTeamName = (event.away_team as any)?.name || 'Unknown';

    // Skip 2025 (not in test set)
    if (season > 2024) continue;

    // Check for results
    const result = resultMap.get(event.id);
    if (!result) {
      const key = `${season}-missing_result`;
      missingBySeasonReason[key] = (missingBySeasonReason[key] || 0) + 1;
      continue;
    }

    // Check for closing lines
    const closing = closingMap.get(event.id);
    if (!closing) {
      const key = `${season}-missing_closing`;
      missingBySeasonReason[key] = (missingBySeasonReason[key] || 0) + 1;
      continue;
    }

    // PRICE SANITY CHECK: Assert non-null spread prices
    if (closing.priceHome === null || closing.priceHome === undefined ||
        closing.priceAway === null || closing.priceAway === undefined) {
      throw new Error(`SANITY CHECK FAILED: Null spread price for event ${event.id}`);
    }

    // Check for Elo (use week-1, fallback to week 0)
    const eloWeek = Math.max(0, week - 1);
    const homeEloKey = `${homeTeamId}-${season}-${eloWeek}`;
    const awayEloKey = `${awayTeamId}-${season}-${eloWeek}`;
    let homeElo = eloMap.get(homeEloKey);
    let awayElo = eloMap.get(awayEloKey);

    // Fallback to week 0 if specific week not found
    if (!homeElo) homeElo = eloMap.get(`${homeTeamId}-${season}-0`);
    if (!awayElo) awayElo = eloMap.get(`${awayTeamId}-${season}-0`);

    // EXPLICIT EXCLUSION: Missing Elo (FCS teams)
    if (!homeElo || !awayElo) {
      const key = `${season}-missing_elo`;
      missingBySeasonReason[key] = (missingBySeasonReason[key] || 0) + 1;
      continue;
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
      marketSpreadHome: closing.spreadHome,
      spreadPriceHome: closing.priceHome,
      spreadPriceAway: closing.priceAway,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      homeMargin: result.homeScore - result.awayScore,
    };

    // LOCKED SPLIT: Train = 2022-2023, Test = 2024
    if (season <= 2023) {
      train.push(game);
    } else if (season === 2024) {
      test.push(game);
    }
  }

  // Log exclusions by season
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
  console.log(`Total: ${train.length + test.length} games`);

  console.log('\nExclusions by season and reason:');
  for (const ex of exclusions) {
    console.log(`  ${ex.season} - ${ex.reason}: ${ex.count}`);
  }

  return { train, test, exclusions };
}

// ============================================================================
// BACKTEST EXECUTION
// ============================================================================

function runBacktest(
  games: BacktestGame[],
  config: V1ModelConfig,
  edgeThreshold: number = 0
): BetResult[] {
  const results: BetResult[] = [];

  for (const game of games) {
    // Project spread using Elo-only model
    const { modelSpreadHome } = projectSpread(game.homeElo, game.awayElo, config);

    // Calculate edge
    const { edge, side } = calculateEdge(game.marketSpreadHome, modelSpreadHome);

    // Only bet if edge exceeds threshold
    if (Math.abs(edge) < edgeThreshold) continue;

    // Get price for the side we're betting
    const priceAmerican = side === 'home' ? game.spreadPriceHome : game.spreadPriceAway;

    // Determine if bet covered
    const covered = didCover(game.homeMargin, game.marketSpreadHome, side);

    // Calculate profit
    const profit = calculateProfit(covered, priceAmerican);

    // Calculate CLV (using same spread for bet and close since we're using closing lines)
    const clv = calculateCLV(game.marketSpreadHome, game.marketSpreadHome, side);

    // Calculate Brier score
    const impliedProb = impliedProbability(priceAmerican);
    const brier = covered !== null ? brierScore(impliedProb, covered) : 0;

    results.push({
      eventId: game.eventId,
      season: game.season,
      homeTeam: game.homeTeamName,
      awayTeam: game.awayTeamName,
      homeElo: game.homeElo,
      awayElo: game.awayElo,
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
// METRICS CALCULATION
// ============================================================================

function calculateSeasonStats(results: BetResult[], season: number): SeasonStats {
  const seasonResults = results.filter(r => r.season === season);
  const wins = seasonResults.filter(r => r.covered === true).length;
  const losses = seasonResults.filter(r => r.covered === false).length;
  const pushes = seasonResults.filter(r => r.covered === null).length;
  const totalProfit = seasonResults.reduce((sum, r) => sum + r.profit, 0);
  const totalWagered = seasonResults.filter(r => r.covered !== null).length * 100;
  const avgCLV = seasonResults.length > 0
    ? seasonResults.reduce((sum, r) => sum + r.clv, 0) / seasonResults.length
    : 0;
  const avgBrier = seasonResults.filter(r => r.covered !== null).length > 0
    ? seasonResults.filter(r => r.covered !== null).reduce((sum, r) => sum + r.brierScore, 0) /
      seasonResults.filter(r => r.covered !== null).length
    : 0;

  return {
    season,
    totalGames: seasonResults.length,
    betsPlaced: seasonResults.length,
    wins,
    losses,
    pushes,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    totalProfit,
    roi: totalWagered > 0 ? (totalProfit / totalWagered) * 100 : 0,
    avgCLV,
    avgBrier,
  };
}

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

function printMetrics(results: BetResult[], label: string): void {
  console.log(`\n=== ${label} ===`);

  if (results.length === 0) {
    console.log('No bets placed.');
    return;
  }

  const wins = results.filter(r => r.covered === true).length;
  const losses = results.filter(r => r.covered === false).length;
  const pushes = results.filter(r => r.covered === null).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const totalWagered = (wins + losses) * 100;

  console.log(`Bets: ${results.length} (${wins}W-${losses}L-${pushes}P)`);
  console.log(`Win Rate: ${(wins / (wins + losses) * 100).toFixed(1)}%`);

  // ROI with bootstrap CI
  const profits = results.filter(r => r.covered !== null).map(r => r.profit);
  const roiCI = bootstrapCI(profits, arr => {
    const total = arr.reduce((s, v) => s + v, 0);
    return (total / (arr.length * 100)) * 100;
  });
  console.log(`ROI: ${roiCI.estimate.toFixed(2)}% [${roiCI.lower.toFixed(2)}%, ${roiCI.upper.toFixed(2)}%] (95% CI)`);

  // CLV with bootstrap CI
  const clvs = results.map(r => r.clv);
  const clvCI = bootstrapCI(clvs, arr => arr.reduce((s, v) => s + v, 0) / arr.length);
  console.log(`Avg CLV: ${clvCI.estimate.toFixed(3)} [${clvCI.lower.toFixed(3)}, ${clvCI.upper.toFixed(3)}] (95% CI)`);

  // Brier score with bootstrap CI
  const briers = results.filter(r => r.covered !== null).map(r => r.brierScore);
  const brierCI = bootstrapCI(briers, arr => arr.reduce((s, v) => s + v, 0) / arr.length);
  console.log(`Avg Brier: ${brierCI.estimate.toFixed(4)} [${brierCI.lower.toFixed(4)}, ${brierCI.upper.toFixed(4)}] (95% CI)`);

  // Edge bucket analysis
  console.log('\nEdge Bucket Analysis:');
  const buckets = [
    { min: 0, max: 1, label: '0-1 pts' },
    { min: 1, max: 2, label: '1-2 pts' },
    { min: 2, max: 3, label: '2-3 pts' },
    { min: 3, max: Infinity, label: '3+ pts' },
  ];

  for (const bucket of buckets) {
    const bucketResults = results.filter(r => Math.abs(r.edge) >= bucket.min && Math.abs(r.edge) < bucket.max);
    if (bucketResults.length === 0) continue;

    const bWins = bucketResults.filter(r => r.covered === true).length;
    const bLosses = bucketResults.filter(r => r.covered === false).length;
    const bProfit = bucketResults.reduce((s, r) => s + r.profit, 0);
    const bROI = bWins + bLosses > 0 ? (bProfit / ((bWins + bLosses) * 100)) * 100 : 0;

    console.log(`  ${bucket.label}: ${bucketResults.length} bets, ${(bWins / (bWins + bLosses) * 100).toFixed(1)}% win, ${bROI.toFixed(1)}% ROI`);
  }

  // Season breakdown
  console.log('\nBy Season:');
  const seasons = [...new Set(results.map(r => r.season))].sort();
  for (const season of seasons) {
    const stats = calculateSeasonStats(results, season);
    console.log(`  ${season}: ${stats.betsPlaced} bets, ${(stats.winRate * 100).toFixed(1)}% win, ${stats.roi.toFixed(1)}% ROI`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    V1 ELO-ONLY BACKTEST                        ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Guardrails:                                                    ║');
  console.log('║   • Train: 2022-2023 | Test: 2024 (NO LEAKAGE)                ║');
  console.log('║   • Exclusions: Missing Elo (FCS) hard-excluded               ║');
  console.log('║   • Metrics: CLV, Brier, ROI with bootstrap CIs               ║');
  console.log('║   • Features: Elo-only + HFA (no totals/injuries/weather)     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Load data
  const { train, test, exclusions } = await loadBacktestData();

  // Model config
  const config = DEFAULT_V1_CONFIG;
  console.log(`\nModel Config: eloPointsFactor=${config.eloPointsFactor}, HFA=${config.homeFieldAdvantage}`);

  // Run backtest on training data (for calibration reference)
  console.log('\n' + '='.repeat(70));
  console.log('TRAINING SET RESULTS (2022-2023) - For reference only');
  console.log('='.repeat(70));

  const trainResults = runBacktest(train, config, 0); // All bets, no threshold
  printMetrics(trainResults, 'Train - All Games (edge threshold = 0)');

  // Test with different edge thresholds on training data
  for (const threshold of [1, 2, 3]) {
    const filtered = runBacktest(train, config, threshold);
    printMetrics(filtered, `Train - Edge >= ${threshold} pts`);
  }

  // Run backtest on test data (out-of-sample)
  console.log('\n' + '='.repeat(70));
  console.log('TEST SET RESULTS (2024) - OUT OF SAMPLE');
  console.log('='.repeat(70));

  const testResults = runBacktest(test, config, 0);
  printMetrics(testResults, 'Test - All Games (edge threshold = 0)');

  for (const threshold of [1, 2, 3]) {
    const filtered = runBacktest(test, config, threshold);
    printMetrics(filtered, `Test - Edge >= ${threshold} pts`);
  }

  // Sample bets
  console.log('\n' + '='.repeat(70));
  console.log('SAMPLE BETS (Test Set, first 10)');
  console.log('='.repeat(70));

  for (const bet of testResults.slice(0, 10)) {
    const result = bet.covered === true ? 'WIN' : bet.covered === false ? 'LOSS' : 'PUSH';
    console.log(`${bet.awayTeam} @ ${bet.homeTeam}`);
    console.log(`  Elo: ${bet.awayElo} vs ${bet.homeElo} | Model: ${bet.modelSpreadHome.toFixed(1)} | Market: ${bet.marketSpreadHome}`);
    console.log(`  Edge: ${bet.edge.toFixed(2)} → Bet ${bet.side.toUpperCase()} @ ${bet.priceAmerican}`);
    console.log(`  Result: ${bet.homeMargin > 0 ? 'Home' : 'Away'} by ${Math.abs(bet.homeMargin)} | ${result} | P/L: $${bet.profit.toFixed(2)}`);
    console.log('');
  }
}

main().catch(console.error);
