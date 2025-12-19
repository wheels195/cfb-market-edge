import { supabase } from '@/lib/db/client';
import {
  getTeamRating,
  ratingDiffToSpread,
  getDefaultModelVersionId,
  DEFAULT_ELO_CONFIG,
} from './elo';

// Totals model constants
const DEFAULT_TOTAL = 55; // Average college football game total
const TOTAL_ADJUSTMENT_FACTOR = 0.5; // How much team averages affect projection

export interface ProjectionResult {
  eventId: string;
  modelSpreadHome: number;
  modelTotalPoints: number;
  homeRating: number;
  awayRating: number;
  homeAvgFor: number;
  homeAvgAgainst: number;
  awayAvgFor: number;
  awayAvgAgainst: number;
}

/**
 * Generate projection for a single event
 */
export async function generateProjection(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  modelVersionId?: string
): Promise<ProjectionResult> {
  const mvId = modelVersionId || await getDefaultModelVersionId();

  // Get team ratings
  const homeRating = await getTeamRating(homeTeamId, mvId, season);
  const awayRating = await getTeamRating(awayTeamId, mvId, season);

  // Calculate spread projection
  // Rating difference + home field advantage
  const ratingDiff = homeRating.rating - awayRating.rating;
  const projectedHomeMargin = ratingDiffToSpread(
    ratingDiff,
    DEFAULT_ELO_CONFIG.homeFieldAdvantage,
    DEFAULT_ELO_CONFIG.ratingToPointsDivisor
  );

  // model_spread_home = -projected_home_margin (convention from spec)
  // If home is projected to win by 7, spread should be -7
  const modelSpreadHome = -projectedHomeMargin;

  // Get team stats for totals projection
  const homeStats = await getTeamStats(homeTeamId, season);
  const awayStats = await getTeamStats(awayTeamId, season);

  // Calculate total projection
  // Simple model: average of both teams' scoring + opponent adjustment
  const homeExpectedScore = (homeStats.avgFor + awayStats.avgAgainst) / 2;
  const awayExpectedScore = (awayStats.avgFor + homeStats.avgAgainst) / 2;
  const modelTotalPoints = homeExpectedScore + awayExpectedScore;

  return {
    eventId,
    modelSpreadHome: Math.round(modelSpreadHome * 2) / 2, // Round to nearest 0.5
    modelTotalPoints: Math.round(modelTotalPoints * 2) / 2,
    homeRating: homeRating.rating,
    awayRating: awayRating.rating,
    homeAvgFor: homeStats.avgFor,
    homeAvgAgainst: homeStats.avgAgainst,
    awayAvgFor: awayStats.avgFor,
    awayAvgAgainst: awayStats.avgAgainst,
  };
}

/**
 * Get team stats for totals projection
 */
async function getTeamStats(teamId: string, season: number): Promise<{
  avgFor: number;
  avgAgainst: number;
}> {
  const { data: stats } = await supabase
    .from('team_stats')
    .select('*')
    .eq('team_id', teamId)
    .eq('season', season)
    .single();

  if (stats && stats.games_played > 0) {
    return {
      avgFor: stats.avg_points_for,
      avgAgainst: stats.avg_points_against,
    };
  }

  // Default to league averages if no data
  return {
    avgFor: DEFAULT_TOTAL / 2,
    avgAgainst: DEFAULT_TOTAL / 2,
  };
}

/**
 * Update team stats after a game
 */
export async function updateTeamStats(
  teamId: string,
  season: number,
  pointsFor: number,
  pointsAgainst: number
): Promise<void> {
  // Get existing stats
  const { data: existing } = await supabase
    .from('team_stats')
    .select('*')
    .eq('team_id', teamId)
    .eq('season', season)
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('team_stats')
      .update({
        games_played: existing.games_played + 1,
        total_points_for: existing.total_points_for + pointsFor,
        total_points_against: existing.total_points_against + pointsAgainst,
        last_updated: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    // Create new
    const { error } = await supabase
      .from('team_stats')
      .insert({
        team_id: teamId,
        season,
        games_played: 1,
        total_points_for: pointsFor,
        total_points_against: pointsAgainst,
      });

    if (error) throw error;
  }
}

/**
 * Save projection to database
 */
export async function saveProjection(
  projection: ProjectionResult,
  modelVersionId: string
): Promise<void> {
  const { error } = await supabase
    .from('projections')
    .upsert({
      event_id: projection.eventId,
      model_version_id: modelVersionId,
      generated_at: new Date().toISOString(),
      model_spread_home: projection.modelSpreadHome,
      model_total_points: projection.modelTotalPoints,
      home_rating: projection.homeRating,
      away_rating: projection.awayRating,
      home_avg_points_for: projection.homeAvgFor,
      home_avg_points_against: projection.homeAvgAgainst,
      away_avg_points_for: projection.awayAvgFor,
      away_avg_points_against: projection.awayAvgAgainst,
    }, {
      onConflict: 'event_id,model_version_id',
    });

  if (error) throw error;
}
