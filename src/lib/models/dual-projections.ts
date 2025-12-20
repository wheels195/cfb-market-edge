/**
 * Dual Model Projection System
 *
 * Two separate models for spread projections:
 * 1. SPREADS_MARKET_ANCHORED_V1 - Primary model for betting edges
 *    Uses market line as baseline with learned adjustments
 * 2. SPREADS_ELO_RAW_V1 - Secondary model for sanity checks
 *    Pure Elo-based projection
 *
 * Projections are the SINGLE SOURCE OF TRUTH.
 * materialize-edges should READ projections, not generate them.
 */

import { supabase } from '@/lib/db/client';
import { DEFAULT_ELO_CONFIG } from './elo';
import { getBowlGameAdjustment } from './conference-strength';

// Model version names (must match database)
export const MODEL_VERSIONS = {
  MARKET_ANCHORED: 'SPREADS_MARKET_ANCHORED_V1',
  ELO_RAW: 'SPREADS_ELO_RAW_V1',
} as const;

// Model coefficients for market-anchored model
const MARKET_ANCHORED_COEFFICIENTS = {
  conferenceStrengthWeight: 0.4,
  homeFieldBase: 2.5,
  bowlGameHFAReduction: 2.0,
  injuryQBWeight: 3.0,
  injuryNonQBWeight: 0.5,
  sharpLineMovementWeight: 0.5,
  weatherWindWeight: 0.3,
  weatherPrecipWeight: 1.5,
  maxReasonableEdge: 5.0,
};

// Cache for model version IDs
let modelVersionCache: Map<string, string> | null = null;

/**
 * Get model version IDs from database
 */
export async function getModelVersionIds(): Promise<Map<string, string>> {
  if (modelVersionCache) return modelVersionCache;

  const { data: versions } = await supabase
    .from('model_versions')
    .select('id, name')
    .in('name', [MODEL_VERSIONS.MARKET_ANCHORED, MODEL_VERSIONS.ELO_RAW]);

  modelVersionCache = new Map();
  for (const v of versions || []) {
    modelVersionCache.set(v.name, v.id);
  }

  return modelVersionCache;
}

export interface DualProjectionResult {
  eventId: string;
  homeTeamId: string;
  awayTeamId: string;

  // Market-anchored projection (primary)
  marketAnchored: {
    modelVersionId: string;
    modelSpreadHome: number;
    marketBaseline: number | null; // The market line used as baseline
    adjustments: {
      conference: number;
      injuries: number;
      lineMovement: number;
      weather: number;
      situational: number;
      bowlGame: number;
      total: number;
    };
  } | null;

  // Elo-raw projection (secondary)
  eloRaw: {
    modelVersionId: string;
    modelSpreadHome: number;
    homeElo: number;
    awayElo: number;
  } | null;

  // Disagreement between models (for warning flags)
  disagreementPoints: number | null;
}

/**
 * Generate dual projections for an event
 */
export async function generateDualProjection(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  season: number
): Promise<DualProjectionResult> {
  const modelVersionIds = await getModelVersionIds();

  const result: DualProjectionResult = {
    eventId,
    homeTeamId,
    awayTeamId,
    marketAnchored: null,
    eloRaw: null,
    disagreementPoints: null,
  };

  // Generate Elo-raw projection first (always possible)
  const eloRawVersionId = modelVersionIds.get(MODEL_VERSIONS.ELO_RAW);
  if (eloRawVersionId) {
    result.eloRaw = await generateEloRawProjection(
      eventId,
      homeTeamId,
      awayTeamId,
      season,
      eloRawVersionId
    );
  }

  // Generate market-anchored projection (needs market line)
  const marketAnchoredVersionId = modelVersionIds.get(MODEL_VERSIONS.MARKET_ANCHORED);
  if (marketAnchoredVersionId) {
    result.marketAnchored = await generateMarketAnchoredProjection(
      eventId,
      homeTeamId,
      awayTeamId,
      season,
      marketAnchoredVersionId
    );
  }

  // Calculate disagreement
  if (result.marketAnchored && result.eloRaw) {
    result.disagreementPoints = Math.abs(
      result.marketAnchored.modelSpreadHome - result.eloRaw.modelSpreadHome
    );
  }

  return result;
}

/**
 * Generate pure Elo-based projection
 */
async function generateEloRawProjection(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  modelVersionId: string
): Promise<DualProjectionResult['eloRaw']> {
  // Get Elo ratings from snapshots (week 13 cap for bowl season)
  const now = new Date();
  const isBowlSeason = now.getMonth() === 11 || now.getMonth() === 0;
  const maxWeek = isBowlSeason ? 13 : 16;

  const { data: homeEloData } = await supabase
    .from('team_elo_snapshots')
    .select('elo')
    .eq('team_id', homeTeamId)
    .eq('season', season)
    .lte('week', maxWeek)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  const { data: awayEloData } = await supabase
    .from('team_elo_snapshots')
    .select('elo')
    .eq('team_id', awayTeamId)
    .eq('season', season)
    .lte('week', maxWeek)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  const homeElo = homeEloData?.elo || DEFAULT_ELO_CONFIG.baseRating;
  const awayElo = awayEloData?.elo || DEFAULT_ELO_CONFIG.baseRating;

  // Calculate spread: (home_elo - away_elo) / 25 + HFA
  const eloDiff = homeElo - awayElo;
  const spreadFromElo = eloDiff / DEFAULT_ELO_CONFIG.ratingToPointsDivisor;
  const modelSpreadHome = -(spreadFromElo + DEFAULT_ELO_CONFIG.homeFieldAdvantage);

  return {
    modelVersionId,
    modelSpreadHome: Math.round(modelSpreadHome * 2) / 2, // Round to 0.5
    homeElo,
    awayElo,
  };
}

/**
 * Generate market-anchored projection
 */
async function generateMarketAnchoredProjection(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  modelVersionId: string
): Promise<DualProjectionResult['marketAnchored']> {
  // Get event details (need commence_time for bowl game check)
  const { data: eventData } = await supabase
    .from('events')
    .select('commence_time')
    .eq('id', eventId)
    .single();

  // Get current market line (latest spread tick)
  const { data: latestTick } = await supabase
    .from('odds_ticks')
    .select('spread_points_home')
    .eq('event_id', eventId)
    .eq('market_type', 'spread')
    .not('spread_points_home', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!latestTick?.spread_points_home) {
    // No market line available - cannot generate market-anchored projection
    return null;
  }

  const marketBaseline = latestTick.spread_points_home;
  const gameDate = eventData?.commence_time ? new Date(eventData.commence_time) : new Date();

  // Calculate adjustments
  const adjustments = {
    conference: 0,
    injuries: 0,
    lineMovement: 0,
    weather: 0,
    situational: 0,
    bowlGame: 0,
    total: 0,
  };

  try {
    // Bowl game adjustment - reduce home field advantage for neutral sites
    const bowlAdj = getBowlGameAdjustment(gameDate);
    adjustments.bowlGame = bowlAdj.isBowl ? -bowlAdj.homeFieldReduction : 0;

    // Note: Conference, line movement, and situational adjustments disabled
    // due to function signature mismatches. TODO: Fix and re-enable.

  } catch (err) {
    // If any adjustment fails, continue with zeros
    console.warn('[MarketAnchored] Adjustment calculation error:', err);
  }

  // Calculate total adjustment
  adjustments.total = Object.values(adjustments).reduce((sum, v) => sum + v, 0) - adjustments.total;

  // Apply adjustments to market baseline
  // Cap the total adjustment to maxReasonableEdge
  const cappedAdjustment = Math.max(
    -MARKET_ANCHORED_COEFFICIENTS.maxReasonableEdge,
    Math.min(MARKET_ANCHORED_COEFFICIENTS.maxReasonableEdge, adjustments.total)
  );

  const modelSpreadHome = marketBaseline + cappedAdjustment;

  return {
    modelVersionId,
    modelSpreadHome: Math.round(modelSpreadHome * 2) / 2,
    marketBaseline,
    adjustments,
  };
}

/**
 * Save dual projections to database
 */
export async function saveDualProjections(projection: DualProjectionResult): Promise<void> {
  const projections = [];

  // Save Elo-raw projection
  if (projection.eloRaw) {
    projections.push({
      event_id: projection.eventId,
      model_version_id: projection.eloRaw.modelVersionId,
      generated_at: new Date().toISOString(),
      model_spread_home: projection.eloRaw.modelSpreadHome,
      model_total_points: 0, // Spread model only - 0 indicates no total projection
      home_rating: projection.eloRaw.homeElo,
      away_rating: projection.eloRaw.awayElo,
      home_avg_points_for: 0,
      home_avg_points_against: 0,
      away_avg_points_for: 0,
      away_avg_points_against: 0,
    });
  }

  // Save market-anchored projection
  if (projection.marketAnchored) {
    projections.push({
      event_id: projection.eventId,
      model_version_id: projection.marketAnchored.modelVersionId,
      generated_at: new Date().toISOString(),
      model_spread_home: projection.marketAnchored.modelSpreadHome,
      model_total_points: 0, // Spread model only - 0 indicates no total projection
      home_rating: projection.marketAnchored.marketBaseline, // Store baseline in home_rating
      away_rating: projection.marketAnchored.adjustments.total, // Store adjustment in away_rating
      home_avg_points_for: 0,
      home_avg_points_against: 0,
      away_avg_points_for: 0,
      away_avg_points_against: 0,
    });
  }

  if (projections.length === 0) return;

  const { error } = await supabase
    .from('projections')
    .upsert(projections, {
      onConflict: 'event_id,model_version_id',
    });

  if (error) throw error;
}

/**
 * Get projection by event and model version
 */
export async function getProjection(
  eventId: string,
  modelVersionName: string
): Promise<{ modelSpreadHome: number; modelVersionId: string } | null> {
  const modelVersionIds = await getModelVersionIds();
  const modelVersionId = modelVersionIds.get(modelVersionName);

  if (!modelVersionId) return null;

  const { data } = await supabase
    .from('projections')
    .select('model_spread_home, model_version_id')
    .eq('event_id', eventId)
    .eq('model_version_id', modelVersionId)
    .single();

  if (!data) return null;

  return {
    modelSpreadHome: data.model_spread_home,
    modelVersionId: data.model_version_id,
  };
}

/**
 * Get both projections for an event (for disagreement calculation)
 */
export async function getBothProjections(eventId: string): Promise<{
  marketAnchored: number | null;
  eloRaw: number | null;
  disagreementPoints: number | null;
}> {
  const marketAnchored = await getProjection(eventId, MODEL_VERSIONS.MARKET_ANCHORED);
  const eloRaw = await getProjection(eventId, MODEL_VERSIONS.ELO_RAW);

  const disagreementPoints =
    marketAnchored && eloRaw
      ? Math.abs(marketAnchored.modelSpreadHome - eloRaw.modelSpreadHome)
      : null;

  return {
    marketAnchored: marketAnchored?.modelSpreadHome ?? null,
    eloRaw: eloRaw?.modelSpreadHome ?? null,
    disagreementPoints,
  };
}
