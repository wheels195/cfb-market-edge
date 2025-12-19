import { supabase } from '@/lib/db/client';
import { MarketType, Projection } from '@/types/database';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';
import { CFBDWeather, WeatherImpact } from '@/types/cfbd-api';
import { analyzeWeatherImpact, getWeatherWarnings, weatherExplainsLargeEdge } from '@/lib/models/weather-analysis';
import {
  getReturningProduction,
  calculateReturningProductionAdjustment,
  ReturningProductionData,
  PlayerFactorAdjustment,
} from '@/lib/backtest/player-factors';
import {
  getTeamInjuries,
  analyzeInjuryImpact,
  initializeInjuryData,
  isInjuryCacheStale,
  InjuryImpact,
} from '@/lib/models/injury-analysis';
import {
  analyzeLineMovement,
  betAlignsWithSharps,
  LineMovementImpact,
} from '@/lib/models/line-movement';
import { getRecencyWeightedSpread, DEFAULT_ELO_CONFIG } from '@/lib/models/elo';
import { getPaceAdjustment, getEfficiencyMatchup } from '@/lib/jobs/sync-advanced-stats';
import { calculateSituationalAdjustment } from '@/lib/models/situational';
import {
  calculateConferenceAdjustment,
  getBowlGameAdjustment,
} from '@/lib/models/conference-strength';
import {
  generateSpreadProjection,
  generateTotalProjection,
  DEFAULT_COEFFICIENTS,
  MarketCalibratedProjection,
} from '@/lib/models/market-calibrated-model';

// Enhanced model factor weights (tuned from backtesting)
const ENHANCED_WEIGHTS = {
  recencyElo: 0.2,      // Recency adjustment amplification
  pace: 0.8,            // Pace impact on totals
  efficiency: 0.3,      // PPA matchup on spreads
  situational: 0.6,     // Travel/rest/rivalry
  conference: 1.0,      // Conference strength (full weight - critical factor)
  bowlGame: 1.0,        // Bowl game adjustments
};

export interface MaterializeEdgesResult {
  edgesCreated: number;
  edgesUpdated: number;
  oddsCoverage: {
    totalEvents: number;
    dkSpreadCoverage: number;
    fdSpreadCoverage: number;
    dkTotalCoverage: number;
    fdTotalCoverage: number;
    passed: boolean;
  } | null;
  errors: string[];
}

// Odds coverage configuration
const COVERAGE_CONFIG = {
  MIN_COVERAGE_PCT: 0.85,  // 85% of events must have odds
  REQUIRED_BOOKS: ['draftkings', 'fanduel'],
  REQUIRED_MARKETS: ['spread', 'total'] as const,
};

// Pipeline window configuration
const WINDOW_CONFIG = {
  LOOKAHEAD_DAYS: 10,  // Only process events within 10 days
};

// Calibration data from 2022-2025 backtest analysis (updated Dec 2025)
// Win probabilities based on edge size from actual historical results
const CALIBRATION = {
  // Edge range -> Win probability (from backtest: 2022-2025, 2495 games)
  edgeProbabilities: [
    { min: 2.5, max: 3, winProb: 0.595, ev: 13.64, tier: 'very-high' as const }, // 59.5% win, +13.6% ROI
    { min: 3, max: 4, winProb: 0.558, ev: 6.61, tier: 'high' as const },         // 55.8% win, +6.6% ROI
    { min: 4, max: 5, winProb: 0.548, ev: 4.55, tier: 'medium' as const },       // 54.8% win, +4.5% ROI
  ],
  // Profitable filter: edge 2.5-5 pts (5+ loses money)
  profitableFilter: {
    minEdge: 2.5,
    maxEdge: 5,
  },
  // Default for edges outside calibrated range
  defaultLow: { winProb: 0.49, ev: -7.00, tier: 'skip' as const },  // <2.5 pts: unprofitable
  defaultHigh: { winProb: 0.46, ev: -11.00, tier: 'skip' as const }, // 5+ pts: model errors, unprofitable
};

function getCalibrationData(absEdge: number): {
  winProbability: number;
  expectedValue: number;
  confidenceTier: 'very-high' | 'high' | 'medium' | 'low' | 'skip';
  qualifies: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check if edge qualifies for profitable betting
  const qualifies = absEdge >= CALIBRATION.profitableFilter.minEdge &&
                   absEdge < CALIBRATION.profitableFilter.maxEdge;

  // Add warnings for edge size (updated based on 2022-2025 backtest)
  if (absEdge >= 10) {
    warnings.push('LARGE_EDGE: Model disagrees with market by 10+ pts - likely model error');
  } else if (absEdge >= 5) {
    warnings.push('CAUTION: Edge 5+ pts historically unprofitable - model may be missing factors');
  } else if (absEdge < 2.5) {
    warnings.push('SMALL_EDGE: Edge under 2.5 pts may not overcome the vig');
  }

  // Find matching calibration bucket
  for (const bucket of CALIBRATION.edgeProbabilities) {
    if (absEdge >= bucket.min && absEdge < bucket.max) {
      return {
        winProbability: Math.round(bucket.winProb * 1000) / 10,
        expectedValue: bucket.ev,
        confidenceTier: bucket.tier,
        qualifies,
        warnings,
      };
    }
  }

  // Edge too small (< 2.5)
  if (absEdge < CALIBRATION.profitableFilter.minEdge) {
    return {
      winProbability: 49,
      expectedValue: -7.00,
      confidenceTier: 'low',
      qualifies: false,
      warnings,
    };
  }

  // Edge too large (>= 5) - historically unprofitable
  return {
    winProbability: 46,
    expectedValue: -11.00,
    confidenceTier: 'skip',
    qualifies: false,
    warnings,
  };
}

/**
 * Edge calculation formulas (from spec):
 *
 * Spreads:
 *   edge_points = market_spread_home - model_spread_home
 *   If edge > 0 → Bet Home at market number
 *   If edge < 0 → Bet Away at market number
 *
 * Totals:
 *   edge_points = market_total_points - model_total_points
 *   If edge > 0 → Bet Under
 *   If edge < 0 → Bet Over
 */

/**
 * Calculate week number from game date
 */
function getWeekNumber(gameDate: Date, season: number): number {
  // CFB season typically starts last week of August (Week 0/1)
  // Week 1 is usually Labor Day weekend (first Monday in September)
  const seasonStart = new Date(season, 7, 25); // August 25
  const diffDays = Math.floor((gameDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(week, 15)); // Clamp between 1-15
}

/**
 * Materialize edges for all upcoming events
 */
/**
 * Check odds coverage before materializing edges
 * Returns coverage stats and whether the gate passed
 */
async function checkOddsCoverage(eventIds: string[]): Promise<{
  totalEvents: number;
  dkSpreadCoverage: number;
  fdSpreadCoverage: number;
  dkTotalCoverage: number;
  fdTotalCoverage: number;
  passed: boolean;
}> {
  const totalEvents = eventIds.length;
  if (totalEvents === 0) {
    return { totalEvents: 0, dkSpreadCoverage: 1, fdSpreadCoverage: 1, dkTotalCoverage: 1, fdTotalCoverage: 1, passed: true };
  }

  // Get sportsbook IDs
  const { data: sportsbooks } = await supabase
    .from('sportsbooks')
    .select('id, key')
    .in('key', COVERAGE_CONFIG.REQUIRED_BOOKS);

  if (!sportsbooks || sportsbooks.length === 0) {
    console.warn('[Coverage] No sportsbooks found');
    return { totalEvents, dkSpreadCoverage: 0, fdSpreadCoverage: 0, dkTotalCoverage: 0, fdTotalCoverage: 0, passed: false };
  }

  const dkId = sportsbooks.find(s => s.key === 'draftkings')?.id;
  const fdId = sportsbooks.find(s => s.key === 'fanduel')?.id;

  // Count events with recent odds (within last 2 hours) for each book/market combo
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  async function countCoverage(sportsbookId: string | undefined, marketType: string): Promise<number> {
    if (!sportsbookId) return 0;

    const { data } = await supabase
      .from('odds_ticks')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('sportsbook_id', sportsbookId)
      .eq('market_type', marketType)
      .gte('captured_at', twoHoursAgo);

    const uniqueEvents = new Set((data || []).map(t => t.event_id));
    return uniqueEvents.size;
  }

  const [dkSpread, fdSpread, dkTotal, fdTotal] = await Promise.all([
    countCoverage(dkId, 'spread'),
    countCoverage(fdId, 'spread'),
    countCoverage(dkId, 'total'),
    countCoverage(fdId, 'total'),
  ]);

  const dkSpreadCoverage = dkSpread / totalEvents;
  const fdSpreadCoverage = fdSpread / totalEvents;
  const dkTotalCoverage = dkTotal / totalEvents;
  const fdTotalCoverage = fdTotal / totalEvents;

  // Pass if both books have spread coverage >= threshold
  // (totals are less critical since we use market-calibrated model)
  const spreadsPassed = dkSpreadCoverage >= COVERAGE_CONFIG.MIN_COVERAGE_PCT &&
                        fdSpreadCoverage >= COVERAGE_CONFIG.MIN_COVERAGE_PCT;

  console.log(`[Coverage] DK spread: ${(dkSpreadCoverage * 100).toFixed(1)}%, FD spread: ${(fdSpreadCoverage * 100).toFixed(1)}%`);
  console.log(`[Coverage] DK total: ${(dkTotalCoverage * 100).toFixed(1)}%, FD total: ${(fdTotalCoverage * 100).toFixed(1)}%`);
  console.log(`[Coverage] Gate ${spreadsPassed ? 'PASSED' : 'FAILED'} (threshold: ${COVERAGE_CONFIG.MIN_COVERAGE_PCT * 100}%)`);

  return {
    totalEvents,
    dkSpreadCoverage,
    fdSpreadCoverage,
    dkTotalCoverage,
    fdTotalCoverage,
    passed: spreadsPassed,
  };
}

export async function materializeEdges(): Promise<MaterializeEdgesResult> {
  const result: MaterializeEdgesResult = {
    edgesCreated: 0,
    edgesUpdated: 0,
    oddsCoverage: null,
    errors: [],
  };

  try {
    // Get upcoming events within lookahead window
    const now = new Date();
    const lookaheadEnd = new Date(now.getTime() + WINDOW_CONFIG.LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    console.log(`[Materialize] Processing events from ${now.toISOString()} to ${lookaheadEnd.toISOString()}`);

    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      `)
      .eq('status', 'scheduled')
      .gt('commence_time', now.toISOString())
      .lt('commence_time', lookaheadEnd.toISOString());

    if (!events || events.length === 0) return result;

    // Check odds coverage before processing
    const eventIds = events.map(e => e.id);
    const coverage = await checkOddsCoverage(eventIds);
    result.oddsCoverage = coverage;

    if (!coverage.passed) {
      result.errors.push(
        `Odds coverage gate failed: DK spread ${(coverage.dkSpreadCoverage * 100).toFixed(1)}%, ` +
        `FD spread ${(coverage.fdSpreadCoverage * 100).toFixed(1)}% ` +
        `(required: ${COVERAGE_CONFIG.MIN_COVERAGE_PCT * 100}%)`
      );
      console.warn('[Materialize] Skipping edge updates due to low odds coverage');
      return result;
    }

    // Get projections for these events
    const { data: projections } = await supabase
      .from('projections')
      .select('*')
      .in('event_id', events.map(e => e.id));

    const projectionsByEvent = new Map<string, Projection>();
    for (const proj of (projections || []) as Projection[]) {
      projectionsByEvent.set(proj.event_id, proj);
    }

    // Fetch weather data from CFBD
    const weatherByTeams = await fetchWeatherData();

    // Fetch returning production data for player factors
    const cfbd = getCFBDApiClient();
    const currentSeason = cfbd.getCurrentSeason();
    let returningProduction = new Map<string, ReturningProductionData>();
    try {
      returningProduction = await getReturningProduction(currentSeason);
    } catch (err) {
      console.warn('Failed to fetch returning production:', err instanceof Error ? err.message : 'Unknown error');
    }

    // Initialize injury data if stale
    if (isInjuryCacheStale()) {
      initializeInjuryData();
    }

    // Get sportsbooks
    const { data: sportsbooks } = await supabase
      .from('sportsbooks')
      .select('id, key');

    if (!sportsbooks) return result;

    // Process each event
    for (const rawEvent of events) {
      const projection = projectionsByEvent.get(rawEvent.id);
      if (!projection) continue;

      // Normalize event (Supabase returns arrays for relations)
      const homeTeam = Array.isArray(rawEvent.home_team) ? rawEvent.home_team[0] : rawEvent.home_team;
      const awayTeam = Array.isArray(rawEvent.away_team) ? rawEvent.away_team[0] : rawEvent.away_team;
      const event = {
        id: rawEvent.id,
        commence_time: rawEvent.commence_time,
        home_team: homeTeam || null,
        away_team: awayTeam || null,
        home_team_id: (rawEvent as { home_team_id?: string }).home_team_id,
        away_team_id: (rawEvent as { away_team_id?: string }).away_team_id,
      };

      // Look up weather for this game
      const homeTeamName = event.home_team?.name || '';
      const awayTeamName = event.away_team?.name || '';
      const weatherKey = `${homeTeamName}|${awayTeamName}`;
      const weather = weatherByTeams.get(weatherKey) || null;
      const weatherImpact = analyzeWeatherImpact(weather);

      // Calculate player factor adjustment
      const homeReturning = returningProduction.get(homeTeamName);
      const awayReturning = returningProduction.get(awayTeamName);
      const gameDate = event.commence_time ? new Date(event.commence_time) : new Date();
      const weekNumber = getWeekNumber(gameDate, currentSeason);
      const playerFactorAdj = calculateReturningProductionAdjustment(
        homeReturning,
        awayReturning,
        weekNumber
      );

      // Get injury reports for both teams
      const homeInjuryReport = getTeamInjuries(homeTeamName);
      const awayInjuryReport = getTeamInjuries(awayTeamName);
      const injuryImpact = analyzeInjuryImpact(
        homeInjuryReport?.injuries || [],
        awayInjuryReport?.injuries || []
      );

      // NEW: Get pace adjustment for totals
      let paceAdj = { combinedPaceAdjustment: 0, homePaceRank: null as number | null, awayPaceRank: null as number | null };
      if (event.home_team_id && event.away_team_id) {
        try {
          paceAdj = await getPaceAdjustment(event.home_team_id, event.away_team_id, currentSeason);
        } catch {
          // Pace data not available
        }
      }

      // NEW: Get situational adjustment (travel, rest, rivalry)
      let situationalAdj = { homeAdjustment: 0, awayAdjustment: 0, factors: null as Record<string, unknown> | null };
      if (event.home_team_id && event.away_team_id) {
        try {
          const sitData = await calculateSituationalAdjustment(
            event.id,
            event.home_team_id,
            event.away_team_id,
            gameDate,
            currentSeason
          );
          situationalAdj = {
            homeAdjustment: sitData.homeAdjustment,
            awayAdjustment: sitData.awayAdjustment,
            factors: sitData.factors as unknown as Record<string, unknown>,
          };
        } catch {
          // Situational data not available
        }
      }

      for (const sportsbook of sportsbooks) {
        try {
          // Analyze line movement for this event/sportsbook
          const lineMovement = await analyzeLineMovement(
            event.id,
            sportsbook.id,
            event.commence_time
          );

          // Process spreads (with situational adjustment)
          await processSpreadEdge(event, projection, sportsbook, result, weatherImpact, playerFactorAdj, injuryImpact, lineMovement, situationalAdj);

          // Process totals (with pace adjustment)
          await processTotalEdge(event, projection, sportsbook, result, weatherImpact, playerFactorAdj, injuryImpact, lineMovement, paceAdj);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Event ${event.id} / ${sportsbook.key}: ${message}`);
        }
      }
    }

    // Update rankings
    await updateEdgeRankings();

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Materialize failed: ${message}`);
  }

  return result;
}

/**
 * Fetch weather data from CFBD and index by team names
 */
async function fetchWeatherData(): Promise<Map<string, CFBDWeather>> {
  const weatherByTeams = new Map<string, CFBDWeather>();

  try {
    const cfbd = getCFBDApiClient();
    const season = cfbd.getCurrentSeason();

    // Fetch weather for current season
    const weatherData = await cfbd.getWeather(season);

    // Index by "homeTeam|awayTeam" for lookup
    for (const w of weatherData) {
      const key = `${w.homeTeam}|${w.awayTeam}`;
      weatherByTeams.set(key, w);
    }
  } catch (err) {
    // Weather fetch failed - continue without weather data
    console.warn('Failed to fetch weather data:', err instanceof Error ? err.message : 'Unknown error');
  }

  return weatherByTeams;
}

/**
 * Process spread edge for an event/sportsbook
 * Uses MARKET-CALIBRATED model: market line is baseline, we find edges via adjustments
 */
async function processSpreadEdge(
  event: { id: string; commence_time?: string; home_team: { name: string } | null; away_team: { name: string } | null },
  projection: { model_spread_home: number },
  sportsbook: { id: string; key: string },
  result: MaterializeEdgesResult,
  weatherImpact: WeatherImpact,
  playerFactorAdj: PlayerFactorAdjustment,
  injuryImpact: InjuryImpact,
  lineMovement: LineMovementImpact,
  situationalAdj: { homeAdjustment: number; awayAdjustment: number; factors: Record<string, unknown> | null }
): Promise<void> {
  // Get latest spread tick for home side
  const { data: latestTick } = await supabase
    .from('odds_ticks')
    .select('*')
    .eq('event_id', event.id)
    .eq('sportsbook_id', sportsbook.id)
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!latestTick || latestTick.spread_points_home === null) return;

  const marketSpreadHome = latestTick.spread_points_home;
  const homeTeamName = event.home_team?.name || 'Home';
  const awayTeamName = event.away_team?.name || 'Away';
  const gameDate = event.commence_time ? new Date(event.commence_time) : new Date();
  const weekNumber = getWeekNumber(gameDate, gameDate.getFullYear());

  // Calculate conference strength adjustment
  const confAdj = calculateConferenceAdjustment(homeTeamName, awayTeamName);

  // Check for bowl game adjustments
  const bowlAdj = getBowlGameAdjustment(gameDate);

  // Convert line movement signal to numeric (-1 to 1)
  const sharpSignalValue =
    lineMovement.spreadSignal.signal === 'sharp_home' ? 1 :
    lineMovement.spreadSignal.signal === 'sharp_away' ? -1 : 0;
  const sharpConfidenceMultiplier =
    lineMovement.spreadSignal.confidence === 'high' ? 1.0 :
    lineMovement.spreadSignal.confidence === 'medium' ? 0.5 : 0.2;
  const sharpMovement = sharpSignalValue * sharpConfidenceMultiplier;

  // Calculate situational net
  const situationalNet = (situationalAdj.homeAdjustment - situationalAdj.awayAdjustment) * ENHANCED_WEIGHTS.situational;

  // USE MARKET-CALIBRATED MODEL
  // Market line IS the baseline - our edge comes from adjustments
  const mcProjection = generateSpreadProjection(
    marketSpreadHome,
    {
      conferenceStrengthDiff: confAdj.strengthDiff,
      homeInjuryPoints: injuryImpact.spreadAdjustment > 0 ? injuryImpact.spreadAdjustment : 0,
      awayInjuryPoints: injuryImpact.spreadAdjustment < 0 ? Math.abs(injuryImpact.spreadAdjustment) : 0,
      sharpMovement,
      weatherImpact: weatherImpact.spreadAdjustment,
      situationalDiff: situationalNet,
      isCrossConference: confAdj.isCrossConference,
      isBowlGame: bowlAdj.isBowl,
      weekNumber,
    },
    DEFAULT_COEFFICIENTS
  );

  // Model spread is our calibrated projection
  const adjustedModelSpread = mcProjection.modelLine;

  // Edge is CAPPED to prevent unrealistic values
  // Use capped edge from market-calibrated model
  const edgePoints = mcProjection.cappedEdge;

  // Determine recommended side and label
  let recommendedSide: string;
  let recommendedBetLabel: string;

  if (edgePoints > 0) {
    // Bet Home at market number
    recommendedSide = 'home';
    recommendedBetLabel = `${homeTeamName} ${formatSpread(marketSpreadHome)}`;
  } else if (edgePoints < 0) {
    // Bet Away at market number
    recommendedSide = 'away';
    recommendedBetLabel = `${awayTeamName} ${formatSpread(-marketSpreadHome)}`;
  } else {
    // No edge
    return;
  }

  // Get calibration data based on edge size
  const calibration = getCalibrationData(Math.abs(edgePoints));

  // Add weather warnings
  const weatherWarnings = getWeatherWarnings(weatherImpact);
  // Add player factor warnings
  const playerWarnings = playerFactorAdj.factors.length > 0 ? playerFactorAdj.factors : [];
  // Add injury warnings
  const injuryWarnings = injuryImpact.warnings;
  // Add line movement warnings
  const lineMovementWarnings = lineMovement.warnings;
  // Add conference warnings
  const conferenceWarnings: string[] = [];
  if (confAdj.isCrossConference) {
    const stronger = confAdj.adjustment > 0 ? 'Home' : 'Away';
    const diff = Math.abs(confAdj.adjustment);
    if (diff >= 2) {
      conferenceWarnings.push(`CONFERENCE: ${stronger} from stronger conference (${confAdj.adjustment > 0 ? confAdj.homeConference : confAdj.awayConference} vs ${confAdj.adjustment > 0 ? confAdj.awayConference : confAdj.homeConference}), ${diff.toFixed(1)} pt adj`);
    }
  }
  // Add bowl game warnings
  const bowlWarnings: string[] = [];
  if (bowlAdj.isBowl) {
    bowlWarnings.push(`BOWL GAME: Neutral site (-${bowlAdj.homeFieldReduction} HFA), watch for opt-outs`);
  }
  const allWarnings = [...calibration.warnings, ...weatherWarnings, ...playerWarnings, ...injuryWarnings, ...lineMovementWarnings, ...conferenceWarnings, ...bowlWarnings];

  // Check if bet aligns with sharp money
  const sharpAlignment = betAlignsWithSharps(recommendedSide, lineMovement.spreadSignal, lineMovement.totalSignal);
  if (sharpAlignment.message) {
    allWarnings.push(sharpAlignment.message);
  }

  // Check if weather explains a large edge
  const weatherExplains = weatherExplainsLargeEdge(weatherImpact, edgePoints, 'spread');

  // Boost confidence if player factors support the edge direction
  let adjustedTier = calibration.confidenceTier;
  if (playerFactorAdj.confidence === 'high' && Math.abs(playerFactorAdj.spreadAdjustment) >= 1) {
    // Player factors support this edge (same direction)
    if ((edgePoints > 0 && playerFactorAdj.spreadAdjustment > 0) ||
        (edgePoints < 0 && playerFactorAdj.spreadAdjustment < 0)) {
      if (adjustedTier === 'medium') adjustedTier = 'high';
      allWarnings.push(`PLAYER FACTORS SUPPORT: ${playerFactorAdj.spreadAdjustment > 0 ? 'Home' : 'Away'} has edge in returning production`);
    }
  }

  // Boost confidence if injuries support the edge (e.g., betting against injured team)
  if (injuryImpact.confidence === 'high' && Math.abs(injuryImpact.spreadAdjustment) >= 2) {
    // If home is injured (positive adjustment) and we're betting away (negative edge), or vice versa
    if ((edgePoints < 0 && injuryImpact.spreadAdjustment > 0) ||
        (edgePoints > 0 && injuryImpact.spreadAdjustment < 0)) {
      if (adjustedTier === 'medium') adjustedTier = 'high';
      allWarnings.push(`INJURIES SUPPORT BET: Betting against team with key injuries`);
    }
  }

  // Boost confidence if bet aligns with sharp money
  if (sharpAlignment.aligns && lineMovement.spreadSignal.confidence !== 'low') {
    if (adjustedTier === 'medium') adjustedTier = 'high';
    if (adjustedTier === 'low') adjustedTier = 'medium';
  }
  // Reduce confidence if betting against sharps
  if (!sharpAlignment.aligns && sharpAlignment.message.includes('AGAINST') && lineMovement.spreadSignal.confidence === 'high') {
    if (adjustedTier === 'very-high') adjustedTier = 'high';
    if (adjustedTier === 'high') adjustedTier = 'medium';
  }

  // Add model explanation to warnings
  if (mcProjection.explanation.length > 0) {
    allWarnings.push(...mcProjection.explanation.map(e => `MODEL: ${e}`));
  }

  // Use model confidence if it's lower than calibration
  if (mcProjection.confidence === 'low' && adjustedTier !== 'skip') {
    adjustedTier = 'low';
  }

  await upsertEdge({
    eventId: event.id,
    sportsbookId: sportsbook.id,
    marketType: 'spread',
    asOf: latestTick.captured_at,
    marketSpreadHome,
    marketTotalPoints: null,
    marketPriceAmerican: latestTick.price_american,
    modelSpreadHome: adjustedModelSpread,
    modelTotalPoints: null,
    edgePoints,
    recommendedSide,
    recommendedBetLabel,
    explain: {
      winProbability: calibration.winProbability,
      expectedValue: calibration.expectedValue,
      confidenceTier: adjustedTier,
      qualifies: calibration.qualifies && mcProjection.confidence !== 'low',
      warnings: allWarnings,
      reason: calibration.qualifies
        ? `Market-calibrated edge (${mcProjection.adjustments.total.toFixed(1)} pt adjustment)`
        : Math.abs(edgePoints) >= DEFAULT_COEFFICIENTS.maxReasonableEdge
        ? 'Edge capped at maximum - uncertainty too high'
        : 'Edge too small for reliable profit',
      modelVersion: 'market-calibrated-v2',
      rawEdge: mcProjection.rawEdge,
      cappedEdge: mcProjection.cappedEdge,
      uncertainty: mcProjection.uncertainty,
      adjustmentBreakdown: mcProjection.adjustments,
      weather: weatherImpact.hasImpact ? {
        severity: weatherImpact.severity,
        factors: weatherImpact.factors,
        spreadAdjustment: weatherImpact.spreadAdjustment,
      } : null,
      playerFactors: playerFactorAdj.spreadAdjustment !== 0 ? {
        adjustment: playerFactorAdj.spreadAdjustment,
        confidence: playerFactorAdj.confidence,
        factors: playerFactorAdj.factors,
      } : null,
      injuries: injuryImpact.keyInjuries.length > 0 ? {
        adjustment: injuryImpact.spreadAdjustment,
        confidence: injuryImpact.confidence,
        keyInjuries: injuryImpact.keyInjuries,
      } : null,
      situational: situationalAdj.factors ? {
        homeAdjustment: situationalAdj.homeAdjustment,
        awayAdjustment: situationalAdj.awayAdjustment,
        netAdjustment: (situationalAdj.homeAdjustment - situationalAdj.awayAdjustment) * ENHANCED_WEIGHTS.situational,
        factors: situationalAdj.factors,
      } : null,
      conference: confAdj.isCrossConference ? {
        homeConference: confAdj.homeConference,
        awayConference: confAdj.awayConference,
        strengthDiff: confAdj.strengthDiff,
        adjustment: confAdj.adjustment,
      } : null,
      bowlGame: bowlAdj.isBowl ? {
        homeFieldReduction: bowlAdj.homeFieldReduction,
        uncertaintyBoost: bowlAdj.uncertaintyBoost,
      } : null,
      lineMovement: {
        opening: lineMovement.lineMovement.spread.opening,
        current: lineMovement.lineMovement.spread.current,
        movement: lineMovement.lineMovement.spread.movement,
        tickCount: lineMovement.lineMovement.spread.tickCount,
        sharpSignal: lineMovement.spreadSignal.signal,
        sharpConfidence: lineMovement.spreadSignal.confidence,
        sharpDescription: lineMovement.spreadSignal.description,
        adjustment: lineMovement.spreadAdjustment,
        alignsWithBet: sharpAlignment.aligns,
      },
    },
  }, result);
}

/**
 * Process total edge for an event/sportsbook
 * Uses MARKET-CALIBRATED model: market line is baseline, we find edges via adjustments
 */
async function processTotalEdge(
  event: { id: string; commence_time?: string; home_team: { name: string } | null; away_team: { name: string } | null },
  projection: { model_total_points: number },
  sportsbook: { id: string; key: string },
  result: MaterializeEdgesResult,
  weatherImpact: WeatherImpact,
  playerFactorAdj: PlayerFactorAdjustment,
  injuryImpact: InjuryImpact,
  lineMovement: LineMovementImpact,
  paceAdj: { combinedPaceAdjustment: number; homePaceRank: number | null; awayPaceRank: number | null }
): Promise<void> {
  // Get latest total tick (over side has the points)
  const { data: latestTick } = await supabase
    .from('odds_ticks')
    .select('*')
    .eq('event_id', event.id)
    .eq('sportsbook_id', sportsbook.id)
    .eq('market_type', 'total')
    .eq('side', 'over')
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!latestTick || latestTick.total_points === null) return;

  const marketTotalPoints = latestTick.total_points;

  // USE MARKET-CALIBRATED MODEL for totals
  // Market line IS the baseline - our edge comes from weather and pace adjustments
  const mcProjection = generateTotalProjection(
    marketTotalPoints,
    {
      combinedPaceAdjustment: paceAdj.combinedPaceAdjustment,
      weatherTotalImpact: weatherImpact.totalAdjustment,
      isIndoor: false, // TODO: Could add venue data
    },
    DEFAULT_COEFFICIENTS
  );

  // Model total is our calibrated projection
  // SEMANTIC SEPARATION:
  // baseline_total_points = market line (the starting point)
  // adjustment_points = weather + pace adjustments
  // model_total_points = baseline + adjustment (what we'd predict)
  const baselineTotalPoints = marketTotalPoints;  // Market IS the baseline
  const adjustmentPoints = mcProjection.adjustments.total;
  const modelTotalPoints = baselineTotalPoints + adjustmentPoints;

  // Edge is CAPPED to prevent unrealistic values
  const edgePoints = mcProjection.cappedEdge;

  // SANITY GATE: Exclude nonsense totals from recommendations
  const MAX_REASONABLE_ADJUSTMENT = 14;  // No adjustment should exceed 14 pts
  const sanityFailed = Math.abs(adjustmentPoints) > MAX_REASONABLE_ADJUSTMENT;

  // Determine recommended side and label
  // IMPORTANT: Always update the edge even if edgePoints = 0
  let recommendedSide: string;
  let recommendedBetLabel: string;

  if (sanityFailed) {
    // Sanity gate failed - exclude from recommendations
    recommendedSide = 'none';
    recommendedBetLabel = `EXCLUDED: Adjustment ${adjustmentPoints.toFixed(1)} exceeds limit`;
  } else if (edgePoints > 0) {
    // Market total higher than model → Bet Under
    recommendedSide = 'under';
    recommendedBetLabel = `Under ${marketTotalPoints}`;
  } else if (edgePoints < 0) {
    // Market total lower than model → Bet Over
    recommendedSide = 'over';
    recommendedBetLabel = `Over ${marketTotalPoints}`;
  } else {
    // No edge - still update but mark as no recommendation
    recommendedSide = 'none';
    recommendedBetLabel = 'No edge (model = market)';
  }

  // Get calibration data based on edge size
  const calibration = getCalibrationData(Math.abs(edgePoints));

  // Add weather warnings - especially important for totals
  const weatherWarnings = getWeatherWarnings(weatherImpact);
  // Add line movement warnings
  const lineMovementWarnings = lineMovement.warnings.filter(w => w.includes('total') || w.includes('OVER') || w.includes('UNDER'));
  const allWarnings = [...calibration.warnings, ...weatherWarnings, ...lineMovementWarnings];

  // Check if bet aligns with sharp money for totals
  const sharpAlignment = betAlignsWithSharps(recommendedSide, lineMovement.spreadSignal, lineMovement.totalSignal);
  if (sharpAlignment.message) {
    allWarnings.push(sharpAlignment.message);
  }

  // Check if weather explains a large edge (very relevant for totals)
  const weatherExplains = weatherExplainsLargeEdge(weatherImpact, edgePoints, 'total');

  // Weather adjusts confidence for total bets
  let adjustedTier = calibration.confidenceTier;
  if (weatherImpact.hasImpact && weatherImpact.severity === 'severe') {
    // Severe weather makes Under more likely - if we're betting Under, boost confidence
    if (recommendedSide === 'under' && edgePoints > 0) {
      // Weather supports our Under bet
      allWarnings.push(`WEATHER SUPPORTS: ${weatherImpact.totalAdjustment} pt adjustment favors Under`);
    } else if (recommendedSide === 'over' && weatherImpact.totalAdjustment < -3) {
      // Weather contradicts our Over bet - reduce confidence
      adjustedTier = 'low';
      allWarnings.push(`WEATHER CAUTION: Conditions suggest lower scoring`);
    }
  }

  // Boost confidence if bet aligns with sharp money
  if (sharpAlignment.aligns && lineMovement.totalSignal.confidence !== 'low') {
    if (adjustedTier === 'medium') adjustedTier = 'high';
    if (adjustedTier === 'low') adjustedTier = 'medium';
  }
  // Reduce confidence if betting against sharps
  if (!sharpAlignment.aligns && sharpAlignment.message.includes('AGAINST') && lineMovement.totalSignal.confidence === 'high') {
    if (adjustedTier === 'very-high') adjustedTier = 'high';
    if (adjustedTier === 'high') adjustedTier = 'medium';
  }

  // Add model explanation to warnings
  if (mcProjection.explanation.length > 0) {
    allWarnings.push(...mcProjection.explanation.map(e => `MODEL: ${e}`));
  }

  // Use model confidence if it's lower than calibration
  if (mcProjection.confidence === 'low' && adjustedTier !== 'skip') {
    adjustedTier = 'low';
  }

  await upsertEdge({
    eventId: event.id,
    sportsbookId: sportsbook.id,
    marketType: 'total',
    asOf: latestTick.captured_at,
    marketSpreadHome: null,
    marketTotalPoints,
    marketPriceAmerican: latestTick.price_american,
    modelSpreadHome: null,
    modelTotalPoints,
    edgePoints,
    recommendedSide,
    recommendedBetLabel,
    // New semantic fields
    baselineTotalPoints,
    adjustmentPoints,
    explain: {
      winProbability: calibration.winProbability,
      expectedValue: calibration.expectedValue,
      confidenceTier: sanityFailed ? 'skip' : adjustedTier,
      qualifies: !sanityFailed && calibration.qualifies && mcProjection.confidence !== 'low',
      warnings: sanityFailed
        ? [...allWarnings, `SANITY GATE FAILED: Adjustment ${adjustmentPoints.toFixed(1)} exceeds ${MAX_REASONABLE_ADJUSTMENT} pt limit`]
        : allWarnings,
      reason: sanityFailed
        ? `EXCLUDED: Adjustment too large (${adjustmentPoints.toFixed(1)} pts)`
        : calibration.qualifies
        ? `Market-calibrated edge (${adjustmentPoints.toFixed(1)} pt adjustment)`
        : Math.abs(edgePoints) >= DEFAULT_COEFFICIENTS.maxReasonableEdge
        ? 'Edge capped at maximum - uncertainty too high'
        : 'Edge too small for reliable profit',
      modelVersion: 'market-calibrated-v2',
      rawEdge: mcProjection.rawEdge,
      cappedEdge: mcProjection.cappedEdge,
      sanityGate: {
        passed: !sanityFailed,
        adjustmentPoints,
        maxAllowed: MAX_REASONABLE_ADJUSTMENT,
      },
      adjustmentBreakdown: mcProjection.adjustments,
      weather: weatherImpact.hasImpact ? {
        severity: weatherImpact.severity,
        factors: weatherImpact.factors,
        totalAdjustment: weatherImpact.totalAdjustment,
      } : null,
      pace: paceAdj.combinedPaceAdjustment !== 0 ? {
        adjustment: paceAdj.combinedPaceAdjustment,
        homePaceRank: paceAdj.homePaceRank,
        awayPaceRank: paceAdj.awayPaceRank,
        effectiveAdjustment: paceAdj.combinedPaceAdjustment * ENHANCED_WEIGHTS.pace,
      } : null,
      lineMovement: {
        opening: lineMovement.lineMovement.total.opening,
        current: lineMovement.lineMovement.total.current,
        movement: lineMovement.lineMovement.total.movement,
        tickCount: lineMovement.lineMovement.total.tickCount,
        sharpSignal: lineMovement.totalSignal.signal,
        sharpConfidence: lineMovement.totalSignal.confidence,
        sharpDescription: lineMovement.totalSignal.description,
        adjustment: lineMovement.totalAdjustment,
        alignsWithBet: sharpAlignment.aligns,
      },
    },
  }, result);
}

/**
 * Upsert an edge record
 */
async function upsertEdge(
  data: {
    eventId: string;
    sportsbookId: string;
    marketType: MarketType;
    asOf: string;
    marketSpreadHome: number | null;
    marketTotalPoints: number | null;
    marketPriceAmerican: number;
    modelSpreadHome: number | null;
    modelTotalPoints: number | null;
    edgePoints: number;
    recommendedSide: string;
    recommendedBetLabel: string;
    // New semantic fields for totals
    baselineTotalPoints?: number | null;
    adjustmentPoints?: number | null;
    explain: {
      winProbability: number;
      expectedValue: number;
      confidenceTier: string;
      qualifies: boolean;
      warnings: string[];
      reason: string;
      // Market-calibrated model fields
      modelVersion?: string;
      rawEdge?: number;
      cappedEdge?: number;
      uncertainty?: number;
      adjustmentBreakdown?: {
        conference: number;
        injuries: number;
        lineMovement: number;
        weather: number;
        situational: number;
        total: number;
      };
      weather?: {
        severity: string;
        factors: string[];
        totalAdjustment?: number;
        spreadAdjustment?: number;
      } | null;
      playerFactors?: {
        adjustment: number;
        confidence: 'high' | 'medium' | 'low';
        factors: string[];
      } | null;
      injuries?: {
        adjustment: number;
        confidence: 'high' | 'medium' | 'low';
        keyInjuries: string[];
      } | null;
      situational?: {
        homeAdjustment: number;
        awayAdjustment: number;
        netAdjustment: number;
        factors: Record<string, unknown>;
      } | null;
      conference?: {
        homeConference: string | null;
        awayConference: string | null;
        strengthDiff: number;
        adjustment: number;
      } | null;
      bowlGame?: {
        homeFieldReduction: number;
        uncertaintyBoost: number;
      } | null;
      pace?: {
        adjustment: number;
        homePaceRank: number | null;
        awayPaceRank: number | null;
        effectiveAdjustment: number;
      } | null;
      lineMovement?: {
        opening: number | null;
        current: number | null;
        movement: number;
        tickCount: number;
        sharpSignal: string;
        sharpConfidence: string;
        sharpDescription: string;
        adjustment: number;
        alignsWithBet: boolean;
      } | null;
      sanityGate?: {
        passed: boolean;
        adjustmentPoints: number;
        maxAllowed: number;
      };
    };
  },
  result: MaterializeEdgesResult
): Promise<void> {
  // Check if edge exists
  const { data: existing } = await supabase
    .from('edges')
    .select('id')
    .eq('event_id', data.eventId)
    .eq('sportsbook_id', data.sportsbookId)
    .eq('market_type', data.marketType)
    .single();

  if (existing) {
    // Update
    const { error } = await supabase
      .from('edges')
      .update({
        as_of: data.asOf,
        market_spread_home: data.marketSpreadHome,
        market_total_points: data.marketTotalPoints,
        market_price_american: data.marketPriceAmerican,
        model_spread_home: data.modelSpreadHome,
        model_total_points: data.modelTotalPoints,
        edge_points: data.edgePoints,
        recommended_side: data.recommendedSide,
        recommended_bet_label: data.recommendedBetLabel,
        // New semantic fields (only set if provided)
        ...(data.baselineTotalPoints !== undefined && { baseline_total_points: data.baselineTotalPoints }),
        ...(data.adjustmentPoints !== undefined && { adjustment_points: data.adjustmentPoints }),
        explain: data.explain,
      })
      .eq('id', existing.id);

    if (error) throw error;
    result.edgesUpdated++;
  } else {
    // Insert
    const { error } = await supabase
      .from('edges')
      .insert({
        event_id: data.eventId,
        sportsbook_id: data.sportsbookId,
        market_type: data.marketType,
        as_of: data.asOf,
        market_spread_home: data.marketSpreadHome,
        market_total_points: data.marketTotalPoints,
        market_price_american: data.marketPriceAmerican,
        model_spread_home: data.modelSpreadHome,
        model_total_points: data.modelTotalPoints,
        edge_points: data.edgePoints,
        recommended_side: data.recommendedSide,
        recommended_bet_label: data.recommendedBetLabel,
        // New semantic fields (only set if provided)
        ...(data.baselineTotalPoints !== undefined && { baseline_total_points: data.baselineTotalPoints }),
        ...(data.adjustmentPoints !== undefined && { adjustment_points: data.adjustmentPoints }),
        explain: data.explain,
      });

    if (error) throw error;
    result.edgesCreated++;
  }
}

/**
 * Update edge rankings within each book/market
 */
async function updateEdgeRankings(): Promise<void> {
  // Get all edges ordered by abs(edge_points)
  const { data: edges } = await supabase
    .from('edges')
    .select('id, sportsbook_id, market_type, edge_points')
    .order('sportsbook_id')
    .order('market_type');

  if (!edges) return;

  // Group by sportsbook/market and assign ranks
  const groups = new Map<string, typeof edges>();
  for (const edge of edges) {
    const key = `${edge.sportsbook_id}-${edge.market_type}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(edge);
  }

  // Sort each group by abs(edge_points) descending and update ranks
  for (const [, groupEdges] of groups) {
    groupEdges.sort((a, b) => Math.abs(b.edge_points) - Math.abs(a.edge_points));

    for (let i = 0; i < groupEdges.length; i++) {
      await supabase
        .from('edges')
        .update({ rank_abs_edge: i + 1 })
        .eq('id', groupEdges[i].id);
    }
  }
}

/**
 * Format spread for display
 */
function formatSpread(points: number): string {
  if (points > 0) return `+${points}`;
  return points.toString();
}
