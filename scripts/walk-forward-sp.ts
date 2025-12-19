/**
 * Walk-Forward Projection Engine using SP+ Ratings
 *
 * Uses PRIOR SEASON's SP+ ratings to avoid look-ahead bias.
 * For week 1 of season N, we use season N-1's SP+ ratings.
 *
 * As the season progresses, we continue using prior-season SP+
 * because current-season SP+ reflects games we're trying to predict.
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
  spDiffScale: number;          // How much 1 point of SP+ diff moves the spread
  homeFieldAdvantage: number;   // HFA in points
}

const DEFAULT_PARAMS: ProjectionParams = {
  spDiffScale: 1.0,            // SP+ is already in point-spread scale
  homeFieldAdvantage: 2.5,     // Home team gets 2.5 points
};

interface GameProjection {
  eventId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeSP: number;
  awaySP: number;
  projectedSpread: number;      // Positive = away favored, negative = home favored
  closingSpread: number | null;
  clv: number | null;
  actualMargin: number | null;
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getSPRatings(season: number): Promise<Map<string, number>> {
  // Get SP+ ratings for a season
  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, sp_overall')
    .eq('season', season)
    .not('sp_overall', 'is', null);

  const map = new Map<string, number>();
  for (const row of data || []) {
    map.set(row.team_id, row.sp_overall);
  }

  return map;
}

async function getEventsForSeason(season: number): Promise<any[]> {
  const seasonStart = `${season}-08-01`;
  const seasonEnd = `${season + 1}-02-15`;

  // Paginate to get all events
  const allEvents: any[] = [];
  let offset = 0;
  const pageSize = 500;

  while (true) {
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
      .lte('commence_time', seasonEnd)
      .range(offset, offset + pageSize - 1);

    if (!events || events.length === 0) break;
    allEvents.push(...events);
    offset += pageSize;
    if (events.length < pageSize) break;
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
  const week = Math.max(1, Math.ceil(daysDiff / 7));
  return Math.min(week, 16);
}

// =============================================================================
// PROJECTION LOGIC
// =============================================================================

function generateProjection(
  homeSP: number,
  awaySP: number,
  params: ProjectionParams
): number {
  // SP+ diff: positive means home is better
  const spDiff = homeSP - awaySP;

  // Convert to spread (negative spread = home favored)
  // If home has higher SP+, they should be favored (negative spread)
  const spreadFromSP = -spDiff * params.spDiffScale;

  // Apply HFA (makes spread more negative, favoring home)
  return spreadFromSP - params.homeFieldAdvantage;
}

function calculateCLV(projected: number, closing: number): number {
  return projected - closing;
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

    // Use PRIOR season's SP+ to avoid look-ahead bias
    const priorSeason = season - 1;
    const spRatings = await getSPRatings(priorSeason);
    console.log(`  Loaded ${spRatings.size} SP+ ratings from ${priorSeason}`);

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

      const homeSP = spRatings.get(event.home_team_id);
      const awaySP = spRatings.get(event.away_team_id);

      // Skip games where either team has no SP+ (likely FCS)
      if (homeSP === undefined || awaySP === undefined) {
        skipped++;
        continue;
      }

      const week = getWeekFromDate(event.commence_time, season);
      const projectedSpread = generateProjection(homeSP, awaySP, params);

      let clv: number | null = null;
      if (event.closingSpread !== null) {
        clv = calculateCLV(projectedSpread, event.closingSpread);
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
        homeSP,
        awaySP,
        projectedSpread,
        closingSpread: event.closingSpread,
        clv,
        actualMargin,
      });

      projected++;
    }

    console.log(`  Projected: ${projected} | With CLV: ${withCLV} | Skipped (no SP+): ${skipped}`);
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
  rmse: number;
  correlation: number;
} {
  const withCLV = projections.filter(p => p.clv !== null);
  const withMargin = projections.filter(p => p.actualMargin !== null);

  if (withCLV.length === 0) {
    return {
      totalGames: projections.length,
      gamesWithCLV: 0,
      meanCLV: 0,
      stdCLV: 0,
      clvPositiveRate: 0,
      mae: 0,
      rmse: 0,
      correlation: 0,
    };
  }

  const clvValues = withCLV.map(p => p.clv!);
  const meanCLV = clvValues.reduce((a, b) => a + b, 0) / clvValues.length;
  const variance = clvValues.reduce((sum, v) => sum + Math.pow(v - meanCLV, 2), 0) / clvValues.length;
  const stdCLV = Math.sqrt(variance);
  const clvPositiveRate = clvValues.filter(v => v > 0).length / clvValues.length;

  // MAE and RMSE vs actual margin
  let mae = 0, rmse = 0;
  if (withMargin.length > 0) {
    const errors = withMargin.map(p => p.projectedSpread - p.actualMargin!);
    mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
    rmse = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  }

  // Correlation
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

  return {
    totalGames: projections.length,
    gamesWithCLV: withCLV.length,
    meanCLV,
    stdCLV,
    clvPositiveRate,
    mae,
    rmse,
    correlation,
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const seasons = args.length > 0 ? args.map(Number) : [2022, 2023, 2024];

  console.log('=== WALK-FORWARD ENGINE (SP+ Based) ===');
  console.log(`Seasons: ${seasons.join(', ')}`);
  console.log('\nUsing PRIOR season SP+ ratings to avoid look-ahead bias');
  console.log('\nParameters:');
  console.log(JSON.stringify(DEFAULT_PARAMS, null, 2));

  const projections = await runWalkForward(seasons, DEFAULT_PARAMS);

  // Overall metrics
  console.log('\n=== OVERALL METRICS ===');
  const overall = calculateMetrics(projections);
  console.log(`  Total games: ${overall.totalGames}`);
  console.log(`  Games with CLV: ${overall.gamesWithCLV}`);
  console.log(`  Mean CLV: ${overall.meanCLV.toFixed(2)} points`);
  console.log(`  Std CLV: ${overall.stdCLV.toFixed(2)}`);
  console.log(`  CLV+ Rate: ${(overall.clvPositiveRate * 100).toFixed(1)}%`);
  console.log(`  MAE: ${overall.mae.toFixed(2)} points`);
  console.log(`  RMSE: ${overall.rmse.toFixed(2)} points`);
  console.log(`  Correlation (proj vs actual): ${overall.correlation.toFixed(3)}`);

  // Per-season metrics
  console.log('\n=== PER-SEASON METRICS ===');
  for (const season of seasons) {
    const seasonProj = projections.filter(p => p.season === season);
    const metrics = calculateMetrics(seasonProj);

    console.log(`\n  ${season} (using ${season - 1} SP+):`);
    console.log(`    Games: ${metrics.totalGames} (${metrics.gamesWithCLV} with CLV)`);
    console.log(`    Mean CLV: ${metrics.meanCLV.toFixed(2)} pts`);
    console.log(`    CLV+ Rate: ${(metrics.clvPositiveRate * 100).toFixed(1)}%`);
    console.log(`    MAE: ${metrics.mae.toFixed(2)} pts`);
    console.log(`    Correlation: ${metrics.correlation.toFixed(3)}`);
  }

  // Sample projections with highest edge
  const withCLV = projections.filter(p => p.clv !== null);
  const byAbsCLV = withCLV.sort((a, b) => Math.abs(b.clv!) - Math.abs(a.clv!));

  console.log('\n=== TOP 10 BY ABSOLUTE CLV ===');
  console.log('Season | Matchup                                | Model  | Close  | CLV    | Actual');
  console.log('-------|----------------------------------------|--------|--------|--------|-------');

  for (const p of byAbsCLV.slice(0, 10)) {
    const matchup = `${p.awayTeam} @ ${p.homeTeam}`.substring(0, 38).padEnd(38);
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

    console.log(`${p.season}   | ${matchup} | ${modelStr.padStart(6)} | ${closeStr.padStart(6)} | ${clvStr.padStart(6)} | ${actualStr.padStart(6)}`);
  }

  console.log('\n=== WALK-FORWARD COMPLETE ===');
}

main().catch(console.error);
