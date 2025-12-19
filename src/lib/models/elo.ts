import { supabase } from '@/lib/db/client';

// Elo model constants
const BASE_RATING = 1500;
const K_FACTOR = 20;
const HOME_FIELD_ADVANTAGE = 2.5; // Points
const RATING_TO_POINTS_DIVISOR = 25; // 25 rating points ≈ 1 point spread

// Recency weighting: last N games get higher weight
const RECENCY_WINDOW = 4; // Last 4 games weighted higher
const RECENCY_MULTIPLIER = 1.5; // 50% more weight for recent games

// Dynamic K-factor adjustments
const K_FACTOR_NEW_TEAM = 32; // Higher K for teams with few games
const K_FACTOR_ESTABLISHED = 16; // Lower K for established ratings
const K_FACTOR_BLOWOUT_CAP = 0.8; // Cap K for blowouts (reduce noise)
const GAMES_UNTIL_ESTABLISHED = 6;

export interface EloConfig {
  baseRating: number;
  kFactor: number;
  homeFieldAdvantage: number;
  ratingToPointsDivisor: number;
  useRecencyWeighting: boolean;
  useDynamicK: boolean;
}

export const DEFAULT_ELO_CONFIG: EloConfig = {
  baseRating: BASE_RATING,
  kFactor: K_FACTOR,
  homeFieldAdvantage: HOME_FIELD_ADVANTAGE,
  ratingToPointsDivisor: RATING_TO_POINTS_DIVISOR,
  useRecencyWeighting: true,
  useDynamicK: true,
};

export interface EloHistoryEntry {
  teamId: string;
  eventId: string;
  season: number;
  week: number | null;
  preGameElo: number;
  postGameElo: number;
  eloChange: number;
  opponentId: string;
  opponentPreElo: number;
  wasHome: boolean;
  teamScore: number;
  opponentScore: number;
  result: 'W' | 'L' | 'T';
  kFactor: number;
}

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

/**
 * Calculate dynamic K-factor based on:
 * - Games played (higher for new teams)
 * - Margin of victory (capped for blowouts to reduce noise)
 */
export function calculateDynamicK(
  gamesPlayed: number,
  marginOfVictory: number,
  baseK: number = K_FACTOR
): number {
  // Start with higher K for new teams, lower for established
  let k = gamesPlayed < GAMES_UNTIL_ESTABLISHED
    ? K_FACTOR_NEW_TEAM
    : K_FACTOR_ESTABLISHED;

  // Cap K for blowouts (>21 point margin)
  // This reduces the impact of garbage time and FCS games
  if (Math.abs(marginOfVictory) > 21) {
    k = k * K_FACTOR_BLOWOUT_CAP;
  }

  return k;
}

/**
 * Get recency-weighted Elo rating
 * Last RECENCY_WINDOW games get higher weight
 */
export async function getRecencyWeightedRating(
  teamId: string,
  season: number
): Promise<{
  currentRating: number;
  recencyAdjustedRating: number;
  recentForm: 'hot' | 'cold' | 'neutral';
  recentRecord: { wins: number; losses: number };
  lastGames: Array<{ opponent: string; result: string; eloChange: number }>;
}> {
  // Get Elo history for this team
  const { data: history } = await supabase
    .from('elo_history')
    .select(`
      *,
      opponent:teams!elo_history_opponent_id_fkey(name)
    `)
    .eq('team_id', teamId)
    .eq('season', season)
    .order('week', { ascending: false })
    .limit(RECENCY_WINDOW);

  // Get current rating
  const { data: currentRatingData } = await supabase
    .from('team_ratings')
    .select('rating')
    .eq('team_id', teamId)
    .eq('season', season)
    .single();

  const currentRating = currentRatingData?.rating || BASE_RATING;

  if (!history || history.length === 0) {
    return {
      currentRating,
      recencyAdjustedRating: currentRating,
      recentForm: 'neutral',
      recentRecord: { wins: 0, losses: 0 },
      lastGames: [],
    };
  }

  // Calculate recency-weighted adjustment
  // Recent wins against good teams boost rating
  // Recent losses to bad teams hurt rating
  let totalWeight = 0;
  let weightedChange = 0;

  for (let i = 0; i < history.length; i++) {
    const game = history[i];
    // Weight decreases for older games
    const weight = RECENCY_MULTIPLIER - (i * (RECENCY_MULTIPLIER - 1) / RECENCY_WINDOW);
    totalWeight += weight;
    weightedChange += game.elo_change * weight;
  }

  // Recency adjustment: amplify recent performance
  const avgWeightedChange = totalWeight > 0 ? weightedChange / totalWeight : 0;
  const recencyBoost = avgWeightedChange * 0.5; // 50% of weighted change as boost

  const recentRecord = {
    wins: history.filter(g => g.result === 'W').length,
    losses: history.filter(g => g.result === 'L').length,
  };

  let recentForm: 'hot' | 'cold' | 'neutral' = 'neutral';
  if (recentRecord.wins >= 3) recentForm = 'hot';
  else if (recentRecord.losses >= 3) recentForm = 'cold';

  const lastGames = history.map(g => ({
    opponent: (g.opponent as { name: string })?.name || 'Unknown',
    result: g.result,
    eloChange: Math.round(g.elo_change),
  }));

  return {
    currentRating,
    recencyAdjustedRating: Math.round(currentRating + recencyBoost),
    recentForm,
    recentRecord,
    lastGames,
  };
}

/**
 * Process game with enhanced Elo tracking (history + dynamic K)
 */
export async function processGameResultEnhanced(
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  modelVersionId: string,
  season: number,
  eventId: string,
  week?: number,
  config: EloConfig = DEFAULT_ELO_CONFIG
): Promise<{
  homeNewRating: number;
  awayNewRating: number;
  homeEloChange: number;
  awayEloChange: number;
  kFactorUsed: number;
}> {
  const homeRating = await getTeamRating(homeTeamId, modelVersionId, season);
  const awayRating = await getTeamRating(awayTeamId, modelVersionId, season);

  // Calculate dynamic K if enabled
  const margin = homeScore - awayScore;
  const kFactor = config.useDynamicK
    ? calculateDynamicK(
        Math.min(homeRating.gamesPlayed, awayRating.gamesPlayed),
        margin,
        config.kFactor
      )
    : config.kFactor;

  // Calculate expected scores (with home field in Elo)
  const homeExpected = expectedWinProbability(
    homeRating.rating + (config.homeFieldAdvantage * config.ratingToPointsDivisor),
    awayRating.rating
  );
  const awayExpected = 1 - homeExpected;

  // Determine actual scores (1 = win, 0.5 = tie, 0 = loss)
  let homeActual: number;
  let awayActual: number;
  let homeResult: 'W' | 'L' | 'T';
  let awayResult: 'W' | 'L' | 'T';

  if (homeScore > awayScore) {
    homeActual = 1;
    awayActual = 0;
    homeResult = 'W';
    awayResult = 'L';
  } else if (homeScore < awayScore) {
    homeActual = 0;
    awayActual = 1;
    homeResult = 'L';
    awayResult = 'W';
  } else {
    homeActual = 0.5;
    awayActual = 0.5;
    homeResult = 'T';
    awayResult = 'T';
  }

  // Calculate new ratings
  const homeNewRating = calculateNewRating(
    homeRating.rating,
    homeExpected,
    homeActual,
    kFactor
  );
  const awayNewRating = calculateNewRating(
    awayRating.rating,
    awayExpected,
    awayActual,
    kFactor
  );

  const homeEloChange = homeNewRating - homeRating.rating;
  const awayEloChange = awayNewRating - awayRating.rating;

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

  // Record Elo history for both teams
  await supabase.from('elo_history').upsert([
    {
      team_id: homeTeamId,
      event_id: eventId,
      season,
      week,
      pre_game_elo: homeRating.rating,
      post_game_elo: homeNewRating,
      elo_change: homeEloChange,
      opponent_id: awayTeamId,
      opponent_pre_elo: awayRating.rating,
      was_home: true,
      team_score: homeScore,
      opponent_score: awayScore,
      result: homeResult,
      k_factor: kFactor,
    },
    {
      team_id: awayTeamId,
      event_id: eventId,
      season,
      week,
      pre_game_elo: awayRating.rating,
      post_game_elo: awayNewRating,
      elo_change: awayEloChange,
      opponent_id: homeTeamId,
      opponent_pre_elo: homeRating.rating,
      was_home: false,
      team_score: awayScore,
      opponent_score: homeScore,
      result: awayResult,
      k_factor: kFactor,
    },
  ], {
    onConflict: 'team_id,event_id',
  });

  return {
    homeNewRating,
    awayNewRating,
    homeEloChange,
    awayEloChange,
    kFactorUsed: kFactor,
  };
}

/**
 * Get projected spread using recency-weighted Elo
 */
export async function getRecencyWeightedSpread(
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  config: EloConfig = DEFAULT_ELO_CONFIG
): Promise<{
  spread: number;
  homeRating: number;
  awayRating: number;
  homeRecencyAdjusted: number;
  awayRecencyAdjusted: number;
  homeForm: 'hot' | 'cold' | 'neutral';
  awayForm: 'hot' | 'cold' | 'neutral';
  confidence: 'high' | 'medium' | 'low';
}> {
  const [homeData, awayData] = await Promise.all([
    getRecencyWeightedRating(homeTeamId, season),
    getRecencyWeightedRating(awayTeamId, season),
  ]);

  // Use recency-adjusted ratings if enabled
  const homeRating = config.useRecencyWeighting
    ? homeData.recencyAdjustedRating
    : homeData.currentRating;
  const awayRating = config.useRecencyWeighting
    ? awayData.recencyAdjustedRating
    : awayData.currentRating;

  // Calculate spread
  const ratingDiff = homeRating - awayRating;
  const spread = -ratingDiffToSpread(ratingDiff, config.homeFieldAdvantage, config.ratingToPointsDivisor);

  // Confidence based on data availability
  const homeGames = homeData.lastGames.length;
  const awayGames = awayData.lastGames.length;
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (homeGames < 2 || awayGames < 2) confidence = 'low';
  else if (homeGames < 4 || awayGames < 4) confidence = 'medium';

  return {
    spread: Math.round(spread * 10) / 10,
    homeRating: homeData.currentRating,
    awayRating: awayData.currentRating,
    homeRecencyAdjusted: homeData.recencyAdjustedRating,
    awayRecencyAdjusted: awayData.recencyAdjustedRating,
    homeForm: homeData.recentForm,
    awayForm: awayData.recentForm,
    confidence,
  };
}
