/**
 * Enhanced Projections Model
 *
 * Combines all model factors into unified spread and total projections:
 * - Recency-weighted Elo ratings
 * - Pace/tempo adjustments
 * - EPA and success rate efficiency
 * - Travel and rest situational factors
 * - Weather impact
 * - Injury analysis
 * - Line movement / sharp money signals
 * - Player factors (returning production)
 */

import { getRecencyWeightedSpread, DEFAULT_ELO_CONFIG } from './elo';
import { getPaceAdjustment, getEfficiencyMatchup } from '@/lib/jobs/sync-advanced-stats';
import { calculateSituationalAdjustment } from './situational';
import { getTeamInjuries, analyzeInjuryImpact } from './injury-analysis';
import { analyzeLineMovement, LineMovementImpact } from './line-movement';
import { supabase } from '@/lib/db/client';

export interface EnhancedProjection {
  // Core projections
  modelSpreadHome: number;
  modelTotalPoints: number;

  // Component breakdowns
  components: {
    // Base Elo
    eloSpread: number;
    eloConfidence: 'high' | 'medium' | 'low';
    homeForm: 'hot' | 'cold' | 'neutral';
    awayForm: 'hot' | 'cold' | 'neutral';

    // Pace/tempo
    paceAdjustment: number;
    homePaceRank: number | null;
    awayPaceRank: number | null;

    // Efficiency matchup
    homeOffenseVsAwayDefense: number;
    awayOffenseVsHomeDefense: number;

    // Situational
    situationalAdjustment: number;
    travelDistance: number;
    homeRestDays: number;
    awayRestDays: number;
    isRivalry: boolean;

    // Weather
    weatherSpreadAdjustment: number;
    weatherTotalAdjustment: number;
    weatherSeverity: string;

    // Injuries
    homeInjuryImpact: number;
    awayInjuryImpact: number;
    keyInjuries: string[];

    // Line movement
    lineMovementAdjustment: number;
    sharpSignal: string;
  };

  // Overall confidence
  confidence: 'high' | 'medium' | 'low';
  dataQuality: {
    hasElo: boolean;
    hasAdvancedStats: boolean;
    hasSituational: boolean;
    hasWeather: boolean;
    hasInjuries: boolean;
    hasLineMovement: boolean;
  };
}

/**
 * Factor weights for combining adjustments
 * These can be tuned based on backtesting results
 */
const FACTOR_WEIGHTS = {
  // Spread factors
  spread: {
    elo: 1.0,           // Base Elo is the foundation
    efficiency: 0.3,    // PPA/success rate matchup
    situational: 0.8,   // Travel, rest, rivalry
    weather: 0.5,       // Weather impacts
    injuries: 0.7,      // Key player injuries
    lineMovement: 0.3,  // Sharp money signals
  },

  // Total factors
  total: {
    pace: 1.0,          // Pace is primary for totals
    weather: 1.0,       // Weather very important for totals
    injuries: 0.5,      // Injuries affect totals less directly
  },
};

/**
 * Generate enhanced projection for a game
 */
export async function generateEnhancedProjection(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  gameDate: Date,
  season: number,
  sportsbookId?: string
): Promise<EnhancedProjection> {
  const dataQuality = {
    hasElo: false,
    hasAdvancedStats: false,
    hasSituational: false,
    hasWeather: false,
    hasInjuries: false,
    hasLineMovement: false,
  };

  // Get team names
  const { data: homeTeam } = await supabase.from('teams').select('name').eq('id', homeTeamId).single();
  const { data: awayTeam } = await supabase.from('teams').select('name').eq('id', awayTeamId).single();

  // 1. Base Elo projection
  let eloSpread = 0;
  let eloConfidence: 'high' | 'medium' | 'low' = 'low';
  let homeForm: 'hot' | 'cold' | 'neutral' = 'neutral';
  let awayForm: 'hot' | 'cold' | 'neutral' = 'neutral';

  try {
    const eloData = await getRecencyWeightedSpread(
      homeTeamId,
      awayTeamId,
      season,
      DEFAULT_ELO_CONFIG
    );
    eloSpread = eloData.spread;
    eloConfidence = eloData.confidence;
    homeForm = eloData.homeForm;
    awayForm = eloData.awayForm;
    dataQuality.hasElo = true;
  } catch {
    // Elo not available - use neutral
  }

  // 2. Pace/tempo adjustment
  let paceAdjustment = 0;
  let homePaceRank: number | null = null;
  let awayPaceRank: number | null = null;

  try {
    const paceData = await getPaceAdjustment(homeTeamId, awayTeamId, season);
    paceAdjustment = paceData.combinedPaceAdjustment;
    homePaceRank = paceData.homePaceRank;
    awayPaceRank = paceData.awayPaceRank;
    if (paceData.confidence !== 'low') dataQuality.hasAdvancedStats = true;
  } catch {
    // Pace data not available
  }

  // 3. Efficiency matchup
  let homeOffVsAwayDef = 0;
  let awayOffVsHomeDef = 0;
  let efficiencySpreadAdj = 0;

  try {
    const effData = await getEfficiencyMatchup(homeTeamId, awayTeamId, season);
    homeOffVsAwayDef = effData.homeOffenseVsAwayDefense;
    awayOffVsHomeDef = effData.awayOffenseVsHomeDefense;
    // Positive homeOff vs awayDef = home advantage, negative = away advantage
    efficiencySpreadAdj = (homeOffVsAwayDef - awayOffVsHomeDef) * 2; // Scale PPA to points
    dataQuality.hasAdvancedStats = true;
  } catch {
    // Efficiency data not available
  }

  // 4. Situational factors
  let situationalAdj = 0;
  let travelDistance = 0;
  let homeRestDays = 7;
  let awayRestDays = 7;
  let isRivalry = false;

  try {
    const sitData = await calculateSituationalAdjustment(
      eventId,
      homeTeamId,
      awayTeamId,
      gameDate,
      season
    );
    situationalAdj = sitData.homeAdjustment - sitData.awayAdjustment;
    travelDistance = sitData.factors.travel.distance;
    homeRestDays = sitData.factors.homeRest.days;
    awayRestDays = sitData.factors.awayRest.days;
    isRivalry = sitData.factors.rivalry.isRivalry;
    if (sitData.confidence !== 'low') dataQuality.hasSituational = true;
  } catch {
    // Situational data not available
  }

  // 5. Weather impact
  // Note: Weather is analyzed in materialize-edges using CFBD weather API
  // which requires matching by home/away team names
  // For enhanced projections, weather is passed in via the explain field
  const weatherSpreadAdj = 0;
  const weatherTotalAdj = 0;
  const weatherSeverity = 'not-fetched';

  // 6. Injury analysis
  let homeInjuryImpact = 0;
  let awayInjuryImpact = 0;
  const keyInjuries: string[] = [];

  try {
    if (homeTeam && awayTeam) {
      const homeInjuryReport = getTeamInjuries(homeTeam.name);
      const awayInjuryReport = getTeamInjuries(awayTeam.name);

      const injuryAnalysis = analyzeInjuryImpact(
        homeInjuryReport?.injuries || [],
        awayInjuryReport?.injuries || []
      );

      homeInjuryImpact = injuryAnalysis.spreadAdjustment > 0 ? injuryAnalysis.spreadAdjustment : 0;
      awayInjuryImpact = injuryAnalysis.spreadAdjustment < 0 ? -injuryAnalysis.spreadAdjustment : 0;

      // Collect key injuries
      for (const inj of injuryAnalysis.keyInjuries.slice(0, 4)) {
        keyInjuries.push(inj);
      }

      if (injuryAnalysis.keyInjuries.length > 0) {
        dataQuality.hasInjuries = true;
      }
    }
  } catch {
    // Injury data not available
  }

  // 7. Line movement / sharp money
  let lineMovementAdj = 0;
  let sharpSignal = 'neutral';

  try {
    if (sportsbookId) {
      const lineData = await analyzeLineMovement(eventId, sportsbookId, gameDate.toISOString());
      lineMovementAdj = lineData.spreadAdjustment;
      sharpSignal = lineData.spreadSignal.signal;
      if (lineData.lineMovement.spread.tickCount > 2) {
        dataQuality.hasLineMovement = true;
      }
    }
  } catch {
    // Line movement data not available
  }

  // Combine all factors into final projections

  // Spread calculation
  const rawSpread = eloSpread
    + (efficiencySpreadAdj * FACTOR_WEIGHTS.spread.efficiency)
    + (situationalAdj * FACTOR_WEIGHTS.spread.situational)
    + (weatherSpreadAdj * FACTOR_WEIGHTS.spread.weather)
    + ((homeInjuryImpact - awayInjuryImpact) * FACTOR_WEIGHTS.spread.injuries)
    + (lineMovementAdj * FACTOR_WEIGHTS.spread.lineMovement);

  const modelSpreadHome = Math.round(rawSpread * 2) / 2; // Round to nearest 0.5

  // Total calculation
  // Start with base total (use historical average or ~50 for CFB)
  const BASE_TOTAL = 50;

  // Get team scoring averages if available
  let baseTotal = BASE_TOTAL;
  try {
    const { data: homeStats } = await supabase
      .from('team_stats')
      .select('avg_points_for, avg_points_against')
      .eq('team_id', homeTeamId)
      .eq('season', season)
      .single();

    const { data: awayStats } = await supabase
      .from('team_stats')
      .select('avg_points_for, avg_points_against')
      .eq('team_id', awayTeamId)
      .eq('season', season)
      .single();

    if (homeStats && awayStats) {
      // Project each team's score based on their offense vs opponent defense
      const homeProjected = ((homeStats.avg_points_for || 28) + (awayStats.avg_points_against || 25)) / 2;
      const awayProjected = ((awayStats.avg_points_for || 28) + (homeStats.avg_points_against || 25)) / 2;
      baseTotal = homeProjected + awayProjected;
    }
  } catch {
    // Use default
  }

  const rawTotal = baseTotal
    + (paceAdjustment * FACTOR_WEIGHTS.total.pace)
    + (weatherTotalAdj * FACTOR_WEIGHTS.total.weather)
    + ((homeInjuryImpact + awayInjuryImpact) * FACTOR_WEIGHTS.total.injuries * -0.5); // Injuries tend to lower totals

  const modelTotalPoints = Math.round(rawTotal * 2) / 2; // Round to nearest 0.5

  // Overall confidence
  const factorsAvailable = Object.values(dataQuality).filter(v => v).length;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (factorsAvailable >= 4) confidence = 'high';
  else if (factorsAvailable >= 2) confidence = 'medium';

  return {
    modelSpreadHome,
    modelTotalPoints,
    components: {
      eloSpread,
      eloConfidence,
      homeForm,
      awayForm,
      paceAdjustment,
      homePaceRank,
      awayPaceRank,
      homeOffenseVsAwayDefense: homeOffVsAwayDef,
      awayOffenseVsHomeDefense: awayOffVsHomeDef,
      situationalAdjustment: situationalAdj,
      travelDistance,
      homeRestDays,
      awayRestDays,
      isRivalry,
      weatherSpreadAdjustment: weatherSpreadAdj,
      weatherTotalAdjustment: weatherTotalAdj,
      weatherSeverity,
      homeInjuryImpact,
      awayInjuryImpact,
      keyInjuries,
      lineMovementAdjustment: lineMovementAdj,
      sharpSignal,
    },
    confidence,
    dataQuality,
  };
}

/**
 * Get projection confidence description
 */
export function getConfidenceDescription(projection: EnhancedProjection): string {
  const factors: string[] = [];

  if (projection.dataQuality.hasElo) factors.push('Elo');
  if (projection.dataQuality.hasAdvancedStats) factors.push('EPA/Pace');
  if (projection.dataQuality.hasSituational) factors.push('Situational');
  if (projection.dataQuality.hasWeather) factors.push('Weather');
  if (projection.dataQuality.hasInjuries) factors.push('Injuries');
  if (projection.dataQuality.hasLineMovement) factors.push('Line Movement');

  if (factors.length === 0) {
    return 'Limited data available';
  }

  return `Using: ${factors.join(', ')}`;
}
