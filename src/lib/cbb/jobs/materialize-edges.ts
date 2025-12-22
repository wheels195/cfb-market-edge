/**
 * CBB Materialize Edges Job
 *
 * Calculates predictions for all upcoming games using Elo model
 * Identifies which games qualify for bets (underdog + 10+ spread + 2.5-5 edge)
 */

import { supabase } from '@/lib/db/client';
import {
  CbbEloSystem,
  analyzeCbbBet,
  CBB_BET_CRITERIA,
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
 * Load Elo ratings from database
 */
async function loadEloRatings(
  elo: CbbEloSystem,
  season: number
): Promise<number> {
  const { data, error } = await supabase
    .from('cbb_elo_snapshots')
    .select('team_id, elo, games_played')
    .eq('season', season);

  if (error) {
    console.error('Error loading Elo:', error);
    return 0;
  }

  for (const row of data || []) {
    elo.setElo(row.team_id, row.elo, row.games_played);
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
  const { data: games, error } = await supabase
    .from('cbb_games')
    .select(`
      id,
      home_team_id,
      away_team_id,
      home_team_name,
      away_team_name,
      start_date
    `)
    .gte('start_date', now.toISOString())
    .lte('start_date', future.toISOString())
    .is('home_score', null) // Only upcoming games
    .not('home_team_id', 'is', null) // D1 filter: home team must be matched
    .not('away_team_id', 'is', null); // D1 filter: away team must be matched

  if (error) {
    console.error('Error fetching games:', error);
    return [];
  }

  // Get latest odds for these games
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
    // Get latest odds tick
    const { data: odds } = await supabase
      .from('cbb_odds_ticks')
      .select('spread_home')
      .or(`home_team.ilike.%${game.home_team_name}%,away_team.ilike.%${game.away_team_name}%`)
      .order('captured_at', { ascending: false })
      .limit(1);

    if (odds?.[0]?.spread_home !== null && odds?.[0]?.spread_home !== undefined) {
      results.push({
        game_id: game.id,
        home_team_id: game.home_team_id,
        away_team_id: game.away_team_id,
        home_team_name: game.home_team_name,
        away_team_name: game.away_team_name,
        start_date: game.start_date,
        spread_home: odds[0].spread_home,
      });
    }
  }

  return results;
}

/**
 * Materialize edges for upcoming CBB games
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

    // Load Elo ratings
    const elo = new CbbEloSystem();
    const ratingCount = await loadEloRatings(elo, season);
    console.log(`Loaded ${ratingCount} Elo ratings`);

    if (ratingCount === 0) {
      result.errors.push('No Elo ratings loaded - run seed-cbb-elo first');
      return result;
    }

    // Get upcoming games with odds
    const games = await getUpcomingGamesWithOdds();
    console.log(`Found ${games.length} games with odds`);

    for (const game of games) {
      try {
        // Get Elo ratings
        const homeElo = elo.getElo(game.home_team_id);
        const awayElo = elo.getElo(game.away_team_id);
        const homeGames = elo.getGamesPlayed(game.home_team_id);
        const awayGames = elo.getGamesPlayed(game.away_team_id);

        // Calculate model spread
        const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_home;

        // Analyze bet
        const analysis = analyzeCbbBet(
          marketSpread,
          modelSpread,
          homeGames,
          awayGames
        );

        // Build prediction record
        const prediction = {
          game_id: game.game_id,
          model_spread_home: modelSpread,
          market_spread_home: marketSpread,
          edge_points: analysis.absEdge,
          predicted_side: analysis.side || (analysis.edge > 0 ? 'home' : 'away'),
          home_elo: homeElo,
          away_elo: awayElo,
          home_games_played: homeGames,
          away_games_played: awayGames,
          spread_size: analysis.spreadSize,
          is_underdog_bet: analysis.isUnderdog,
          qualifies_for_bet: analysis.qualifies,
          qualification_reason: analysis.qualificationReason || analysis.reason,
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
    .is('cbb_games.home_score', null) // Only upcoming
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
