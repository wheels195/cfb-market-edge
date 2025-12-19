/**
 * Walk-Forward Projection Engine
 *
 * Generates point-in-time projections for historical games and calculates CLV.
 *
 * KEY PRINCIPLE: At any point in time, the model may only use information
 * that would have been available at that moment.
 *
 * For each game:
 * 1. Look up team ratings from the PRIOR week (before game happened)
 * 2. Generate spread projection
 * 3. Compare to closing line
 * 4. Calculate CLV
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// CONFIGURATION
// =============================================================================
interface ProjectionParams {
  ratingToSpreadScale: number;  // Convert rating diff to points
  homeFieldAdvantage: number;   // HFA in points
}

const DEFAULT_PARAMS: ProjectionParams = {
  ratingToSpreadScale: 14,      // 1 point of rating diff ≈ 14 spread points
  homeFieldAdvantage: 2.5,      // Home team gets 2.5 points
};

interface GameProjection {
  eventId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  homeRating: number;
  awayRating: number;
  ratingDiff: number;
  projectedSpread: number;      // Positive = away favored, negative = home favored
  closingSpread: number | null; // Market spread (home perspective)
  clv: number | null;           // CLV in points
  actualMargin: number | null;  // Home score - Away score
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getTeamRatings(season: number): Promise<Map<string, Map<number, number>>> {
  // Get all team ratings for a season, keyed by team_id -> week -> rating
  const allData: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await supabase
      .from('team_ratings_history')
      .select('team_id, week, overall_rating')
      .eq('season', season)
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) break;
    allData.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  const ratings = new Map<string, Map<number, number>>();

  for (const row of allData) {
    if (!ratings.has(row.team_id)) {
      ratings.set(row.team_id, new Map());
    }
    ratings.get(row.team_id)!.set(row.week, row.overall_rating || 0);
  }

  return ratings;
}

function getSeasonFromDate(dateStr: string): number {
  const date = new Date(dateStr);
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();

  // CFB season runs August-January
  // Jan games are part of previous year's season (bowl games)
  if (month <= 1) { // Jan or Feb
    return year - 1;
  }
  return year;
}

async function getEventsWithClosingLines(season: number): Promise<any[]> {
  // Get completed events that have closing lines
  // Season is derived from commence_time
  const seasonStart = `${season}-08-01`;
  const seasonEnd = `${season + 1}-02-15`; // Include Jan bowl games

  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      commence_time,
      home_team_id,
      away_team_id,
      home_team:teams!events_home_team_id_fkey(id, name),
      away_team:teams!events_away_team_id_fkey(id, name),
      results(home_score, away_score)
    `)
    .eq('status', 'final')
    .gte('commence_time', seasonStart)
    .lte('commence_time', seasonEnd);

  if (!events) return [];

  // Get closing lines for these events (batch due to IN clause limit)
  const eventIds = events.map(e => e.id);
  const closingMap = new Map<string, number>();

  // Process in batches of 100 to avoid IN clause limits
  const batchSize = 100;
  for (let i = 0; i < eventIds.length; i += batchSize) {
    const batchIds = eventIds.slice(i, i + batchSize);

    const { data: closingLines } = await supabase
      .from('closing_lines')
      .select('event_id, spread_points_home')
      .in('event_id', batchIds)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .not('spread_points_home', 'is', null);

    for (const cl of closingLines || []) {
      // Use first closing line found for each event
      if (!closingMap.has(cl.event_id) && cl.spread_points_home !== null) {
        closingMap.set(cl.event_id, cl.spread_points_home);
      }
    }
  }

  console.log(`    Found closing lines for ${closingMap.size} events`);

  // Combine events with closing lines
  return events.map(e => ({
    ...e,
    closingSpread: closingMap.get(e.id) || null,
  }));
}

function getWeekFromDate(date: string, season: number): number {
  // Approximate week number from date
  // CFB season typically starts late August
  const gameDate = new Date(date);
  const seasonStart = new Date(`${season}-08-26`); // Approximate season start
  const daysDiff = Math.floor((gameDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.max(1, Math.ceil(daysDiff / 7));
  return Math.min(week, 16); // Cap at week 16
}

// =============================================================================
// PROJECTION LOGIC
// =============================================================================

function getRatingForWeek(
  ratings: Map<number, number> | undefined,
  week: number
): number | null {
  // Return null if no ratings available (likely FCS team)
  if (!ratings || ratings.size === 0) {
    return null;
  }

  // Get rating from PRIOR week (point-in-time)
  const priorWeek = Math.max(0, week - 1);

  // Try to get exact prior week rating
  if (ratings.has(priorWeek)) {
    return ratings.get(priorWeek)!;
  }

  // Fall back to most recent available rating before this week
  const availableWeeks = Array.from(ratings.keys()).sort((a, b) => b - a);
  for (const w of availableWeeks) {
    if (w < week) {
      return ratings.get(w)!;
    }
  }

  // Fall back to preseason (week 0)
  return ratings.get(0) || null;
}

function generateProjection(
  homeRating: number,
  awayRating: number,
  params: ProjectionParams
): number {
  // Rating difference (home - away)
  const ratingDiff = homeRating - awayRating;

  // Convert to spread points
  // If home is better (positive diff), spread should be negative (home favored)
  const spreadFromRating = -ratingDiff * params.ratingToSpreadScale;

  // Add home field advantage (makes home more favored = more negative spread)
  const projectedSpread = spreadFromRating - params.homeFieldAdvantage;

  return projectedSpread;
}

function calculateCLV(
  projectedSpread: number,
  closingSpread: number
): number {
  // CLV = Model projection - Closing line
  // Positive CLV = we projected home team worse than market closed
  //              = if we bet the spread early, we got value
  //
  // Example:
  //   Projected: Home -4.0
  //   Closing: Home -7.0
  //   CLV = -4.0 - (-7.0) = +3.0
  //   Interpretation: Market moved 3 points toward home, we "captured" that value
  return projectedSpread - closingSpread;
}

// =============================================================================
// MAIN ENGINE
// =============================================================================

async function runWalkForward(
  seasons: number[],
  params: ProjectionParams = DEFAULT_PARAMS
): Promise<GameProjection[]> {

  const allProjections: GameProjection[] = [];

  for (const season of seasons) {
    console.log(`\n=== Season ${season} ===`);

    // Load team ratings for this season
    const ratings = await getTeamRatings(season);
    console.log(`  Loaded ratings for ${ratings.size} teams`);

    // Get events with closing lines
    const events = await getEventsWithClosingLines(season);
    console.log(`  Found ${events.length} completed events`);

    let projectedCount = 0;
    let withCLV = 0;

    for (const event of events) {
      const homeTeam = event.home_team as { id: string; name: string };
      const awayTeam = event.away_team as { id: string; name: string };
      const results = event.results as { home_score: number; away_score: number } | null;

      if (!homeTeam?.id || !awayTeam?.id) continue;

      // Get week number from game date
      const week = getWeekFromDate(event.commence_time, season);

      // Get ratings from PRIOR week (point-in-time)
      const homeRatings = ratings.get(event.home_team_id);
      const awayRatings = ratings.get(event.away_team_id);

      const homeRating = getRatingForWeek(homeRatings, week);
      const awayRating = getRatingForWeek(awayRatings, week);

      // Skip games where either team has no rating (likely FCS)
      if (homeRating === null || awayRating === null) {
        continue;
      }

      // Generate projection
      const projectedSpread = generateProjection(homeRating, awayRating, params);

      // Calculate CLV if we have closing line
      let clv: number | null = null;
      if (event.closingSpread !== null) {
        clv = calculateCLV(projectedSpread, event.closingSpread);
        withCLV++;
      }

      // Get actual margin
      let actualMargin: number | null = null;
      if (results && results.home_score !== null && results.away_score !== null) {
        actualMargin = results.home_score - results.away_score;
      }

      const projection: GameProjection = {
        eventId: event.id,
        season,
        week,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        homeTeamId: event.home_team_id,
        awayTeamId: event.away_team_id,
        homeRating,
        awayRating,
        ratingDiff: homeRating - awayRating,
        projectedSpread,
        closingSpread: event.closingSpread,
        clv,
        actualMargin,
      };

      allProjections.push(projection);
      projectedCount++;
    }

    console.log(`  Generated ${projectedCount} projections (${withCLV} with CLV)`);
  }

  return allProjections;
}

// =============================================================================
// METRICS
// =============================================================================

function calculateMetrics(projections: GameProjection[]): {
  totalGames: number;
  gamesWithCLV: number;
  meanCLV: number;
  stdCLV: number;
  clvPositiveRate: number;
  mae: number;
  correlation: number;
} {
  const withCLV = projections.filter(p => p.clv !== null);
  const withMargin = projections.filter(p => p.actualMargin !== null && p.projectedSpread !== null);

  if (withCLV.length === 0) {
    return {
      totalGames: projections.length,
      gamesWithCLV: 0,
      meanCLV: 0,
      stdCLV: 0,
      clvPositiveRate: 0,
      mae: 0,
      correlation: 0,
    };
  }

  const clvValues = withCLV.map(p => p.clv!);
  const meanCLV = clvValues.reduce((a, b) => a + b, 0) / clvValues.length;
  const variance = clvValues.reduce((sum, v) => sum + Math.pow(v - meanCLV, 2), 0) / clvValues.length;
  const stdCLV = Math.sqrt(variance);
  const clvPositiveRate = clvValues.filter(v => v > 0).length / clvValues.length;

  // Calculate MAE vs actual margin
  let mae = 0;
  if (withMargin.length > 0) {
    const errors = withMargin.map(p => Math.abs(p.projectedSpread - p.actualMargin!));
    mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  }

  // Calculate correlation between projected spread and actual margin
  let correlation = 0;
  if (withMargin.length > 1) {
    const projected = withMargin.map(p => p.projectedSpread);
    const actual = withMargin.map(p => p.actualMargin!);
    const meanProj = projected.reduce((a, b) => a + b, 0) / projected.length;
    const meanAct = actual.reduce((a, b) => a + b, 0) / actual.length;

    let num = 0, denomProj = 0, denomAct = 0;
    for (let i = 0; i < projected.length; i++) {
      num += (projected[i] - meanProj) * (actual[i] - meanAct);
      denomProj += Math.pow(projected[i] - meanProj, 2);
      denomAct += Math.pow(actual[i] - meanAct, 2);
    }
    correlation = num / (Math.sqrt(denomProj) * Math.sqrt(denomAct));
  }

  return {
    totalGames: projections.length,
    gamesWithCLV: withCLV.length,
    meanCLV,
    stdCLV,
    clvPositiveRate,
    mae,
    correlation,
  };
}

// =============================================================================
// SAVE RESULTS
// =============================================================================

async function saveProjections(projections: GameProjection[]): Promise<void> {
  console.log('\nSaving projections to clv_tracking table...');

  // Clear existing data
  const seasons = [...new Set(projections.map(p => p.season))];
  for (const season of seasons) {
    await supabase
      .from('clv_tracking')
      .delete()
      .eq('season', season);
  }

  // Prepare rows
  const rows = projections.map(p => ({
    event_id: p.eventId,
    season: p.season,
    week: p.week,
    projected_spread: p.projectedSpread,
    closing_spread: p.closingSpread,
    clv_spread: p.clv,
    actual_margin: p.actualMargin,
    spread_result: p.actualMargin !== null && p.closingSpread !== null
      ? determineSpreadResult(p.projectedSpread, p.closingSpread, p.actualMargin)
      : null,
  }));

  // Insert in batches
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('clv_tracking')
      .insert(batch);

    if (error) {
      console.log(`  Error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Saved ${inserted} projections`);
}

function determineSpreadResult(
  projected: number,
  closing: number,
  actualMargin: number
): string {
  // If our projection was better than closing, which side did we suggest?
  // projected < closing means we projected home as more of a favorite
  const betHome = projected < closing;

  // Did home cover? Home covers if actual margin > spread (negative spread = favorite)
  // e.g., spread -7, home wins by 10: 10 > -7 means home covered
  const homeCovered = actualMargin > closing;

  if (actualMargin === closing) return 'push';

  if (betHome) {
    return homeCovered ? 'win' : 'loss';
  } else {
    return homeCovered ? 'loss' : 'win';
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const seasons = args.length > 0
    ? args.map(Number)
    : [2022, 2023, 2024];

  console.log('=== WALK-FORWARD PROJECTION ENGINE ===');
  console.log(`Seasons: ${seasons.join(', ')}`);
  console.log('\nParameters:');
  console.log(JSON.stringify(DEFAULT_PARAMS, null, 2));

  // Run walk-forward
  const projections = await runWalkForward(seasons, DEFAULT_PARAMS);

  // Calculate overall metrics
  console.log('\n=== OVERALL METRICS ===');
  const overall = calculateMetrics(projections);
  console.log(`  Total games: ${overall.totalGames}`);
  console.log(`  Games with CLV: ${overall.gamesWithCLV}`);
  console.log(`  Mean CLV: ${overall.meanCLV.toFixed(2)} points`);
  console.log(`  Std CLV: ${overall.stdCLV.toFixed(2)}`);
  console.log(`  CLV+ Rate: ${(overall.clvPositiveRate * 100).toFixed(1)}%`);
  console.log(`  MAE vs Actual: ${overall.mae.toFixed(2)} points`);
  console.log(`  Correlation: ${overall.correlation.toFixed(3)}`);

  // Per-season metrics
  console.log('\n=== PER-SEASON METRICS ===');
  for (const season of seasons) {
    const seasonProj = projections.filter(p => p.season === season);
    const metrics = calculateMetrics(seasonProj);

    console.log(`\n  ${season}:`);
    console.log(`    Games: ${metrics.totalGames} (${metrics.gamesWithCLV} with CLV)`);
    console.log(`    Mean CLV: ${metrics.meanCLV.toFixed(2)} pts`);
    console.log(`    CLV+ Rate: ${(metrics.clvPositiveRate * 100).toFixed(1)}%`);
    console.log(`    MAE: ${metrics.mae.toFixed(2)} pts`);
    console.log(`    Correlation: ${metrics.correlation.toFixed(3)}`);
  }

  // Show sample projections
  console.log('\n=== SAMPLE PROJECTIONS (with highest CLV) ===');
  const withCLV = projections
    .filter(p => p.clv !== null)
    .sort((a, b) => Math.abs(b.clv!) - Math.abs(a.clv!));

  console.log('\nTop 10 highest absolute CLV games:');
  console.log('Season | Week | Matchup                               | Proj   | Close  | CLV    | Margin');
  console.log('-------|------|---------------------------------------|--------|--------|--------|-------');

  for (const p of withCLV.slice(0, 10)) {
    const matchup = `${p.awayTeam} @ ${p.homeTeam}`.substring(0, 37).padEnd(37);
    const projStr = p.projectedSpread >= 0 ? `+${p.projectedSpread.toFixed(1)}` : p.projectedSpread.toFixed(1);
    const closeStr = p.closingSpread !== null
      ? (p.closingSpread >= 0 ? `+${p.closingSpread.toFixed(1)}` : p.closingSpread.toFixed(1))
      : 'N/A';
    const clvStr = p.clv !== null
      ? (p.clv >= 0 ? `+${p.clv.toFixed(1)}` : p.clv.toFixed(1))
      : 'N/A';
    const marginStr = p.actualMargin !== null
      ? (p.actualMargin >= 0 ? `+${p.actualMargin}` : p.actualMargin.toString())
      : 'N/A';

    console.log(
      `${p.season}   | ${p.week.toString().padStart(4)} | ${matchup} | ${projStr.padStart(6)} | ${closeStr.padStart(6)} | ${clvStr.padStart(6)} | ${marginStr.padStart(6)}`
    );
  }

  // Save to database
  await saveProjections(projections);

  console.log('\n=== WALK-FORWARD COMPLETE ===');
}

main().catch(console.error);
