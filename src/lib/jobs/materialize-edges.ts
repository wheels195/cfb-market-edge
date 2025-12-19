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

// Enhanced model factor weights (tuned from backtesting)
const ENHANCED_WEIGHTS = {
  recencyElo: 0.2,      // Recency adjustment amplification
  pace: 0.8,            // Pace impact on totals
  efficiency: 0.3,      // PPA matchup on spreads
  situational: 0.6,     // Travel/rest/rivalry
};

export interface MaterializeEdgesResult {
  edgesCreated: number;
  edgesUpdated: number;
  errors: string[];
}

// Calibration data from 2022-2024 backtest analysis
// Win probabilities based on edge size for high-confidence bets (all models agree)
const CALIBRATION = {
  // Edge range -> Win probability
  edgeProbabilities: [
    { min: 3, max: 4, winProb: 0.615, ev: 19.23, tier: 'medium' as const },
    { min: 4, max: 5, winProb: 0.643, ev: 25.00, tier: 'high' as const },
    { min: 5, max: 6, winProb: 0.536, ev: 2.50, tier: 'medium' as const },
    { min: 6, max: 7, winProb: 0.613, ev: 18.71, tier: 'very-high' as const },
  ],
  // Profitable filter: edge 3-7 with high confidence
  profitableFilter: {
    minEdge: 3,
    maxEdge: 7,
  },
  // Default for edges outside calibrated range
  defaultLow: { winProb: 0.50, ev: -5.00, tier: 'skip' as const },
  defaultHigh: { winProb: 0.47, ev: -12.00, tier: 'skip' as const }, // Large edges are model errors
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

  // Add warnings for edge size
  if (absEdge >= 10) {
    warnings.push('LARGE_EDGE: Model disagrees with market by 10+ pts - likely model error');
  } else if (absEdge >= 7) {
    warnings.push('CAUTION: Edge 7-10 pts has lower historical win rate');
  } else if (absEdge < 2) {
    warnings.push('SMALL_EDGE: Edge under 2 pts may not overcome the vig');
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

  // Edge too small (< 3)
  if (absEdge < CALIBRATION.profitableFilter.minEdge) {
    return {
      winProbability: 50,
      expectedValue: -5.00,
      confidenceTier: 'low',
      qualifies: false,
      warnings,
    };
  }

  // Edge too large (>= 7) - likely model error
  return {
    winProbability: 47,
    expectedValue: -12.00,
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
export async function materializeEdges(): Promise<MaterializeEdgesResult> {
  const result: MaterializeEdgesResult = {
    edgesCreated: 0,
    edgesUpdated: 0,
    errors: [],
  };

  try {
    // Get upcoming events with projections and team info
    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      `)
      .eq('status', 'scheduled')
      .gt('commence_time', new Date().toISOString());

    if (!events || events.length === 0) return result;

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

      for (const sportsbook of sportsbooks) {
        try {
          // Analyze line movement for this event/sportsbook
          const lineMovement = await analyzeLineMovement(
            event.id,
            sportsbook.id,
            event.commence_time
          );

          // Process spreads
          await processSpreadEdge(event, projection, sportsbook, result, weatherImpact, playerFactorAdj, injuryImpact, lineMovement);

          // Process totals
          await processTotalEdge(event, projection, sportsbook, result, weatherImpact, playerFactorAdj, injuryImpact, lineMovement);
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
 */
async function processSpreadEdge(
  event: { id: string; commence_time?: string; home_team: { name: string } | null; away_team: { name: string } | null },
  projection: { model_spread_home: number },
  sportsbook: { id: string; key: string },
  result: MaterializeEdgesResult,
  weatherImpact: WeatherImpact,
  playerFactorAdj: PlayerFactorAdjustment,
  injuryImpact: InjuryImpact,
  lineMovement: LineMovementImpact
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
  // Apply all adjustments to model spread:
  // - Player factors: positive = home team better than rated
  // - Injury: positive = home team is hurt more, spread should favor away
  // - Line movement: positive = sharp money on home (follow the sharps)
  const totalAdjustment = playerFactorAdj.spreadAdjustment - injuryImpact.spreadAdjustment + lineMovement.spreadAdjustment;
  const adjustedModelSpread = projection.model_spread_home - totalAdjustment;

  // Calculate edge using adjusted model spread
  // edge_points = market_spread_home - adjusted_model_spread_home
  const edgePoints = marketSpreadHome - adjustedModelSpread;

  // Determine recommended side and label
  let recommendedSide: string;
  let recommendedBetLabel: string;

  const homeTeamName = event.home_team?.name || 'Home';
  const awayTeamName = event.away_team?.name || 'Away';

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
  const allWarnings = [...calibration.warnings, ...weatherWarnings, ...playerWarnings, ...injuryWarnings, ...lineMovementWarnings];

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

  await upsertEdge({
    eventId: event.id,
    sportsbookId: sportsbook.id,
    marketType: 'spread',
    asOf: latestTick.captured_at,
    marketSpreadHome,
    marketTotalPoints: null,
    marketPriceAmerican: latestTick.price_american,
    modelSpreadHome: adjustedModelSpread, // Store the adjusted model spread
    modelTotalPoints: null,
    edgePoints,
    recommendedSide,
    recommendedBetLabel,
    explain: {
      winProbability: calibration.winProbability,
      expectedValue: calibration.expectedValue,
      confidenceTier: adjustedTier,
      qualifies: calibration.qualifies,
      warnings: allWarnings,
      reason: calibration.qualifies
        ? 'Meets profitable filter criteria (edge 3-7 pts)'
        : calibration.confidenceTier === 'skip'
        ? weatherExplains
          ? 'Edge may be weather-related'
          : 'Edge too large - likely model error'
        : 'Edge too small for reliable profit',
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
 */
async function processTotalEdge(
  event: { id: string; commence_time?: string; home_team: { name: string } | null; away_team: { name: string } | null },
  projection: { model_total_points: number },
  sportsbook: { id: string; key: string },
  result: MaterializeEdgesResult,
  weatherImpact: WeatherImpact,
  playerFactorAdj: PlayerFactorAdjustment,
  injuryImpact: InjuryImpact,
  lineMovement: LineMovementImpact
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
  const modelTotalPoints = projection.model_total_points;

  // Calculate edge
  // edge_points = market_total_points - model_total_points
  const edgePoints = marketTotalPoints - modelTotalPoints;

  // Determine recommended side and label
  let recommendedSide: string;
  let recommendedBetLabel: string;

  if (edgePoints > 0) {
    // Market total higher than model → Bet Under
    recommendedSide = 'under';
    recommendedBetLabel = `Under ${marketTotalPoints}`;
  } else if (edgePoints < 0) {
    // Market total lower than model → Bet Over
    recommendedSide = 'over';
    recommendedBetLabel = `Over ${marketTotalPoints}`;
  } else {
    // No edge
    return;
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
    explain: {
      winProbability: calibration.winProbability,
      expectedValue: calibration.expectedValue,
      confidenceTier: adjustedTier,
      qualifies: calibration.qualifies && adjustedTier !== 'low',
      warnings: allWarnings,
      reason: calibration.qualifies
        ? 'Meets profitable filter criteria (edge 3-7 pts)'
        : calibration.confidenceTier === 'skip'
        ? weatherExplains
          ? 'Edge may be weather-related - market pricing in conditions'
          : 'Edge too large - likely model error'
        : 'Edge too small for reliable profit',
      weather: weatherImpact.hasImpact ? {
        severity: weatherImpact.severity,
        factors: weatherImpact.factors,
        totalAdjustment: weatherImpact.totalAdjustment,
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
    explain: {
      winProbability: number;
      expectedValue: number;
      confidenceTier: string;
      qualifies: boolean;
      warnings: string[];
      reason: string;
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
