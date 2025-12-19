import { supabase } from '@/lib/db/client';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

const K_FACTOR = 20; // How much ratings change per game
const HOME_ADVANTAGE = 55; // Elo points for home field (roughly 2.5-3 pts on spread)
const BASE_RATING = 1500;

interface TeamRating {
  teamId: string;
  teamName: string;
  rating: number;
  gamesPlayed: number;
}

export interface SeedEloResult {
  seasonsProcessed: number;
  gamesProcessed: number;
  teamsRated: number;
  errors: string[];
}

/**
 * Calculate expected win probability based on Elo difference
 */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new Elo rating after a game
 */
function calculateNewRating(
  rating: number,
  expected: number,
  actual: number, // 1 for win, 0 for loss, 0.5 for tie
  marginMultiplier: number = 1
): number {
  return rating + K_FACTOR * marginMultiplier * (actual - expected);
}

/**
 * Margin of victory multiplier (bigger wins = bigger rating changes)
 */
function getMarginMultiplier(winnerScore: number, loserScore: number, eloDiff: number): number {
  const margin = winnerScore - loserScore;
  // Log-based multiplier capped to prevent extreme swings
  const base = Math.log(Math.max(margin, 1) + 1);
  // Reduce multiplier for expected blowouts
  const adjustment = eloDiff > 0 ? 2.2 / ((eloDiff * 0.001) + 2.2) : 1;
  return Math.min(base * adjustment, 3);
}

/**
 * Seed Elo ratings from historical CFBD data
 */
export async function seedEloRatings(seasons: number[] = [2022, 2023, 2024]): Promise<SeedEloResult> {
  const result: SeedEloResult = {
    seasonsProcessed: 0,
    gamesProcessed: 0,
    teamsRated: 0,
    errors: [],
  };

  const client = getCFBDApiClient();

  // Track ratings in memory
  const ratings: Map<string, TeamRating> = new Map();

  // Get or create team mapping
  const teamNameToId: Map<string, string> = new Map();

  // Load existing teams from our database
  const { data: existingTeams } = await supabase
    .from('teams')
    .select('id, name');

  // Helper to normalize team names for matching
  const normalizeTeamName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  };

  // Build multiple lookup keys for each team
  if (existingTeams) {
    for (const team of existingTeams) {
      const fullName = normalizeTeamName(team.name);
      teamNameToId.set(fullName, team.id);

      // Also index by just the school name (e.g., "Alabama" from "Alabama Crimson Tide")
      const parts = fullName.split(' ');
      if (parts.length > 1) {
        // Try first word (e.g., "Alabama", "Oregon", "Georgia")
        teamNameToId.set(parts[0], team.id);
        // Try first two words (e.g., "Ohio State", "Texas AM", "NC State")
        teamNameToId.set(parts.slice(0, 2).join(' '), team.id);
        // Try first three words for longer names
        if (parts.length > 2) {
          teamNameToId.set(parts.slice(0, 3).join(' '), team.id);
        }
      }
    }
  }

  // Helper to find team ID with fuzzy matching
  const findTeamId = (cfbdName: string): string => {
    const normalized = normalizeTeamName(cfbdName);

    // Direct match
    if (teamNameToId.has(normalized)) {
      return teamNameToId.get(normalized)!;
    }

    // Try partial matches
    for (const [key, id] of teamNameToId.entries()) {
      if (key.startsWith(normalized) || normalized.startsWith(key)) {
        return id;
      }
    }

    return '';
  };

  // Get model version for elo_v1
  const { data: modelVersion } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'elo_v1')
    .single();

  if (!modelVersion) {
    result.errors.push('Model version elo_v1 not found');
    return result;
  }

  // Process each season in order
  for (const season of seasons.sort((a, b) => a - b)) {
    try {
      console.log(`Processing season ${season}...`);

      // Fetch all completed FBS games for the season
      const games = await client.getCompletedGames(season);

      // Sort games by date
      const sortedGames = games
        .filter(g => g.homePoints !== null && g.awayPoints !== null)
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

      console.log(`Found ${sortedGames.length} completed games for ${season}`);

      for (const game of sortedGames) {
        try {
          const homeTeam = game.homeTeam;
          const awayTeam = game.awayTeam;
          const homeScore = game.homePoints!;
          const awayScore = game.awayPoints!;

          // Initialize ratings if needed
          if (!ratings.has(homeTeam)) {
            ratings.set(homeTeam, {
              teamId: findTeamId(homeTeam),
              teamName: homeTeam,
              rating: BASE_RATING,
              gamesPlayed: 0,
            });
          }
          if (!ratings.has(awayTeam)) {
            ratings.set(awayTeam, {
              teamId: findTeamId(awayTeam),
              teamName: awayTeam,
              rating: BASE_RATING,
              gamesPlayed: 0,
            });
          }

          const homeRating = ratings.get(homeTeam)!;
          const awayRating = ratings.get(awayTeam)!;

          // Add home advantage to home team's effective rating
          const homeEffective = homeRating.rating + HOME_ADVANTAGE;
          const awayEffective = awayRating.rating;

          // Calculate expected scores
          const homeExpected = expectedScore(homeEffective, awayEffective);
          const awayExpected = 1 - homeExpected;

          // Determine actual outcome
          let homeActual: number;
          let awayActual: number;
          if (homeScore > awayScore) {
            homeActual = 1;
            awayActual = 0;
          } else if (awayScore > homeScore) {
            homeActual = 0;
            awayActual = 1;
          } else {
            homeActual = 0.5;
            awayActual = 0.5;
          }

          // Calculate margin multiplier
          const winnerScore = Math.max(homeScore, awayScore);
          const loserScore = Math.min(homeScore, awayScore);
          const eloDiff = homeActual === 1
            ? homeEffective - awayEffective
            : awayEffective - homeEffective;
          const marginMult = getMarginMultiplier(winnerScore, loserScore, eloDiff);

          // Update ratings
          homeRating.rating = calculateNewRating(homeRating.rating, homeExpected, homeActual, marginMult);
          awayRating.rating = calculateNewRating(awayRating.rating, awayExpected, awayActual, marginMult);
          homeRating.gamesPlayed++;
          awayRating.gamesPlayed++;

          result.gamesProcessed++;
        } catch (gameErr) {
          // Skip individual game errors
        }
      }

      result.seasonsProcessed++;
    } catch (seasonErr) {
      const message = seasonErr instanceof Error ? seasonErr.message : 'Unknown error';
      result.errors.push(`Season ${season}: ${message}`);
    }
  }

  // Save ratings to database
  const currentSeason = Math.max(...seasons);

  // Deduplicate by team ID (multiple CFBD names may map to same DB team)
  const teamIdToRating = new Map<string, TeamRating>();
  for (const rating of ratings.values()) {
    if (!rating.teamId) continue;

    const existing = teamIdToRating.get(rating.teamId);
    if (!existing || rating.gamesPlayed > existing.gamesPlayed) {
      // Keep the rating with more games played
      teamIdToRating.set(rating.teamId, rating);
    }
  }

  const ratingsToUpsert = Array.from(teamIdToRating.values())
    .map(r => ({
      team_id: r.teamId,
      model_version_id: modelVersion.id,
      rating: Math.round(r.rating),
      games_played: r.gamesPlayed,
      season: currentSeason,
      last_updated: new Date().toISOString(),
    }));

  // Also create ratings for next season (2025) with mean reversion
  const nextSeason = currentSeason + 1;
  const nextSeasonRatings = Array.from(teamIdToRating.values())
    .map(r => ({
      team_id: r.teamId,
      model_version_id: modelVersion.id,
      // Mean reversion: 2/3 of rating + 1/3 of baseline
      rating: Math.round((r.rating * 0.67) + (BASE_RATING * 0.33)),
      games_played: 0,
      season: nextSeason,
      last_updated: new Date().toISOString(),
    }));

  if (ratingsToUpsert.length > 0) {
    // Save historical season ratings
    const { error: upsertError } = await supabase
      .from('team_ratings')
      .upsert(ratingsToUpsert, {
        onConflict: 'team_id,model_version_id,season',
      });

    if (upsertError) {
      result.errors.push(`Failed to save ratings: ${upsertError.message}`);
    }

    // Save next season ratings with mean reversion
    const { error: nextSeasonError } = await supabase
      .from('team_ratings')
      .upsert(nextSeasonRatings, {
        onConflict: 'team_id,model_version_id,season',
      });

    if (nextSeasonError) {
      result.errors.push(`Failed to save next season ratings: ${nextSeasonError.message}`);
    }

    if (!upsertError && !nextSeasonError) {
      result.teamsRated = ratingsToUpsert.length;
    }
  }

  // Log top and bottom teams for verification
  const sortedRatings = Array.from(ratings.values())
    .sort((a, b) => b.rating - a.rating);

  console.log('\nTop 10 teams by Elo:');
  sortedRatings.slice(0, 10).forEach((t, i) => {
    console.log(`${i + 1}. ${t.teamName}: ${Math.round(t.rating)}`);
  });

  console.log('\nBottom 10 teams by Elo:');
  sortedRatings.slice(-10).forEach((t, i) => {
    console.log(`${sortedRatings.length - 9 + i}. ${t.teamName}: ${Math.round(t.rating)}`);
  });

  return result;
}
