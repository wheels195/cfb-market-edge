/**
 * Walk-Forward Engine V2
 *
 * Uses the improved ratings from rating-engine-v2.ts
 * Projects games using point-in-time ratings (prior week)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface ProjectionParams {
  ratingToSpreadScale: number;
  homeFieldAdvantage: number;
}

const DEFAULT_PARAMS: ProjectionParams = {
  ratingToSpreadScale: 1.0,    // Ratings are in SP+ scale (already spread-like)
  homeFieldAdvantage: 2.5,
};

interface GameProjection {
  eventId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeRating: number;
  awayRating: number;
  projectedSpread: number;
  closingSpread: number | null;
  clv: number | null;
  actualMargin: number | null;
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getRatingsForSeason(season: number): Promise<Map<string, Map<number, number>>> {
  // Get all ratings for this season, grouped by team -> week -> rating
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
    ratings.get(row.team_id)!.set(row.week, row.overall_rating);
  }

  return ratings;
}

async function getEventsForSeason(season: number): Promise<any[]> {
  const seasonStart = `${season}-08-01`;
  const seasonEnd = `${season + 1}-02-15`;

  const allEvents: any[] = [];
  let offset = 0;
  const pageSize = 500;

  while (true) {
    const { data } = await supabase
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
      .lte('commence_time', seasonEnd)
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) break;
    allEvents.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  // Get closing lines in batches
  const eventIds = allEvents.map(e => e.id);
  const closingMap = new Map<string, number>();

  for (let i = 0; i < eventIds.length; i += 100) {
    const batchIds = eventIds.slice(i, i + 100);
    const { data: closingLines } = await supabase
      .from('closing_lines')
      .select('event_id, spread_points_home')
      .in('event_id', batchIds)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .not('spread_points_home', 'is', null);

    for (const cl of closingLines || []) {
      if (!closingMap.has(cl.event_id)) {
        closingMap.set(cl.event_id, cl.spread_points_home);
      }
    }
  }

  return allEvents.map(e => ({
    ...e,
    closingSpread: closingMap.get(e.id) || null,
  }));
}

function getWeekFromDate(date: string, season: number): number {
  const gameDate = new Date(date);
  const seasonStart = new Date(`${season}-08-26`);
  const daysDiff = Math.floor((gameDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(16, Math.ceil(daysDiff / 7)));
}

function getRatingForWeek(ratings: Map<number, number> | undefined, week: number): number | null {
  if (!ratings || ratings.size === 0) return null;

  // Get rating from PRIOR week
  const priorWeek = Math.max(0, week - 1);
  if (ratings.has(priorWeek)) return ratings.get(priorWeek)!;

  // Fall back to most recent available
  const weeks = Array.from(ratings.keys()).sort((a, b) => b - a);
  for (const w of weeks) {
    if (w < week) return ratings.get(w)!;
  }

  return ratings.get(0) || null;
}

// =============================================================================
// MAIN ENGINE
// =============================================================================

async function runWalkForward(seasons: number[], params: ProjectionParams): Promise<GameProjection[]> {
  const allProjections: GameProjection[] = [];

  for (const season of seasons) {
    console.log(`\n=== Season ${season} ===`);

    const ratings = await getRatingsForSeason(season);
    console.log(`  Loaded ratings for ${ratings.size} teams`);

    const events = await getEventsForSeason(season);
    console.log(`  Found ${events.length} events`);

    let projected = 0;
    let withCLV = 0;
    let skipped = 0;

    for (const event of events) {
      const homeTeam = event.home_team as { id: string; name: string };
      const awayTeam = event.away_team as { id: string; name: string };
      const results = event.results as { home_score: number; away_score: number } | null;

      if (!homeTeam?.id || !awayTeam?.id) continue;

      const week = getWeekFromDate(event.commence_time, season);
      const homeRating = getRatingForWeek(ratings.get(event.home_team_id), week);
      const awayRating = getRatingForWeek(ratings.get(event.away_team_id), week);

      // Skip if either team has no rating
      if (homeRating === null || awayRating === null) {
        skipped++;
        continue;
      }

      // Project spread
      const ratingDiff = homeRating - awayRating;
      const projectedSpread = -ratingDiff * params.ratingToSpreadScale - params.homeFieldAdvantage;

      let clv: number | null = null;
      if (event.closingSpread !== null) {
        clv = projectedSpread - event.closingSpread;
        withCLV++;
      }

      let actualMargin: number | null = null;
      if (results?.home_score !== undefined && results?.away_score !== undefined) {
        actualMargin = results.home_score - results.away_score;
      }

      allProjections.push({
        eventId: event.id,
        season,
        week,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        homeRating,
        awayRating,
        projectedSpread,
        closingSpread: event.closingSpread,
        clv,
        actualMargin,
      });

      projected++;
    }

    console.log(`  Projected: ${projected} | With CLV: ${withCLV} | Skipped: ${skipped}`);
  }

  return allProjections;
}

// =============================================================================
// METRICS
// =============================================================================

function calculateMetrics(projections: GameProjection[]) {
  const withCLV = projections.filter(p => p.clv !== null);
  const withMargin = projections.filter(p => p.actualMargin !== null);

  if (withCLV.length === 0) {
    return { totalGames: projections.length, gamesWithCLV: 0, meanCLV: 0, stdCLV: 0, clvPositiveRate: 0, mae: 0, rmse: 0, correlation: 0 };
  }

  const clvValues = withCLV.map(p => p.clv!);
  const meanCLV = clvValues.reduce((a, b) => a + b, 0) / clvValues.length;
  const variance = clvValues.reduce((sum, v) => sum + Math.pow(v - meanCLV, 2), 0) / clvValues.length;
  const stdCLV = Math.sqrt(variance);
  const clvPositiveRate = clvValues.filter(v => v > 0).length / clvValues.length;

  let mae = 0, rmse = 0;
  if (withMargin.length > 0) {
    const errors = withMargin.map(p => p.projectedSpread - p.actualMargin!);
    mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
    rmse = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  }

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
    if (denomProj > 0 && denomAct > 0) {
      correlation = num / (Math.sqrt(denomProj) * Math.sqrt(denomAct));
    }
  }

  return { totalGames: projections.length, gamesWithCLV: withCLV.length, meanCLV, stdCLV, clvPositiveRate, mae, rmse, correlation };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const seasons = [2023, 2024];

  console.log('=== WALK-FORWARD ENGINE V2 ===');
  console.log(`Seasons: ${seasons.join(', ')}`);
  console.log('\nUsing improved ratings with SP+ base + weekly PPA updates');
  console.log('\nParameters:');
  console.log(JSON.stringify(DEFAULT_PARAMS, null, 2));

  const projections = await runWalkForward(seasons, DEFAULT_PARAMS);

  console.log('\n=== OVERALL METRICS ===');
  const overall = calculateMetrics(projections);
  console.log(`  Total games: ${overall.totalGames}`);
  console.log(`  Games with CLV: ${overall.gamesWithCLV}`);
  console.log(`  Mean CLV: ${overall.meanCLV.toFixed(2)} points`);
  console.log(`  CLV+ Rate: ${(overall.clvPositiveRate * 100).toFixed(1)}%`);
  console.log(`  MAE: ${overall.mae.toFixed(2)} points`);
  console.log(`  RMSE: ${overall.rmse.toFixed(2)} points`);
  console.log(`  Correlation: ${overall.correlation.toFixed(3)}`);

  console.log('\n=== PER-SEASON ===');
  for (const season of seasons) {
    const seasonProj = projections.filter(p => p.season === season);
    const m = calculateMetrics(seasonProj);
    console.log(`\n  ${season}:`);
    console.log(`    Games: ${m.totalGames} (${m.gamesWithCLV} with CLV)`);
    console.log(`    Mean CLV: ${m.meanCLV.toFixed(2)} | CLV+: ${(m.clvPositiveRate * 100).toFixed(1)}%`);
    console.log(`    MAE: ${m.mae.toFixed(2)} | Corr: ${m.correlation.toFixed(3)}`);
  }

  // Sample projections
  const withCLV = projections.filter(p => p.clv !== null);
  const byAbsCLV = withCLV.sort((a, b) => Math.abs(b.clv!) - Math.abs(a.clv!));

  console.log('\n=== TOP 15 BY ABSOLUTE CLV ===');
  console.log('Matchup                                  | Model  | Close  | CLV    | Actual');
  console.log('-----------------------------------------|--------|--------|--------|-------');

  for (const p of byAbsCLV.slice(0, 15)) {
    const matchup = `${p.awayTeam} @ ${p.homeTeam}`.substring(0, 40).padEnd(40);
    const modelStr = p.projectedSpread >= 0 ? `+${p.projectedSpread.toFixed(1)}` : p.projectedSpread.toFixed(1);
    const closeStr = p.closingSpread !== null
      ? (p.closingSpread >= 0 ? `+${p.closingSpread.toFixed(1)}` : p.closingSpread.toFixed(1))
      : 'N/A';
    const clvStr = p.clv !== null
      ? (p.clv >= 0 ? `+${p.clv.toFixed(1)}` : p.clv.toFixed(1))
      : 'N/A';
    const actualStr = p.actualMargin !== null
      ? (p.actualMargin >= 0 ? `+${p.actualMargin}` : p.actualMargin.toString())
      : 'N/A';

    console.log(`${matchup} | ${modelStr.padStart(6)} | ${closeStr.padStart(6)} | ${clvStr.padStart(6)} | ${actualStr.padStart(6)}`);
  }

  console.log('\n=== COMPLETE ===');
}

main().catch(console.error);
