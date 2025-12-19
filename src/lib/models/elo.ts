import { supabase } from '@/lib/db/client';

// Elo model constants
const BASE_RATING = 1500;
const K_FACTOR = 20;
const HOME_FIELD_ADVANTAGE = 2.5; // Points
const RATING_TO_POINTS_DIVISOR = 25; // 25 rating points ≈ 1 point spread

export interface EloConfig {
  baseRating: number;
  kFactor: number;
  homeFieldAdvantage: number;
  ratingToPointsDivisor: number;
}

export const DEFAULT_ELO_CONFIG: EloConfig = {
  baseRating: BASE_RATING,
  kFactor: K_FACTOR,
  homeFieldAdvantage: HOME_FIELD_ADVANTAGE,
  ratingToPointsDivisor: RATING_TO_POINTS_DIVISOR,
};

/**
 * Calculate expected win probability based on Elo ratings
 */
export function expectedWinProbability(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new Elo rating after a game
 */
export function calculateNewRating(
  currentRating: number,
  expectedScore: number,
  actualScore: number,
  kFactor: number = K_FACTOR
): number {
  return currentRating + kFactor * (actualScore - expectedScore);
}

/**
 * Convert Elo rating difference to expected point spread
 * Positive result = team A favored
 */
export function ratingDiffToSpread(
  ratingDiff: number,
  homeFieldAdvantage: number = HOME_FIELD_ADVANTAGE,
  divisor: number = RATING_TO_POINTS_DIVISOR
): number {
  return (ratingDiff / divisor) + homeFieldAdvantage;
}

/**
 * Get or create team rating for current season
 */
export async function getTeamRating(
  teamId: string,
  modelVersionId: string,
  season: number
): Promise<{ id: string; rating: number; gamesPlayed: number }> {
  // Try to get existing rating
  const { data: existing } = await supabase
    .from('team_ratings')
    .select('*')
    .eq('team_id', teamId)
    .eq('model_version_id', modelVersionId)
    .eq('season', season)
    .single();

  if (existing) {
    return {
      id: existing.id,
      rating: existing.rating,
      gamesPlayed: existing.games_played,
    };
  }

  // Check for previous season rating to use as starting point
  const { data: prevSeason } = await supabase
    .from('team_ratings')
    .select('rating')
    .eq('team_id', teamId)
    .eq('model_version_id', modelVersionId)
    .eq('season', season - 1)
    .single();

  // Mean reversion: start new season rating at 2/3 of previous + 1/3 of baseline
  const startingRating = prevSeason
    ? (prevSeason.rating * 0.67) + (BASE_RATING * 0.33)
    : BASE_RATING;

  // Create new rating record
  const { data: newRating, error } = await supabase
    .from('team_ratings')
    .insert({
      team_id: teamId,
      model_version_id: modelVersionId,
      season,
      rating: startingRating,
      games_played: 0,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: newRating.id,
    rating: newRating.rating,
    gamesPlayed: newRating.games_played,
  };
}

/**
 * Update team rating after a game result
 */
export async function updateTeamRating(
  teamId: string,
  modelVersionId: string,
  season: number,
  newRating: number,
  gamesPlayed: number
): Promise<void> {
  const { error } = await supabase
    .from('team_ratings')
    .upsert({
      team_id: teamId,
      model_version_id: modelVersionId,
      season,
      rating: newRating,
      games_played: gamesPlayed,
      last_updated: new Date().toISOString(),
    }, {
      onConflict: 'team_id,model_version_id,season',
    });

  if (error) throw error;
}

/**
 * Process a game result and update both teams' ratings
 */
export async function processGameResult(
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  modelVersionId: string,
  season: number,
  config: EloConfig = DEFAULT_ELO_CONFIG
): Promise<{ homeNewRating: number; awayNewRating: number }> {
  const homeRating = await getTeamRating(homeTeamId, modelVersionId, season);
  const awayRating = await getTeamRating(awayTeamId, modelVersionId, season);

  // Calculate expected scores (with home field in Elo)
  const homeExpected = expectedWinProbability(
    homeRating.rating + (config.homeFieldAdvantage * config.ratingToPointsDivisor),
    awayRating.rating
  );
  const awayExpected = 1 - homeExpected;

  // Determine actual scores (1 = win, 0.5 = tie, 0 = loss)
  let homeActual: number;
  let awayActual: number;
  if (homeScore > awayScore) {
    homeActual = 1;
    awayActual = 0;
  } else if (homeScore < awayScore) {
    homeActual = 0;
    awayActual = 1;
  } else {
    homeActual = 0.5;
    awayActual = 0.5;
  }

  // Calculate new ratings
  const homeNewRating = calculateNewRating(
    homeRating.rating,
    homeExpected,
    homeActual,
    config.kFactor
  );
  const awayNewRating = calculateNewRating(
    awayRating.rating,
    awayExpected,
    awayActual,
    config.kFactor
  );

  // Update ratings in database
  await updateTeamRating(
    homeTeamId,
    modelVersionId,
    season,
    homeNewRating,
    homeRating.gamesPlayed + 1
  );
  await updateTeamRating(
    awayTeamId,
    modelVersionId,
    season,
    awayNewRating,
    awayRating.gamesPlayed + 1
  );

  return { homeNewRating, awayNewRating };
}

/**
 * Get the default model version ID
 */
export async function getDefaultModelVersionId(): Promise<string> {
  const { data, error } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'elo_v1')
    .single();

  if (error || !data) {
    throw new Error('Default model version not found');
  }

  return data.id;
}
