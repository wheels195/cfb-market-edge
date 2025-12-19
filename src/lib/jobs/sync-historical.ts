/**
 * Sync historical game results from CollegeFootballData
 * This builds our Elo ratings from actual game data
 */

import { supabase } from '@/lib/db/client';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';
import { processGameResultEnhanced, getDefaultModelVersionId } from '@/lib/models/elo';
import { updateTeamStats } from '@/lib/models/projections';

export interface SyncHistoricalResult {
  seasonsProcessed: number;
  gamesProcessed: number;
  teamsCreated: number;
  eventsCreated: number;
  resultsCreated: number;
  eloUpdates: number;
  closingLinesCreated: number;
  errors: string[];
}

/**
 * Sync all historical data for given seasons
 */
export async function syncHistoricalData(
  seasons: number[] = [2022, 2023, 2024, 2025]
): Promise<SyncHistoricalResult> {
  const result: SyncHistoricalResult = {
    seasonsProcessed: 0,
    gamesProcessed: 0,
    teamsCreated: 0,
    eventsCreated: 0,
    resultsCreated: 0,
    eloUpdates: 0,
    closingLinesCreated: 0,
    errors: [],
  };

  const client = getCFBDApiClient();
  let modelVersionId: string;

  try {
    modelVersionId = await getDefaultModelVersionId();
  } catch {
    // Create default model version if it doesn't exist
    const { data: newVersion, error } = await supabase
      .from('model_versions')
      .insert({
        name: 'elo_v1',
        description: 'Elo rating model v1 with historical calibration',
        config: { baseRating: 1500, kFactor: 20 },
      })
      .select('id')
      .single();

    if (error) throw error;
    modelVersionId = newVersion.id;
  }

  // Process each season in order (chronological for Elo to build properly)
  for (const season of seasons.sort((a, b) => a - b)) {
    console.log(`\nProcessing season ${season}...`);

    try {
      // Get all completed FBS games for this season
      const games = await client.getCompletedGames(season);

      // Filter to only completed games with scores
      const completedGames = games.filter(
        g => g.homePoints !== null && g.awayPoints !== null
      );

      console.log(`Found ${completedGames.length} completed games for ${season}`);

      // Sort by date so Elo updates happen chronologically
      completedGames.sort((a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );

      // Process each game
      for (const game of completedGames) {
        try {
          await processHistoricalGame(game, season, modelVersionId, result);
          result.gamesProcessed++;

          // Progress indicator every 100 games
          if (result.gamesProcessed % 100 === 0) {
            console.log(`  Processed ${result.gamesProcessed} games...`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Game ${game.id}: ${msg}`);
        }
      }

      result.seasonsProcessed++;
      console.log(`Completed season ${season}: ${completedGames.length} games`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Season ${season}: ${msg}`);
    }
  }

  return result;
}

/**
 * Process a single historical game
 */
async function processHistoricalGame(
  game: {
    id: number;
    season: number;
    week: number;
    startDate: string;
    homeTeam: string;
    awayTeam: string;
    homePoints: number | null;
    awayPoints: number | null;
    homeId?: number;
    awayId?: number;
  },
  season: number,
  modelVersionId: string,
  result: SyncHistoricalResult
): Promise<void> {
  if (game.homePoints === null || game.awayPoints === null) return;

  // Ensure teams exist
  const homeTeamId = await ensureTeam(game.homeTeam, game.homeId, result);
  const awayTeamId = await ensureTeam(game.awayTeam, game.awayId, result);

  if (!homeTeamId || !awayTeamId) {
    throw new Error(`Could not create teams: ${game.homeTeam} vs ${game.awayTeam}`);
  }

  // Check if event already exists
  let eventId: string;
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('cfbd_game_id', game.id.toString())
    .single();

  if (existingEvent) {
    eventId = existingEvent.id;
  } else {
    // Create event
    const { data: newEvent, error: eventError } = await supabase
      .from('events')
      .insert({
        cfbd_game_id: game.id.toString(),
        odds_api_event_id: `cfbd_${game.id}`, // Placeholder
        league: 'ncaaf',
        commence_time: game.startDate,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        status: 'final',
      })
      .select('id')
      .single();

    if (eventError) throw eventError;
    eventId = newEvent.id;
    result.eventsCreated++;
  }

  // Check if result already exists
  const { data: existingResult } = await supabase
    .from('results')
    .select('id')
    .eq('event_id', eventId)
    .single();

  if (!existingResult) {
    // Create result
    const { error: resultError } = await supabase
      .from('results')
      .insert({
        event_id: eventId,
        home_score: game.homePoints,
        away_score: game.awayPoints,
        completed_at: game.startDate,
      });

    if (resultError) throw resultError;
    result.resultsCreated++;
  }

  // Process through Elo system
  try {
    await processGameResultEnhanced(
      homeTeamId,
      awayTeamId,
      game.homePoints,
      game.awayPoints,
      modelVersionId,
      season,
      eventId,
      game.week
    );
    result.eloUpdates++;

    // Update team stats for totals model
    await updateTeamStats(homeTeamId, season, game.homePoints, game.awayPoints);
    await updateTeamStats(awayTeamId, season, game.awayPoints, game.homePoints);
  } catch (err) {
    // Elo update failed but game is recorded
    const msg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Elo update for game ${game.id}: ${msg}`);
  }
}

/**
 * Ensure a team exists in the database
 */
async function ensureTeam(
  teamName: string,
  cfbdTeamId: number | undefined,
  result: SyncHistoricalResult
): Promise<string | null> {
  // Check if team exists
  const { data: existing } = await supabase
    .from('teams')
    .select('id')
    .eq('name', teamName)
    .single();

  if (existing) return existing.id;

  // Create team
  const { data: newTeam, error } = await supabase
    .from('teams')
    .insert({
      name: teamName,
      cfbd_team_id: cfbdTeamId?.toString() || null,
    })
    .select('id')
    .single();

  if (error) {
    // Team might have been created by another concurrent insert
    const { data: retry } = await supabase
      .from('teams')
      .select('id')
      .eq('name', teamName)
      .single();

    if (retry) return retry.id;
    return null;
  }

  result.teamsCreated++;
  return newTeam.id;
}

/**
 * Sync historical betting lines for backtesting
 */
export async function syncHistoricalOdds(
  seasons: number[] = [2022, 2023, 2024, 2025]
): Promise<{ linesCreated: number; errors: string[] }> {
  const result = { linesCreated: 0, errors: [] as string[] };
  const client = getCFBDApiClient();

  for (const season of seasons) {
    console.log(`\nFetching betting lines for ${season}...`);

    try {
      // Get all betting lines for the season
      const lines = await client.getBettingLines(season);
      console.log(`Found ${lines.length} games with lines for ${season}`);

      for (const gameLine of lines) {
        try {
          // Find the event in our database
          const { data: event } = await supabase
            .from('events')
            .select('id')
            .eq('cfbd_game_id', gameLine.id.toString())
            .single();

          if (!event) continue;

          // Get sportsbook IDs
          const { data: sportsbooks } = await supabase
            .from('sportsbooks')
            .select('id, key');

          if (!sportsbooks) continue;

          // Process each line from the game
          for (const line of gameLine.lines || []) {
            // Find matching sportsbook (or use consensus)
            const provider = line.provider?.toLowerCase() || 'consensus';
            let sportsbookId: string | null = null;

            // Map CFBD providers to our sportsbooks
            if (provider.includes('draftkings')) {
              sportsbookId = sportsbooks.find(s => s.key === 'draftkings')?.id || null;
            } else if (provider.includes('fanduel')) {
              sportsbookId = sportsbooks.find(s => s.key === 'fanduel')?.id || null;
            } else if (provider.includes('bovada')) {
              sportsbookId = sportsbooks.find(s => s.key === 'bovada')?.id || null;
            }

            // Use first sportsbook as fallback for consensus lines
            if (!sportsbookId && sportsbooks.length > 0) {
              sportsbookId = sportsbooks[0].id;
            }

            if (!sportsbookId) continue;

            // Insert closing line for spread
            if (line.spread !== null && line.spread !== undefined) {
              const { error: spreadError } = await supabase
                .from('closing_lines')
                .upsert({
                  event_id: event.id,
                  sportsbook_id: sportsbookId,
                  market_type: 'spread',
                  spread_points_home: line.spread,
                  price_american: line.homeMoneyline || -110,
                  captured_at: gameLine.startDate,
                }, {
                  onConflict: 'event_id,sportsbook_id,market_type',
                });

              if (!spreadError) result.linesCreated++;
            }

            // Insert closing line for total
            if (line.overUnder !== null && line.overUnder !== undefined) {
              const { error: totalError } = await supabase
                .from('closing_lines')
                .upsert({
                  event_id: event.id,
                  sportsbook_id: sportsbookId,
                  market_type: 'total',
                  total_points: line.overUnder,
                  price_american: -110,
                  captured_at: gameLine.startDate,
                }, {
                  onConflict: 'event_id,sportsbook_id,market_type',
                });

              if (!totalError) result.linesCreated++;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Game ${gameLine.id}: ${msg}`);
        }
      }

      console.log(`Created ${result.linesCreated} closing lines so far`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Season ${season} lines: ${msg}`);
    }
  }

  return result;
}

/**
 * Get summary of current Elo ratings after sync
 */
export async function getEloSummary(): Promise<{
  totalTeams: number;
  teamsWithGames: number;
  topRatings: Array<{ team: string; rating: number; games: number }>;
  bottomRatings: Array<{ team: string; rating: number; games: number }>;
  averageRating: number;
  ratingSpread: number;
}> {
  const { data: ratings } = await supabase
    .from('team_ratings')
    .select(`
      rating,
      games_played,
      teams!inner(name)
    `)
    .eq('season', 2025)
    .order('rating', { ascending: false });

  if (!ratings || ratings.length === 0) {
    return {
      totalTeams: 0,
      teamsWithGames: 0,
      topRatings: [],
      bottomRatings: [],
      averageRating: 1500,
      ratingSpread: 0,
    };
  }

  const teamsWithGames = ratings.filter(r => r.games_played > 0);
  const allRatings = ratings.map(r => r.rating);
  const avgRating = allRatings.reduce((a, b) => a + b, 0) / allRatings.length;

  return {
    totalTeams: ratings.length,
    teamsWithGames: teamsWithGames.length,
    topRatings: ratings.slice(0, 10).map(r => ({
      team: (Array.isArray(r.teams) ? (r.teams[0] as { name: string })?.name : (r.teams as { name: string })?.name) || 'Unknown',
      rating: Math.round(r.rating),
      games: r.games_played,
    })),
    bottomRatings: ratings.slice(-10).reverse().map(r => ({
      team: (Array.isArray(r.teams) ? (r.teams[0] as { name: string })?.name : (r.teams as { name: string })?.name) || 'Unknown',
      rating: Math.round(r.rating),
      games: r.games_played,
    })),
    averageRating: Math.round(avgRating),
    ratingSpread: Math.round(Math.max(...allRatings) - Math.min(...allRatings)),
  };
}
