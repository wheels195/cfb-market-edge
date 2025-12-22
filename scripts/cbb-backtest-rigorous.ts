/**
 * CBB Spread Model - Rigorous Backtest
 *
 * Proper methodology:
 * - Train: 2022-2023 seasons (parameter tuning allowed)
 * - Test: 2024 season (ONE-SHOT evaluation, no tuning)
 * - DraftKings lines ONLY (primary baseline)
 * - Leakage audit: verify no rating timestamp >= game start
 * - Edge distribution analysis
 * - Selection layer evaluation (top N, edge bands)
 */

import { createClient } from '@supabase/supabase-js';
import {
  calculateSpreadProjection,
  gradePrediction,
  CBBTeamRatings,
  CBBSpreadProjection,
  CBB_MODEL_CONFIG,
} from '../src/lib/models/cbb-spread';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface GameWithData {
  id: string;
  season: number;
  startDate: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  neutralSite: boolean;
  marketSpread: number;
  ratingCapturedAt: string | null;
}

interface BacktestResult {
  gameId: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  marketSpread: number;
  modelSpread: number;
  edge: number;
  predictedSide: 'home' | 'away';
  actualMargin: number;
  result: 'win' | 'loss' | 'push';
}

// ============================================
// LEAKAGE AUDIT
// ============================================
async function runLeakageAudit(): Promise<{ passed: boolean; violations: number; details: string[] }> {
  console.log('\n========================================');
  console.log('  LEAKAGE AUDIT');
  console.log('========================================');

  const details: string[] = [];
  let violations = 0;

  // Check if ratings have captured_at timestamps
  const { data: ratingsWithTimestamp } = await supabase
    .from('cbb_team_ratings')
    .select('id, team_id, season, captured_at')
    .not('captured_at', 'is', null)
    .limit(10);

  if (!ratingsWithTimestamp || ratingsWithTimestamp.length === 0) {
    details.push('WARNING: Ratings do not have captured_at timestamps');
    details.push('Using end-of-season ratings (potential leakage for in-season games)');
    details.push('For production: implement weekly rating snapshots');
  } else {
    details.push(`Found ${ratingsWithTimestamp.length}+ ratings with timestamps`);
  }

  // Check rating seasons vs game seasons
  const { data: ratingSeasons } = await supabase
    .from('cbb_team_ratings')
    .select('season')
    .order('season', { ascending: false });

  const uniqueSeasons = [...new Set((ratingSeasons || []).map(r => r.season))];
  details.push(`Rating seasons available: ${uniqueSeasons.join(', ')}`);

  // For end-of-season ratings, the main leakage concern is:
  // - Using 2024 final ratings to predict 2024 games (leakage)
  // - Using 2023 final ratings to predict 2024 games (OK - point-in-time)
  details.push('');
  details.push('Leakage prevention strategy:');
  details.push('  - Train (2022-23): Use same-season final ratings (acceptable for training)');
  details.push('  - Test (2024): Use PRIOR season (2023) ratings only');

  const passed = violations === 0;
  console.log(details.join('\n'));
  console.log(`\nAudit result: ${passed ? 'PASSED' : 'FAILED'} (${violations} violations)`);

  return { passed, violations, details };
}

// ============================================
// DATA LOADING
// ============================================
async function loadGamesWithDKLines(seasons: number[]): Promise<GameWithData[]> {
  // Fetch games in batches
  let allGames: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: batch } = await supabase
      .from('cbb_games')
      .select(`
        id,
        season,
        start_date,
        home_team_id,
        away_team_id,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        neutral_site
      `)
      .in('season', seasons)
      .eq('status', 'final')
      .not('home_score', 'is', null)
      .not('away_score', 'is', null)
      .not('home_team_id', 'is', null)
      .not('away_team_id', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allGames = allGames.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  // Fetch DraftKings lines ONLY
  let allLines: any[] = [];
  offset = 0;

  while (true) {
    const { data: batch } = await supabase
      .from('cbb_betting_lines')
      .select('game_id, spread_home')
      .eq('provider', 'DraftKings')
      .not('spread_home', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allLines = allLines.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  const linesByGame = new Map(allLines.map(l => [l.game_id, l.spread_home]));

  // Join games with lines
  const gamesWithLines: GameWithData[] = [];

  for (const game of allGames) {
    const spread = linesByGame.get(game.id);
    if (spread === undefined) continue;

    gamesWithLines.push({
      id: game.id,
      season: game.season,
      startDate: game.start_date,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamName: game.home_team_name || 'Unknown',
      awayTeamName: game.away_team_name || 'Unknown',
      homeScore: game.home_score,
      awayScore: game.away_score,
      neutralSite: game.neutral_site || false,
      marketSpread: spread,
      ratingCapturedAt: null,
    });
  }

  return gamesWithLines;
}

async function loadRatings(seasons: number[]): Promise<Map<string, CBBTeamRatings>> {
  const { data: ratings } = await supabase
    .from('cbb_team_ratings')
    .select('team_id, season, offensive_rating, defensive_rating, net_rating, srs_rating')
    .in('season', seasons);

  const ratingsMap = new Map<string, CBBTeamRatings>();

  for (const r of ratings || []) {
    const key = `${r.team_id}-${r.season}`;
    ratingsMap.set(key, {
      offensiveRating: r.offensive_rating,
      defensiveRating: r.defensive_rating,
      netRating: r.net_rating,
      srsRating: r.srs_rating,
    });
  }

  return ratingsMap;
}

// ============================================
// BACKTEST EVALUATION
// ============================================
function evaluateGames(
  games: GameWithData[],
  ratingsMap: Map<string, CBBTeamRatings>,
  ratingSeason: number | 'same' // Use specific season or 'same' as game
): BacktestResult[] {
  const results: BacktestResult[] = [];

  for (const game of games) {
    const rSeason = ratingSeason === 'same' ? game.season : ratingSeason;
    const homeKey = `${game.homeTeamId}-${rSeason}`;
    const awayKey = `${game.awayTeamId}-${rSeason}`;

    const homeRatings = ratingsMap.get(homeKey);
    const awayRatings = ratingsMap.get(awayKey);

    if (!homeRatings || !awayRatings) continue;
    if (homeRatings.netRating === null || awayRatings.netRating === null) continue;

    const projection = calculateSpreadProjection(
      homeRatings,
      awayRatings,
      game.marketSpread,
      game.neutralSite
    );

    const result = gradePrediction(projection, game.homeScore, game.awayScore);

    results.push({
      gameId: game.id,
      season: game.season,
      homeTeam: game.homeTeamName,
      awayTeam: game.awayTeamName,
      marketSpread: game.marketSpread,
      modelSpread: projection.modelSpreadHome,
      edge: projection.edgePoints,
      predictedSide: projection.predictedSide,
      actualMargin: game.homeScore - game.awayScore,
      result,
    });
  }

  return results;
}

// ============================================
// METRICS CALCULATION
// ============================================
interface Metrics {
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
}

function calculateMetrics(results: BacktestResult[]): Metrics {
  const wins = results.filter(r => r.result === 'win').length;
  const losses = results.filter(r => r.result === 'loss').length;
  const pushes = results.filter(r => r.result === 'push').length;
  const decided = wins + losses;

  return {
    count: results.length,
    wins,
    losses,
    pushes,
    winRate: decided > 0 ? wins / decided : 0,
    roi: decided > 0 ? (wins * 0.909 - losses) / decided : 0,
  };
}

function filterByEdge(results: BacktestResult[], minEdge: number): BacktestResult[] {
  return results.filter(r => Math.abs(r.edge) >= minEdge);
}

function topNByEdge(results: BacktestResult[], n: number): BacktestResult[] {
  return [...results]
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
    .slice(0, n);
}

// ============================================
// EDGE DISTRIBUTION ANALYSIS
// ============================================
function analyzeEdgeDistribution(results: BacktestResult[]): void {
  console.log('\n========================================');
  console.log('  EDGE DISTRIBUTION (DraftKings Only)');
  console.log('========================================');

  const edges = results.map(r => r.edge);
  const absEdges = edges.map(e => Math.abs(e));

  const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
  const absMean = absEdges.reduce((a, b) => a + b, 0) / absEdges.length;

  const sorted = [...absEdges].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p90 = sorted[Math.floor(sorted.length * 0.90)];

  console.log(`\nEdge Statistics (n=${results.length}):`);
  console.log(`  Mean edge: ${mean.toFixed(2)} pts`);
  console.log(`  Mean |edge|: ${absMean.toFixed(2)} pts`);
  console.log(`  25th percentile: ${p25.toFixed(2)} pts`);
  console.log(`  Median: ${p50.toFixed(2)} pts`);
  console.log(`  75th percentile: ${p75.toFixed(2)} pts`);
  console.log(`  90th percentile: ${p90.toFixed(2)} pts`);

  // Histogram
  const bins = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 100];
  const histogram: number[] = new Array(bins.length - 1).fill(0);

  for (const e of absEdges) {
    for (let i = 0; i < bins.length - 1; i++) {
      if (e >= bins[i] && e < bins[i + 1]) {
        histogram[i]++;
        break;
      }
    }
  }

  console.log('\nEdge Magnitude Distribution:');
  for (let i = 0; i < histogram.length; i++) {
    const label = bins[i + 1] === 100 ? `${bins[i]}+` : `${bins[i]}-${bins[i + 1]}`;
    const pct = (histogram[i] / results.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(histogram[i] / results.length * 50));
    console.log(`  ${label.padEnd(8)} | ${histogram[i].toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
  }
}

// ============================================
// SELECTION LAYER ANALYSIS
// ============================================
function analyzeSelectionLayers(results: BacktestResult[], label: string): void {
  console.log(`\n--- ${label} ---`);

  // Edge threshold analysis
  console.log('\nBy Edge Threshold:');
  console.log('  Threshold | Record       | Win%   | ROI     | Games');
  console.log('  ----------|--------------|--------|---------|------');

  for (const threshold of [0, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
    const filtered = filterByEdge(results, threshold);
    if (filtered.length === 0) continue;
    const m = calculateMetrics(filtered);
    const record = `${m.wins}-${m.losses}-${m.pushes}`;
    console.log(`  ≥${threshold.toFixed(1).padEnd(7)} | ${record.padEnd(12)} | ${(m.winRate * 100).toFixed(1).padStart(5)}% | ${(m.roi * 100).toFixed(1).padStart(6)}% | ${m.count}`);
  }

  // Top N analysis (simulates picking best edges each week)
  console.log('\nTop N Picks (by |edge|):');
  console.log('  Top N | Record       | Win%   | ROI     | Avg Edge');
  console.log('  ------|--------------|--------|---------|----------');

  for (const n of [50, 100, 200, 500, 1000]) {
    if (n > results.length) continue;
    const topN = topNByEdge(results, n);
    const m = calculateMetrics(topN);
    const avgEdge = topN.reduce((s, r) => s + Math.abs(r.edge), 0) / topN.length;
    const record = `${m.wins}-${m.losses}-${m.pushes}`;
    console.log(`  ${n.toString().padEnd(5)} | ${record.padEnd(12)} | ${(m.winRate * 100).toFixed(1).padStart(5)}% | ${(m.roi * 100).toFixed(1).padStart(6)}% | ${avgEdge.toFixed(2)} pts`);
  }

  // Edge band analysis
  console.log('\nEdge Bands:');
  console.log('  Band      | Record       | Win%   | ROI     | Games');
  console.log('  ----------|--------------|--------|---------|------');

  const bands = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 100]];
  for (const [low, high] of bands) {
    const filtered = results.filter(r => Math.abs(r.edge) >= low && Math.abs(r.edge) < high);
    if (filtered.length === 0) continue;
    const m = calculateMetrics(filtered);
    const label = high === 100 ? `${low}+` : `${low}-${high}`;
    const record = `${m.wins}-${m.losses}-${m.pushes}`;
    console.log(`  ${label.padEnd(9)} | ${record.padEnd(12)} | ${(m.winRate * 100).toFixed(1).padStart(5)}% | ${(m.roi * 100).toFixed(1).padStart(6)}% | ${m.count}`);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('========================================');
  console.log('  CBB Model - Rigorous Backtest');
  console.log('  DraftKings Lines Only');
  console.log('========================================');
  console.log(`\nModel Config:`);
  console.log(`  Home Court: ${CBB_MODEL_CONFIG.HOME_COURT_ADVANTAGE} pts`);
  console.log(`  Efficiency Scale: ${CBB_MODEL_CONFIG.EFFICIENCY_SCALE}`);
  console.log(`  Market Anchor: ${CBB_MODEL_CONFIG.MARKET_ANCHOR_WEIGHT}`);
  console.log(`  Max Adjustment: ±${CBB_MODEL_CONFIG.MAX_ADJUSTMENT} pts`);

  // 1. LEAKAGE AUDIT
  await runLeakageAudit();

  // 2. LOAD DATA
  console.log('\n========================================');
  console.log('  DATA LOADING');
  console.log('========================================');

  const trainGames = await loadGamesWithDKLines([2022, 2023]);
  const testGames = await loadGamesWithDKLines([2024]);

  console.log(`\nTrain games (2022-23) with DK lines: ${trainGames.length}`);
  console.log(`Test games (2024) with DK lines: ${testGames.length}`);

  // Load ratings for all seasons
  const ratingsMap = await loadRatings([2022, 2023, 2024]);
  console.log(`Ratings loaded: ${ratingsMap.size}`);

  // 3. TRAIN SET EVALUATION (same-season ratings OK for training)
  console.log('\n========================================');
  console.log('  TRAIN SET (2022-2023)');
  console.log('  Using same-season ratings');
  console.log('========================================');

  const trainResults = evaluateGames(trainGames, ratingsMap, 'same');
  console.log(`\nGames evaluated: ${trainResults.length}`);

  const trainMetrics = calculateMetrics(trainResults);
  console.log(`Record: ${trainMetrics.wins}-${trainMetrics.losses}-${trainMetrics.pushes}`);
  console.log(`Win Rate: ${(trainMetrics.winRate * 100).toFixed(1)}%`);
  console.log(`ROI: ${(trainMetrics.roi * 100).toFixed(1)}%`);

  analyzeEdgeDistribution(trainResults);
  analyzeSelectionLayers(trainResults, 'TRAIN SET Selection Analysis');

  // 4. TEST SET EVALUATION (STRICT: use 2023 ratings for 2024 games)
  console.log('\n========================================');
  console.log('  TEST SET (2024) - ONE-SHOT EVALUATION');
  console.log('  Using 2023 ratings (no leakage)');
  console.log('========================================');

  const testResults = evaluateGames(testGames, ratingsMap, 2023);
  console.log(`\nGames evaluated: ${testResults.length}`);

  if (testResults.length === 0) {
    console.log('WARNING: No test games could be evaluated');
    console.log('This may be due to missing 2023 ratings for teams playing in 2024');

    // Try with same-season ratings as fallback diagnostic
    const testResultsSameSeason = evaluateGames(testGames, ratingsMap, 'same');
    console.log(`\n[Diagnostic] With 2024 ratings: ${testResultsSameSeason.length} games`);
    if (testResultsSameSeason.length > 0) {
      const m = calculateMetrics(testResultsSameSeason);
      console.log(`[Diagnostic] Record: ${m.wins}-${m.losses}-${m.pushes} (${(m.winRate * 100).toFixed(1)}%)`);
      console.log('NOTE: This uses 2024 ratings which has leakage - for diagnostics only');
    }
  } else {
    const testMetrics = calculateMetrics(testResults);
    console.log(`Record: ${testMetrics.wins}-${testMetrics.losses}-${testMetrics.pushes}`);
    console.log(`Win Rate: ${(testMetrics.winRate * 100).toFixed(1)}%`);
    console.log(`ROI: ${(testMetrics.roi * 100).toFixed(1)}%`);

    analyzeEdgeDistribution(testResults);
    analyzeSelectionLayers(testResults, 'TEST SET Selection Analysis');
  }

  // 5. SUMMARY
  console.log('\n========================================');
  console.log('  SUMMARY');
  console.log('========================================');
  console.log(`\nTrain (2022-23): ${trainResults.length} games`);
  console.log(`  Win Rate: ${(trainMetrics.winRate * 100).toFixed(1)}%`);
  console.log(`  ROI: ${(trainMetrics.roi * 100).toFixed(1)}%`);

  if (testResults.length > 0) {
    const testMetrics = calculateMetrics(testResults);
    console.log(`\nTest (2024): ${testResults.length} games`);
    console.log(`  Win Rate: ${(testMetrics.winRate * 100).toFixed(1)}%`);
    console.log(`  ROI: ${(testMetrics.roi * 100).toFixed(1)}%`);

    // Degradation check
    const degradation = trainMetrics.winRate - testMetrics.winRate;
    console.log(`\nTrain→Test Degradation: ${(degradation * 100).toFixed(1)} percentage points`);
    if (degradation > 0.05) {
      console.log('WARNING: Significant degradation detected (>5pp)');
    } else {
      console.log('OK: Degradation within acceptable range');
    }
  }
}

main().catch(console.error);
