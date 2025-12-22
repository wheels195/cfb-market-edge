/**
 * CBB Update Elo Job
 *
 * Processes completed games and updates Elo ratings
 * Run daily after games complete (e.g., 6:30 AM)
 */

import { supabase } from '@/lib/db/client';
import { CbbEloSystem, CBB_ELO_CONSTANTS } from '@/lib/models/cbb-elo';

export interface CbbUpdateEloResult {
  gamesProcessed: number;
  ratingsUpdated: number;
  errors: string[];
}

/**
 * Get the current season (based on date)
 * CBB season starts in November, ends in April
 */
function getCurrentSeason(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  // If November-December, it's the season starting that year
  // If January-April, it's the season that started previous year
  if (month >= 11) {
    return year + 1; // e.g., Nov 2024 = 2025 season
  } else if (month <= 4) {
    return year; // e.g., Jan 2025 = 2025 season
  }
  // Off-season (May-October) - return upcoming season
  return year + 1;
}

/**
 * Load current Elo ratings from database
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
    console.error('Error loading Elo ratings:', error);
    return 0;
  }

  for (const row of data || []) {
    elo.setElo(row.team_id, row.elo, row.games_played);
  }

  return data?.length || 0;
}

/**
 * Save updated Elo ratings to database
 */
async function saveEloRatings(
  elo: CbbEloSystem,
  season: number
): Promise<number> {
  const ratings = elo.getAllRatings();

  const snapshots = ratings.map(r => ({
    team_id: r.teamId,
    season,
    games_played: r.gamesPlayed,
    elo: r.elo,
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert
  const BATCH_SIZE = 500;
  let saved = 0;

  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('cbb_elo_snapshots')
      .upsert(batch, {
        onConflict: 'team_id,season',
      });

    if (error) {
      console.error(`Error saving batch:`, error);
    } else {
      saved += batch.length;
    }
  }

  return saved;
}

/**
 * Get unprocessed completed games
 */
async function getUnprocessedGames(season: number): Promise<Array<{
  id: string;
  start_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}>> {
  // Get games with scores that don't have Elo updates
  // D1 filter: only process games where both teams are matched
  const { data: games, error } = await supabase
    .from('cbb_games')
    .select('id, start_date, home_team_id, away_team_id, home_score, away_score')
    .eq('season', season)
    .not('home_score', 'is', null)
    .not('home_team_id', 'is', null) // D1 filter
    .not('away_team_id', 'is', null) // D1 filter
    .order('start_date', { ascending: true });

  if (error) {
    console.error('Error fetching games:', error);
    return [];
  }

  return games || [];
}

/**
 * Update Elo ratings for completed games
 */
export async function updateCbbElo(): Promise<CbbUpdateEloResult> {
  const result: CbbUpdateEloResult = {
    gamesProcessed: 0,
    ratingsUpdated: 0,
    errors: [],
  };

  try {
    const season = getCurrentSeason();
    console.log(`Processing CBB Elo updates for season ${season}`);

    // Initialize Elo system
    const elo = new CbbEloSystem();

    // Load existing ratings
    const existingCount = await loadEloRatings(elo, season);
    console.log(`Loaded ${existingCount} existing ratings`);

    // Get all completed games for this season
    const games = await getUnprocessedGames(season);
    console.log(`Found ${games.length} completed games`);

    // Track games already processed (by checking games_played count)
    const processedGames = new Set<string>();

    // Process games in chronological order
    for (const game of games) {
      const gameKey = `${game.home_team_id}-${game.away_team_id}-${game.start_date}`;

      // Skip already processed
      if (processedGames.has(gameKey)) continue;

      try {
        // Check if both teams have correct games_played count
        const homeGames = elo.getGamesPlayed(game.home_team_id);
        const awayGames = elo.getGamesPlayed(game.away_team_id);

        // Count how many games each team should have played
        const homeGamesInDb = games.filter(g =>
          (g.home_team_id === game.home_team_id || g.away_team_id === game.home_team_id) &&
          new Date(g.start_date) < new Date(game.start_date)
        ).length;

        const awayGamesInDb = games.filter(g =>
          (g.home_team_id === game.away_team_id || g.away_team_id === game.away_team_id) &&
          new Date(g.start_date) < new Date(game.start_date)
        ).length;

        // If games played doesn't match, need to process this game
        if (homeGames === homeGamesInDb && awayGames === awayGamesInDb) {
          // Process this game
          elo.update(
            game.home_team_id,
            game.away_team_id,
            game.home_score,
            game.away_score
          );
          result.gamesProcessed++;
          processedGames.add(gameKey);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Game ${game.id}: ${message}`);
      }
    }

    // Save updated ratings
    result.ratingsUpdated = await saveEloRatings(elo, season);

    console.log(`Processed ${result.gamesProcessed} games, updated ${result.ratingsUpdated} ratings`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Job error: ${message}`);
  }

  return result;
}

/**
 * Full rebuild of Elo ratings for a season
 * Use when you need to recalculate from scratch
 */
export async function rebuildCbbElo(season: number): Promise<CbbUpdateEloResult> {
  const result: CbbUpdateEloResult = {
    gamesProcessed: 0,
    ratingsUpdated: 0,
    errors: [],
  };

  try {
    console.log(`Rebuilding CBB Elo for season ${season}`);

    const elo = new CbbEloSystem();

    // Load prior season for carryover
    if (season > 2020) {
      await loadEloRatings(elo, season - 1);
      elo.resetSeason();
    }

    // Get all completed games (D1 only)
    const { data: games, error } = await supabase
      .from('cbb_games')
      .select('id, start_date, home_team_id, away_team_id, home_score, away_score')
      .eq('season', season)
      .not('home_score', 'is', null)
      .not('home_team_id', 'is', null) // D1 filter
      .not('away_team_id', 'is', null) // D1 filter
      .order('start_date', { ascending: true });

    if (error) {
      result.errors.push(`Error fetching games: ${error.message}`);
      return result;
    }

    // Process all games
    for (const game of games || []) {
      elo.update(
        game.home_team_id,
        game.away_team_id,
        game.home_score,
        game.away_score
      );
      result.gamesProcessed++;
    }

    // Save ratings
    result.ratingsUpdated = await saveEloRatings(elo, season);

    console.log(`Rebuilt ${result.gamesProcessed} games, saved ${result.ratingsUpdated} ratings`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Rebuild error: ${message}`);
  }

  return result;
}
