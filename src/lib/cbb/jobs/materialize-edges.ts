/**
 * CBB Materialize Edges Job (Conference-Aware Model v2)
 *
 * Calculates predictions for all upcoming games using the conference-aware rating model.
 * Identifies which games qualify for bets using the validated strategy:
 * - Elite/High tier conference favorites
 * - 7-14 point spread
 * - 3+ point edge
 */

import { supabase } from '@/lib/db/client';
import {
  CbbRatingSystem,
  analyzeCbbBet,
  CBB_BET_CRITERIA,
  CBB_RATING_CONSTANTS,
} from '@/lib/models/cbb-elo';

export interface CbbMaterializeEdgesResult {
  gamesProcessed: number;
  predictionsWritten: number;
  qualifyingBets: number;
  errors: string[];
}

/**
 * Get the current season
 */
function getCurrentSeason(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  if (month >= 11) return year + 1;
  if (month <= 4) return year;
  return year + 1;
}

/**
 * Load team conferences from database
 */
async function loadTeamConferences(
  ratingSystem: CbbRatingSystem
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('cbb_teams')
    .select('id, conference');

  if (error) {
    console.error('Error loading team conferences:', error);
    return new Map();
  }

  const confMap = new Map<string, string>();
  for (const team of data || []) {
    if (team.conference) {
      ratingSystem.setTeamConference(team.id, team.conference);
      confMap.set(team.id, team.conference);
    }
  }

  return confMap;
}

/**
 * Load ratings from database
 */
async function loadRatings(
  ratingSystem: CbbRatingSystem,
  season: number
): Promise<number> {
  const { data, error } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', season);

  if (error) {
    console.error('Error loading ratings:', error);
    return 0;
  }

  for (const row of data || []) {
    // DB column is 'elo' but stores the team rating value
    ratingSystem.setRating(row.team_id, row.elo, row.games_played);
  }

  return data?.length || 0;
}

/**
 * Get upcoming games with betting lines
 */
async function getUpcomingGamesWithOdds(): Promise<Array<{
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  start_date: string;
  spread_home: number;
}>> {
  const now = new Date();
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead

  // Get games with recent odds (D1 only - both team IDs must exist)
  // CBBD uses 0 for upcoming games, not null
  const { data: games, error } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_id,
      away_team_id,
      home_team_name,
      away_team_name,
      start_date,
      cbb_betting_lines (
        spread_home,
        provider
      )
    `)
    .gte('start_date', now.toISOString())
    .lte('start_date', future.toISOString())
    .eq('home_score', 0) // CBBD uses 0 for upcoming, not null
    .eq('away_score', 0)
    .not('home_team_id', 'is', null) // D1 filter: home team must be matched
    .not('away_team_id', 'is', null); // D1 filter: away team must be matched

  if (error) {
    console.error('Error fetching games:', error);
    return [];
  }

  // Filter games that have betting lines
  const results: Array<{
    game_id: string;
    home_team_id: string;
    away_team_id: string;
    home_team_name: string;
    away_team_name: string;
    start_date: string;
    spread_home: number;
  }> = [];

  for (const game of games || []) {
    const bettingLines = (game as any).cbb_betting_lines as Array<{ spread_home: number; provider: string }> | null;
    const line = bettingLines?.[0];

    if (line?.spread_home !== null && line?.spread_home !== undefined) {
      results.push({
        game_id: game.id,
        home_team_id: game.home_team_id,
        away_team_id: game.away_team_id,
        home_team_name: game.home_team_name,
        away_team_name: game.away_team_name,
        start_date: game.start_date,
        spread_home: line.spread_home,
      });
    }
  }

  return results;
}

/**
 * Materialize edges for upcoming CBB games
 *
 * Uses the validated conference-aware model:
 * - Elite/High tier conference favorites (Big 12, SEC, Big Ten, Big East, ACC, MWC)
 * - 7-14 point spread
 * - 3+ point edge
 */
export async function materializeCbbEdges(): Promise<CbbMaterializeEdgesResult> {
  const result: CbbMaterializeEdgesResult = {
    gamesProcessed: 0,
    predictionsWritten: 0,
    qualifyingBets: 0,
    errors: [],
  };

  try {
    const season = getCurrentSeason();
    console.log(`Materializing CBB edges for season ${season}`);
    console.log(`Using: HOME_ADV=${CBB_RATING_CONSTANTS.HOME_ADVANTAGE}, MIN_EDGE=${CBB_BET_CRITERIA.MIN_EDGE}, SPREAD=${CBB_BET_CRITERIA.MIN_SPREAD}-${CBB_BET_CRITERIA.MAX_SPREAD}`);

    // Initialize rating system
    const ratingSystem = new CbbRatingSystem();

    // Load team conferences
    const confMap = await loadTeamConferences(ratingSystem);
    console.log(`Loaded ${confMap.size} team conferences`);

    // Load ratings
    const ratingCount = await loadRatings(ratingSystem, season);
    console.log(`Loaded ${ratingCount} team ratings`);

    if (ratingCount === 0) {
      result.errors.push('No ratings loaded - run cbb-update-elo first');
      return result;
    }

    // Get upcoming games with odds
    const games = await getUpcomingGamesWithOdds();
    console.log(`Found ${games.length} games with odds`);

    for (const game of games) {
      try {
        // Get team data
        const homeRating = ratingSystem.getTeamRating(game.home_team_id);
        const awayRating = ratingSystem.getTeamRating(game.away_team_id);
        const homeTotalRating = ratingSystem.getTotalRating(game.home_team_id);
        const awayTotalRating = ratingSystem.getTotalRating(game.away_team_id);
        const homeGames = ratingSystem.getGamesPlayed(game.home_team_id);
        const awayGames = ratingSystem.getGamesPlayed(game.away_team_id);
        const homeConf = confMap.get(game.home_team_id) || null;
        const awayConf = confMap.get(game.away_team_id) || null;

        // Calculate model spread (from home perspective, negative = home favored)
        const modelSpread = ratingSystem.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_home;

        // Analyze bet using new conference-aware criteria
        const analysis = analyzeCbbBet(
          marketSpread,
          modelSpread,
          homeConf,
          awayConf
        );

        // Build prediction record
        const prediction = {
          game_id: game.game_id,
          model_spread_home: modelSpread,
          market_spread_home: marketSpread,
          edge_points: analysis.absEdge,
          predicted_side: analysis.side,
          home_elo: homeTotalRating, // Store total rating (team + conf) for display
          away_elo: awayTotalRating,
          home_games_played: homeGames,
          away_games_played: awayGames,
          spread_size: analysis.spreadSize,
          is_underdog_bet: analysis.isUnderdog,
          qualifies_for_bet: analysis.qualifies,
          qualification_reason: analysis.qualifies ? analysis.qualificationReason : analysis.reason,
          bet_team_conference: analysis.betTeamConference,
          bet_team_tier: analysis.betTeamTier,
          predicted_at: new Date().toISOString(),
        };

        // Upsert prediction
        const { error } = await supabase
          .from('cbb_game_predictions')
          .upsert(prediction, {
            onConflict: 'game_id',
          });

        if (error) {
          result.errors.push(`Game ${game.game_id}: ${error.message}`);
        } else {
          result.predictionsWritten++;
          if (analysis.qualifies) {
            result.qualifyingBets++;
            console.log(`  BET: ${game.away_team_name} @ ${game.home_team_name} - ${analysis.side.toUpperCase()} ${analysis.qualificationReason}`);
          }
        }

        result.gamesProcessed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Game ${game.game_id}: ${message}`);
      }
    }

    console.log(`Processed ${result.gamesProcessed} games, ${result.qualifyingBets} qualifying bets`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Job error: ${message}`);
  }

  return result;
}

/**
 * Get current predictions with bet recommendations
 */
export async function getCbbPredictions(): Promise<Array<{
  game_id: string;
  home_team_name: string;
  away_team_name: string;
  start_date: string;
  model_spread: number;
  market_spread: number;
  edge: number;
  recommended_side: string | null;
  qualifies: boolean;
  qualification_reason: string | null;
  home_elo: number;
  away_elo: number;
  home_games: number;
  away_games: number;
}>> {
  const now = new Date();

  const { data, error } = await supabase
    .from('cbb_game_predictions')
    .select(`
      game_id,
      model_spread_home,
      market_spread_home,
      edge_points,
      predicted_side,
      qualifies_for_bet,
      qualification_reason,
      home_elo,
      away_elo,
      home_games_played,
      away_games_played,
      cbb_games!inner (
        home_team_name,
        away_team_name,
        start_date,
        home_score
      )
    `)
    .eq('cbb_games.home_score', 0) // CBBD uses 0 for upcoming
    .gte('cbb_games.start_date', now.toISOString())
    .order('cbb_games.start_date', { ascending: true });

  if (error) {
    console.error('Error fetching predictions:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    game_id: row.game_id,
    home_team_name: row.cbb_games.home_team_name,
    away_team_name: row.cbb_games.away_team_name,
    start_date: row.cbb_games.start_date,
    model_spread: row.model_spread_home,
    market_spread: row.market_spread_home,
    edge: row.edge_points,
    recommended_side: row.qualifies_for_bet ? row.predicted_side : null,
    qualifies: row.qualifies_for_bet,
    qualification_reason: row.qualification_reason,
    home_elo: row.home_elo,
    away_elo: row.away_elo,
    home_games: row.home_games_played,
    away_games: row.away_games_played,
  }));
}
