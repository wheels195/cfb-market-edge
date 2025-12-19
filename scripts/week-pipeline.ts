/**
 * Week Pipeline - End-to-End Historical Week Processing
 *
 * This script runs the full pipeline for a given week:
 *   1. Creates model_run_snapshot
 *   2. Generates bet records (Top 5%)
 *   3. Grades results (if available)
 *   4. Computes CLV
 *   5. Outputs a week report
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/week-pipeline.ts [season] [week]
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  BETTING_RULES,
  MODEL_VERSION,
  MODEL_ID,
  PRODUCTION_CONFIG,
  type EdgeResult,
  type QBStatus,
} from '../src/lib/models/production-v1';
import { decideBet, type BetCandidate } from '../src/lib/models/betting-rules';

// =============================================================================
// CONFIG
// =============================================================================

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// =============================================================================
// TYPES
// =============================================================================

interface WeekReport {
  modelRunId: string;
  season: number;
  week: number;
  asOfTimestamp: Date;
  totalGames: number;
  gamesWithLines: number;
  gamesWithRatings: number;
  edgesGenerated: number;
  betsGenerated: number;
  betsWithResults: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  totalProfit: number;
  roi: number | null;
  avgEffectiveEdge: number;
  avgCLV: number | null;
  clvCaptureRate: number | null;
  errors: string[];
}

// =============================================================================
// STEP 1: CREATE MODEL RUN SNAPSHOT
// =============================================================================

async function createModelRunSnapshot(
  season: number,
  week: number,
  asOfTimestamp: Date
): Promise<{ modelRunId: string; errors: string[] }> {
  const errors: string[] = [];
  const modelRunId = `${MODEL_VERSION}-${season}-W${week}-${asOfTimestamp.getTime()}`;

  console.log(`\n=== STEP 1: Create Model Run Snapshot ===`);
  console.log(`  Model Run ID: ${modelRunId}`);

  // Check if this run already exists
  const { data: existing } = await supabase
    .from('model_runs')
    .select('id')
    .eq('id', modelRunId)
    .single();

  if (existing) {
    console.log(`  Model run already exists, reusing...`);
    return { modelRunId, errors };
  }

  // Create model run record
  const { error: runError } = await supabase
    .from('model_runs')
    .insert({
      id: modelRunId,
      season,
      week,
      model_version: MODEL_VERSION,
      model_id: MODEL_ID,
      as_of_timestamp: asOfTimestamp.toISOString(),
      config_snapshot: PRODUCTION_CONFIG,
      status: 'pending',
    });

  if (runError) {
    errors.push(`Error creating model run: ${runError.message}`);
    return { modelRunId, errors };
  }

  console.log(`  Created model run: ${modelRunId}`);
  return { modelRunId, errors };
}

// =============================================================================
// STEP 2: GENERATE EDGES
// =============================================================================

async function generateEdges(
  season: number,
  week: number,
  modelRunId: string
): Promise<{ edgesCreated: number; edges: any[]; errors: string[] }> {
  const errors: string[] = [];
  console.log(`\n=== STEP 2: Generate Edges ===`);

  // Get games for this week
  const { data: games, error: gamesError } = await supabase
    .from('cfbd_games')
    .select('id, home_team, away_team, home_id, away_id, start_date, home_points, away_points')
    .eq('season', season)
    .eq('week', week);

  if (gamesError) {
    errors.push(`Error fetching games: ${gamesError.message}`);
    return { edgesCreated: 0, edges: [], errors };
  }

  console.log(`  Found ${games?.length || 0} games`);

  // Get betting lines
  const { data: lines, error: linesError } = await supabase
    .from('cfbd_betting_lines')
    .select('*')
    .eq('season', season)
    .eq('week', week);

  if (linesError) {
    errors.push(`Error fetching lines: ${linesError.message}`);
  }

  const linesByGame = new Map<number, any>();
  for (const line of lines || []) {
    linesByGame.set(line.cfbd_game_id, line);
  }

  console.log(`  Found ${lines?.length || 0} betting lines`);

  // Get weather data for this week's games
  const gameIds = (games || []).map(g => g.id);
  const { data: weatherData, error: weatherError } = await supabase
    .from('game_weather')
    .select('cfbd_game_id, temperature, wind_speed, is_indoor')
    .in('cfbd_game_id', gameIds);

  if (weatherError) {
    errors.push(`Error fetching weather: ${weatherError.message}`);
  }

  const weatherByGame = new Map<number, { temperature: number | null; wind_speed: number | null; is_indoor: boolean }>();
  for (const w of weatherData || []) {
    weatherByGame.set(w.cfbd_game_id, {
      temperature: w.temperature,
      wind_speed: w.wind_speed,
      is_indoor: w.is_indoor || false,
    });
  }

  console.log(`  Found ${weatherData?.length || 0} weather records`);

  // Get team ratings (prior week)
  const priorWeek = week - 1;
  const { data: ratings, error: ratingsError } = await supabase
    .from('team_ratings')
    .select('*')
    .eq('season', season)
    .eq('week', priorWeek);

  if (ratingsError) {
    errors.push(`Error fetching ratings: ${ratingsError.message}`);
  }

  const ratingsByTeam = new Map<string, number>();
  for (const r of ratings || []) {
    ratingsByTeam.set(r.team_name?.toLowerCase(), r.rating);
  }

  console.log(`  Found ${ratings?.length || 0} team ratings for week ${priorWeek}`);

  // Generate edges
  const edges: any[] = [];

  for (const game of games || []) {
    const line = linesByGame.get(game.id);
    if (!line) continue;

    const homeRating = ratingsByTeam.get(game.home_team?.toLowerCase()) || 1500;
    const awayRating = ratingsByTeam.get(game.away_team?.toLowerCase()) || 1500;

    // Check if we have weather data for this game
    const weather = weatherByGame.get(game.id);
    const hasWeatherData = weather !== null && weather !== undefined && weather.temperature !== null;

    // === SPREAD EDGE ===
    if (line.spread !== null) {
      // Calculate model spread
      const HFA = 3.0;
      const ELO_TO_SPREAD = 25;
      const ratingDiff = homeRating - awayRating;
      const modelSpread = -(ratingDiff + HFA * ELO_TO_SPREAD) / ELO_TO_SPREAD;

      // Calculate edge
      const marketSpread = line.spread;
      const rawEdge = modelSpread - marketSpread;
      const uncertainty = 0.20; // Default uncertainty
      const effectiveEdge = rawEdge * (1 - uncertainty);

      const side = rawEdge < 0 ? 'home' : 'away';

      edges.push({
        model_run_id: modelRunId,
        cfbd_game_id: game.id,
        market_type: 'spread',
        market_line: marketSpread,
        model_line: modelSpread,
        raw_edge: rawEdge,
        effective_edge: effectiveEdge,
        uncertainty,
        side,
        home_team: game.home_team,
        away_team: game.away_team,
        spread_close: line.spread,
        total_close: line.over_under,
        home_score: game.home_points,
        away_score: game.away_points,
        hasWeatherData, // Spreads don't require weather, but track it
      });
    }

    // === TOTAL EDGE ===
    if (line.over_under !== null) {
      // Calculate model total (simplified: use average from ratings)
      // Higher rated teams score more, lower teams score less
      const avgRating = (homeRating + awayRating) / 2;
      const baseTotal = 48; // League average
      const modelTotal = baseTotal + (avgRating - 1500) / 50; // ~2 pts per 100 rating points

      // Calculate edge
      const marketTotal = line.over_under;
      const rawEdge = marketTotal - modelTotal; // Positive = market expects more scoring = under value
      const uncertainty = 0.25; // Higher uncertainty for totals
      const effectiveEdge = rawEdge * (1 - uncertainty);

      const side = rawEdge > 0 ? 'under' : 'over';

      edges.push({
        model_run_id: modelRunId,
        cfbd_game_id: game.id,
        market_type: 'total',
        market_line: marketTotal,
        model_line: modelTotal,
        raw_edge: rawEdge,
        effective_edge: effectiveEdge,
        uncertainty,
        side,
        home_team: game.home_team,
        away_team: game.away_team,
        spread_close: line.spread,
        total_close: line.over_under,
        home_score: game.home_points,
        away_score: game.away_points,
        hasWeatherData, // CRITICAL: Totals require weather data
      });
    }
  }

  // Separate spread and total edges for percentile calculation
  const spreadEdges = edges.filter(e => e.market_type === 'spread');
  const totalEdges = edges.filter(e => e.market_type === 'total');

  // Sort spreads by absolute effective edge and assign percentiles
  spreadEdges.sort((a, b) => Math.abs(b.effective_edge) - Math.abs(a.effective_edge));
  spreadEdges.forEach((edge, index) => {
    edge.percentile = (index + 1) / spreadEdges.length;
    // Spread edge floor: 3.0 points
    edge.bettable = edge.percentile <= 0.05 && Math.abs(edge.effective_edge) >= BETTING_RULES.EDGE_FLOORS.SPREAD;
    edge.reason = edge.bettable ? null : `Below Top 5% or edge floor (${BETTING_RULES.EDGE_FLOORS.SPREAD})`;
  });

  // Sort totals by absolute effective edge and assign percentiles
  totalEdges.sort((a, b) => Math.abs(b.effective_edge) - Math.abs(a.effective_edge));
  totalEdges.forEach((edge, index) => {
    edge.percentile = (index + 1) / totalEdges.length;
    // Total edge floor: 2.5 points, REQUIRES WEATHER DATA
    const meetsEdgeFloor = Math.abs(edge.effective_edge) >= BETTING_RULES.EDGE_FLOORS.TOTAL;
    const meetsPercentile = edge.percentile <= 0.05;
    const hasWeather = edge.hasWeatherData === true;

    if (!hasWeather && BETTING_RULES.EDGE_FLOORS.TOTAL_REQUIRES_WEATHER) {
      // Weather enforcement: block total bets without weather
      edge.bettable = false;
      edge.reason = 'Total bet requires weather data (missing)';
    } else if (!meetsPercentile) {
      edge.bettable = false;
      edge.reason = 'Below Top 5%';
    } else if (!meetsEdgeFloor) {
      edge.bettable = false;
      edge.reason = `Below edge floor (${BETTING_RULES.EDGE_FLOORS.TOTAL})`;
    } else {
      edge.bettable = true;
      edge.reason = null;
    }
  });

  // Combine back
  const allEdges = [...spreadEdges, ...totalEdges];

  // Count stats
  const bettableSpreads = spreadEdges.filter(e => e.bettable).length;
  const bettableTotals = totalEdges.filter(e => e.bettable).length;
  const totalsBlockedNoWeather = totalEdges.filter(e => e.reason?.includes('weather')).length;

  console.log(`  Generated ${allEdges.length} edges (${spreadEdges.length} spreads, ${totalEdges.length} totals)`);
  console.log(`  Bettable: ${bettableSpreads} spreads, ${bettableTotals} totals`);
  if (totalsBlockedNoWeather > 0) {
    console.log(`  Totals blocked (no weather): ${totalsBlockedNoWeather}`);
  }

  // Insert edges
  const edgeRecords = allEdges.map(e => ({
    model_run_id: e.model_run_id,
    cfbd_game_id: e.cfbd_game_id,
    market_type: e.market_type,
    market_line: e.market_line,
    model_line: e.model_line,
    raw_edge: e.raw_edge,
    effective_edge: e.effective_edge,
    uncertainty: e.uncertainty,
    side: e.side,
    percentile: e.percentile,
    bettable: e.bettable,
    reason: e.reason,
  }));

  if (edgeRecords.length > 0) {
    const { error: insertError } = await supabase
      .from('model_run_edges')
      .upsert(edgeRecords, { onConflict: 'model_run_id,cfbd_game_id,market_type' });

    if (insertError) {
      errors.push(`Error inserting edges: ${insertError.message}`);
    }
  }

  return { edgesCreated: allEdges.length, edges: allEdges, errors };
}

// =============================================================================
// STEP 3: GENERATE BET RECORDS
// =============================================================================

async function generateBetRecords(
  season: number,
  week: number,
  modelRunId: string,
  edges: any[]
): Promise<{ betsGenerated: number; errors: string[] }> {
  const errors: string[] = [];
  console.log(`\n=== STEP 3: Generate Bet Records ===`);

  const bettableEdges = edges.filter(e => e.bettable);
  const spreadBets = bettableEdges.filter(e => e.market_type === 'spread');
  const totalBets = bettableEdges.filter(e => e.market_type === 'total');

  console.log(`  Bettable edges: ${bettableEdges.length} (${spreadBets.length} spreads, ${totalBets.length} totals)`);

  if (bettableEdges.length === 0) {
    console.log(`  No bettable edges, skipping bet generation`);
    return { betsGenerated: 0, errors };
  }

  const betRecords = bettableEdges.map(edge => ({
    game_key: `${edge.away_team}@${edge.home_team}_${edge.market_type}`, // Include market_type in key
    season,
    week,
    market_type: edge.market_type,
    team: edge.market_type === 'spread'
      ? (edge.side === 'home' ? edge.home_team : edge.away_team)
      : null, // Totals don't have a team side
    side: edge.side, // 'home'/'away' for spreads, 'over'/'under' for totals
    spread_at_bet: edge.market_type === 'spread' ? edge.market_line : null,
    spread_at_close: edge.market_type === 'spread' ? edge.spread_close : null,
    total_at_bet: edge.market_type === 'total' ? edge.market_line : null,
    total_at_close: edge.market_type === 'total' ? edge.total_close : null,
    effective_edge: edge.effective_edge,
    raw_edge: edge.raw_edge,
    uncertainty: edge.uncertainty,
    percentile: edge.percentile,
    model_version: MODEL_VERSION,
    model_run_id: modelRunId,
    has_weather_data: edge.hasWeatherData || false,
  }));

  const { error: insertError } = await supabase
    .from('bet_records')
    .upsert(betRecords, { onConflict: 'game_key,season,week' });

  if (insertError) {
    errors.push(`Error inserting bets: ${insertError.message}`);
  }

  console.log(`  Generated ${betRecords.length} bet records`);
  return { betsGenerated: betRecords.length, errors };
}

// =============================================================================
// STEP 4: GRADE RESULTS
// =============================================================================

async function gradeResults(
  season: number,
  week: number,
  edges: any[]
): Promise<{ graded: number; wins: number; losses: number; pushes: number; profit: number; errors: string[] }> {
  const errors: string[] = [];
  console.log(`\n=== STEP 4: Grade Results ===`);

  const bettableEdges = edges.filter(e => e.bettable);
  let graded = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let profit = 0;

  for (const edge of bettableEdges) {
    if (edge.home_score === null || edge.away_score === null) continue;

    let result: 'win' | 'loss' | 'push';

    if (edge.market_type === 'spread') {
      // SPREAD GRADING
      const actualMargin = edge.home_score - edge.away_score;
      const spread = edge.market_line;
      const side = edge.side;

      // For home bets: win if margin > -spread
      // For away bets: win if margin < -spread
      const spreadCover = actualMargin + spread;

      if (side === 'home') {
        if (spreadCover > 0) result = 'win';
        else if (spreadCover < 0) result = 'loss';
        else result = 'push';
      } else {
        if (spreadCover < 0) result = 'win';
        else if (spreadCover > 0) result = 'loss';
        else result = 'push';
      }
    } else {
      // TOTAL GRADING (over/under)
      const actualTotal = edge.home_score + edge.away_score;
      const marketTotal = edge.market_line;
      const side = edge.side; // 'over' or 'under'

      if (side === 'over') {
        if (actualTotal > marketTotal) result = 'win';
        else if (actualTotal < marketTotal) result = 'loss';
        else result = 'push';
      } else { // under
        if (actualTotal < marketTotal) result = 'win';
        else if (actualTotal > marketTotal) result = 'loss';
        else result = 'push';
      }
    }

    // Update bet record (game_key now includes market_type)
    const gameKey = `${edge.away_team}@${edge.home_team}_${edge.market_type}`;
    await supabase
      .from('bet_records')
      .update({
        result,
        home_score: edge.home_score,
        away_score: edge.away_score,
      })
      .eq('game_key', gameKey)
      .eq('season', season)
      .eq('week', week);

    graded++;
    if (result === 'win') {
      wins++;
      profit += 0.91; // Standard -110 payout
    } else if (result === 'loss') {
      losses++;
      profit -= 1.0;
    } else {
      pushes++;
    }
  }

  console.log(`  Graded: ${graded} bets`);
  console.log(`  Record: ${wins}-${losses}-${pushes}`);
  console.log(`  Profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} units`);

  return { graded, wins, losses, pushes, profit, errors };
}

// =============================================================================
// STEP 5: COMPUTE CLV
// =============================================================================

async function computeCLV(
  season: number,
  week: number,
  edges: any[]
): Promise<{ avgCLV: number | null; clvCaptureRate: number | null; errors: string[] }> {
  const errors: string[] = [];
  console.log(`\n=== STEP 5: Compute CLV ===`);

  const bettableEdges = edges.filter(e => e.bettable && e.spread_close !== null);

  if (bettableEdges.length === 0) {
    console.log(`  No edges with closing lines available`);
    return { avgCLV: null, clvCaptureRate: null, errors };
  }

  let totalCLV = 0;
  let clvCaptures = 0;

  for (const edge of bettableEdges) {
    const lineMovement = edge.spread_close - edge.market_line;
    let clv: number;

    // CLV = movement in favorable direction
    if (edge.side === 'home') {
      clv = lineMovement; // If line moved up (less favorable to home), we got value
    } else {
      clv = -lineMovement; // If line moved down (less favorable to away), we got value
    }

    totalCLV += clv;
    if (clv > 0) clvCaptures++;
  }

  const avgCLV = totalCLV / bettableEdges.length;
  const clvCaptureRate = clvCaptures / bettableEdges.length;

  console.log(`  Avg CLV: ${avgCLV >= 0 ? '+' : ''}${avgCLV.toFixed(2)} pts`);
  console.log(`  CLV Capture Rate: ${(clvCaptureRate * 100).toFixed(1)}%`);

  return { avgCLV, clvCaptureRate, errors };
}

// =============================================================================
// GENERATE REPORT
// =============================================================================

function generateReport(
  modelRunId: string,
  season: number,
  week: number,
  asOfTimestamp: Date,
  edges: any[],
  betsGenerated: number,
  wins: number,
  losses: number,
  pushes: number,
  profit: number,
  avgCLV: number | null,
  clvCaptureRate: number | null,
  errors: string[]
): WeekReport {
  const bettableEdges = edges.filter(e => e.bettable);
  const avgEffectiveEdge = bettableEdges.length > 0
    ? bettableEdges.reduce((sum, e) => sum + Math.abs(e.effective_edge), 0) / bettableEdges.length
    : 0;

  const betsWithResults = wins + losses + pushes;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;
  const roi = betsWithResults > 0 ? (profit / betsWithResults) * 100 : null;

  return {
    modelRunId,
    season,
    week,
    asOfTimestamp,
    totalGames: edges.length,
    gamesWithLines: edges.filter(e => e.market_line !== null).length,
    gamesWithRatings: edges.length,
    edgesGenerated: edges.length,
    betsGenerated,
    betsWithResults,
    wins,
    losses,
    pushes,
    winRate,
    totalProfit: profit,
    roi,
    avgEffectiveEdge,
    avgCLV,
    clvCaptureRate,
    errors,
  };
}

function printReport(report: WeekReport): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`WEEK ${report.week} ${report.season} - REPORT`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Model Run ID: ${report.modelRunId}`);
  console.log(`Generated At: ${report.asOfTimestamp.toISOString()}`);
  console.log(`\n--- COVERAGE ---`);
  console.log(`  Total Games: ${report.totalGames}`);
  console.log(`  With Lines: ${report.gamesWithLines}`);
  console.log(`  Edges Generated: ${report.edgesGenerated}`);
  console.log(`  Bets Generated (Top 5%): ${report.betsGenerated}`);
  console.log(`\n--- PERFORMANCE ---`);
  console.log(`  Bets Graded: ${report.betsWithResults}`);
  console.log(`  Record: ${report.wins}-${report.losses}-${report.pushes}`);
  console.log(`  Win Rate: ${report.winRate !== null ? (report.winRate * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`  Profit: ${report.totalProfit >= 0 ? '+' : ''}${report.totalProfit.toFixed(2)} units`);
  console.log(`  ROI: ${report.roi !== null ? (report.roi >= 0 ? '+' : '') + report.roi.toFixed(1) + '%' : 'N/A'}`);
  console.log(`\n--- EDGE QUALITY ---`);
  console.log(`  Avg Effective Edge: ${report.avgEffectiveEdge.toFixed(2)} pts`);
  console.log(`  Avg CLV: ${report.avgCLV !== null ? (report.avgCLV >= 0 ? '+' : '') + report.avgCLV.toFixed(2) + ' pts' : 'N/A'}`);
  console.log(`  CLV Capture Rate: ${report.clvCaptureRate !== null ? (report.clvCaptureRate * 100).toFixed(1) + '%' : 'N/A'}`);

  if (report.errors.length > 0) {
    console.log(`\n--- ERRORS ---`);
    for (const error of report.errors) {
      console.log(`  ${error}`);
    }
  }

  console.log(`${'='.repeat(60)}\n`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const season = args[0] ? parseInt(args[0]) : 2024;
  const week = args[1] ? parseInt(args[1]) : 2;
  const asOfTimestamp = new Date();

  console.log(`\n${'#'.repeat(60)}`);
  console.log(`CFB MARKET-EDGE: Week Pipeline`);
  console.log(`Season: ${season}, Week: ${week}`);
  console.log(`${'#'.repeat(60)}`);

  const allErrors: string[] = [];

  // Step 1: Create snapshot
  const { modelRunId, errors: snapshotErrors } = await createModelRunSnapshot(season, week, asOfTimestamp);
  allErrors.push(...snapshotErrors);

  // Step 2: Generate edges
  const { edges, errors: edgeErrors } = await generateEdges(season, week, modelRunId);
  allErrors.push(...edgeErrors);

  // Step 3: Generate bet records
  const { betsGenerated, errors: betErrors } = await generateBetRecords(season, week, modelRunId, edges);
  allErrors.push(...betErrors);

  // Step 4: Grade results
  const { wins, losses, pushes, profit, errors: gradeErrors } = await gradeResults(season, week, edges);
  allErrors.push(...gradeErrors);

  // Step 5: Compute CLV
  const { avgCLV, clvCaptureRate, errors: clvErrors } = await computeCLV(season, week, edges);
  allErrors.push(...clvErrors);

  // Update model run status
  await supabase
    .from('model_runs')
    .update({ status: allErrors.length === 0 ? 'completed' : 'failed' })
    .eq('id', modelRunId);

  // Generate and print report
  const report = generateReport(
    modelRunId,
    season,
    week,
    asOfTimestamp,
    edges,
    betsGenerated,
    wins,
    losses,
    pushes,
    profit,
    avgCLV,
    clvCaptureRate,
    allErrors
  );

  printReport(report);

  process.exit(allErrors.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
