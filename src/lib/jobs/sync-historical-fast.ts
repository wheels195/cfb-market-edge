/**
 * OPTIMIZED Historical Sync - Batch operations for speed
 * Captures ALL game data from CFBD
 */

import { supabase } from '@/lib/db/client';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';
import { CFBDGame } from '@/types/cfbd-api';

const BATCH_SIZE = 100;

export interface FastSyncResult {
  seasonsProcessed: number;
  gamesProcessed: number;
  teamsCreated: number;
  eventsCreated: number;
  resultsCreated: number;
  ratingsUpdated: number;
  apiCalls: number;
  timeSeconds: number;
  errors: string[];
}

/**
 * Fast sync using batch operations
 */
export async function syncHistoricalFast(
  seasons: number[] = [2022, 2023, 2024, 2025]
): Promise<FastSyncResult> {
  const startTime = Date.now();
  const result: FastSyncResult = {
    seasonsProcessed: 0,
    gamesProcessed: 0,
    teamsCreated: 0,
    eventsCreated: 0,
    resultsCreated: 0,
    ratingsUpdated: 0,
    apiCalls: 0,
    timeSeconds: 0,
    errors: [],
  };

  const client = getCFBDApiClient();

  // Step 1: Get or create model version
  let modelVersionId: string;
  const { data: existingVersion } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'elo_v2_historical')
    .single();

  if (existingVersion) {
    modelVersionId = existingVersion.id;
  } else {
    const { data: newVersion } = await supabase
      .from('model_versions')
      .insert({
        name: 'elo_v2_historical',
        description: 'Elo model trained on 2022-2025 historical data',
        config: { baseRating: 1500, kFactor: 20 },
      })
      .select('id')
      .single();
    modelVersionId = newVersion!.id;
  }

  // Step 2: Collect all games from all seasons first (just API calls)
  console.log('Fetching games from CFBD API...');
  const allGames: Array<CFBDGame & { season: number }> = [];

  for (const season of seasons.sort((a, b) => a - b)) {
    console.log(`  Fetching ${season}...`);
    const games = await client.getCompletedGames(season);
    result.apiCalls++;

    // Filter to FBS games with scores (skip D2, D3, etc.)
    const fbsGames = games.filter(g =>
      g.homePoints !== null &&
      g.awayPoints !== null &&
      (g.homeClassification === 'fbs' || g.awayClassification === 'fbs' ||
       !g.homeClassification) // Include if classification not specified
    );

    for (const game of fbsGames) {
      allGames.push({ ...game, season });
    }
    console.log(`  Found ${fbsGames.length} FBS games for ${season}`);
  }

  // Sort all games chronologically for proper Elo progression
  allGames.sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  console.log(`\nTotal games to process: ${allGames.length}`);

  // Step 3: Batch create all teams first
  console.log('\nCreating teams...');
  const teamNames = new Set<string>();
  for (const game of allGames) {
    teamNames.add(game.homeTeam);
    teamNames.add(game.awayTeam);
  }

  // Get existing teams
  const { data: existingTeams } = await supabase
    .from('teams')
    .select('id, name');

  const teamMap = new Map<string, string>();
  for (const team of existingTeams || []) {
    teamMap.set(team.name, team.id);
  }

  // Create missing teams in batches
  const missingTeams = [...teamNames].filter(name => !teamMap.has(name));
  console.log(`  ${teamMap.size} existing teams, ${missingTeams.length} new teams`);

  for (let i = 0; i < missingTeams.length; i += BATCH_SIZE) {
    const batch = missingTeams.slice(i, i + BATCH_SIZE);
    const { data: newTeams, error } = await supabase
      .from('teams')
      .insert(batch.map(name => ({ name })))
      .select('id, name');

    if (error) {
      result.errors.push(`Team batch insert: ${error.message}`);
      continue;
    }

    for (const team of newTeams || []) {
      teamMap.set(team.name, team.id);
      result.teamsCreated++;
    }
  }

  console.log(`  Created ${result.teamsCreated} new teams`);

  // Step 4: Initialize all team ratings
  console.log('\nInitializing team ratings...');
  const ratingsToCreate: Array<{
    team_id: string;
    model_version_id: string;
    season: number;
    rating: number;
    games_played: number;
  }> = [];

  for (const season of seasons) {
    for (const [, teamId] of teamMap) {
      ratingsToCreate.push({
        team_id: teamId,
        model_version_id: modelVersionId,
        season,
        rating: 1500,
        games_played: 0,
      });
    }
  }

  // Batch upsert ratings
  for (let i = 0; i < ratingsToCreate.length; i += BATCH_SIZE) {
    const batch = ratingsToCreate.slice(i, i + BATCH_SIZE);
    await supabase
      .from('team_ratings')
      .upsert(batch, { onConflict: 'team_id,model_version_id,season' });
  }
  console.log(`  Initialized ${ratingsToCreate.length} rating records`);

  // Step 5: Process games in batches
  console.log('\nProcessing games...');

  // Track ratings in memory for speed
  const ratingCache = new Map<string, { rating: number; gamesPlayed: number }>();

  // Initialize cache from database
  const { data: allRatings } = await supabase
    .from('team_ratings')
    .select('team_id, season, rating, games_played')
    .eq('model_version_id', modelVersionId);

  for (const r of allRatings || []) {
    const key = `${r.team_id}_${r.season}`;
    ratingCache.set(key, { rating: r.rating, gamesPlayed: r.games_played });
  }

  // Process games in batches
  const eventsToCreate: Array<Record<string, unknown>> = [];
  const resultsToCreate: Array<Record<string, unknown>> = [];
  const ratingUpdates: Array<{ key: string; rating: number; gamesPlayed: number; teamId: string; season: number }> = [];

  for (let i = 0; i < allGames.length; i++) {
    const game = allGames[i];
    const homeTeamId = teamMap.get(game.homeTeam);
    const awayTeamId = teamMap.get(game.awayTeam);

    if (!homeTeamId || !awayTeamId) {
      result.errors.push(`Missing team: ${game.homeTeam} or ${game.awayTeam}`);
      continue;
    }

    // Get current ratings from cache
    const homeKey = `${homeTeamId}_${game.season}`;
    const awayKey = `${awayTeamId}_${game.season}`;
    const homeRating = ratingCache.get(homeKey) || { rating: 1500, gamesPlayed: 0 };
    const awayRating = ratingCache.get(awayKey) || { rating: 1500, gamesPlayed: 0 };

    // Calculate Elo update
    // NOTE: Home field advantage is applied at PREDICTION time, not in ratings
    // Ratings should be neutral - no HFA baked in
    const homeExpected = 1 / (1 + Math.pow(10, (awayRating.rating - homeRating.rating) / 400));
    const homeActual = game.homePoints! > game.awayPoints! ? 1 : game.homePoints! < game.awayPoints! ? 0 : 0.5;

    // Dynamic K factor
    const k = Math.min(homeRating.gamesPlayed, awayRating.gamesPlayed) < 6 ? 32 : 20;

    const homeNewRating = homeRating.rating + k * (homeActual - homeExpected);
    const awayNewRating = awayRating.rating + k * ((1 - homeActual) - (1 - homeExpected));

    // Update cache
    ratingCache.set(homeKey, { rating: homeNewRating, gamesPlayed: homeRating.gamesPlayed + 1 });
    ratingCache.set(awayKey, { rating: awayNewRating, gamesPlayed: awayRating.gamesPlayed + 1 });

    ratingUpdates.push(
      { key: homeKey, rating: homeNewRating, gamesPlayed: homeRating.gamesPlayed + 1, teamId: homeTeamId, season: game.season },
      { key: awayKey, rating: awayNewRating, gamesPlayed: awayRating.gamesPlayed + 1, teamId: awayTeamId, season: game.season }
    );

    // Create event record with ALL game data
    eventsToCreate.push({
      cfbd_game_id: game.id.toString(),
      odds_api_event_id: `cfbd_${game.id}`,
      league: 'ncaaf',
      commence_time: game.startDate,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      status: 'final',
    });

    // Create result record
    resultsToCreate.push({
      cfbd_game_id: game.id.toString(),
      home_score: game.homePoints,
      away_score: game.awayPoints,
      final_total: game.homePoints! + game.awayPoints!,
      home_margin: game.homePoints! - game.awayPoints!,
      completed_at: game.startDate,
      // Store extra game data as JSON
      game_data: {
        week: game.week,
        season: game.season,
        seasonType: game.seasonType,
        neutralSite: game.neutralSite,
        conferenceGame: game.conferenceGame,
        homeConference: game.homeConference,
        awayConference: game.awayConference,
        venue: game.venue,
        venueId: game.venueId,
        homeLineScores: game.homeLineScores,
        awayLineScores: game.awayLineScores,
      },
    });

    result.gamesProcessed++;

    // Progress update every 500 games
    if (result.gamesProcessed % 500 === 0) {
      console.log(`  Processed ${result.gamesProcessed}/${allGames.length} games...`);
    }
  }

  // Step 6: Batch insert events
  // First get existing cfbd_game_ids to avoid duplicates
  console.log('\nInserting events...');
  const { data: existingEvents } = await supabase
    .from('events')
    .select('cfbd_game_id')
    .not('cfbd_game_id', 'is', null);

  const existingCfbdIds = new Set((existingEvents || []).map(e => e.cfbd_game_id));
  const newEvents = eventsToCreate.filter(e => !existingCfbdIds.has(e.cfbd_game_id as string));

  console.log(`  ${existingCfbdIds.size} existing events, ${newEvents.length} new events to insert`);

  for (let i = 0; i < newEvents.length; i += BATCH_SIZE) {
    const batch = newEvents.slice(i, i + BATCH_SIZE);
    const { data: inserted, error } = await supabase
      .from('events')
      .insert(batch)
      .select('id, cfbd_game_id');

    if (error) {
      result.errors.push(`Event batch ${i}: ${error.message}`);
      continue;
    }

    result.eventsCreated += inserted?.length || 0;
  }
  console.log(`  Created ${result.eventsCreated} events`);

  // Step 7: Get event IDs and insert results
  console.log('\nInserting results...');
  const { data: allEventsForResults } = await supabase
    .from('events')
    .select('id, cfbd_game_id')
    .not('cfbd_game_id', 'is', null);

  const eventIdMap = new Map<string, string>();
  for (const e of allEventsForResults || []) {
    eventIdMap.set(e.cfbd_game_id, e.id);
  }

  // Get existing results
  const { data: existingResults } = await supabase
    .from('results')
    .select('event_id');

  const existingResultEventIds = new Set((existingResults || []).map(r => r.event_id));

  // Add event_id to results, filter out existing
  const resultsWithEventId = resultsToCreate
    .filter(r => {
      const eventId = eventIdMap.get(r.cfbd_game_id as string);
      return eventId && !existingResultEventIds.has(eventId);
    })
    .map(r => ({
      event_id: eventIdMap.get(r.cfbd_game_id as string),
      home_score: r.home_score,
      away_score: r.away_score,
      completed_at: r.completed_at,
    }));

  console.log(`  ${existingResultEventIds.size} existing results, ${resultsWithEventId.length} new results to insert`);

  for (let i = 0; i < resultsWithEventId.length; i += BATCH_SIZE) {
    const batch = resultsWithEventId.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('results')
      .insert(batch);

    if (error) {
      result.errors.push(`Results batch ${i}: ${error.message}`);
      continue;
    }

    result.resultsCreated += batch.length;
  }
  console.log(`  Created ${result.resultsCreated} results`);

  // Step 8: Batch update ratings
  console.log('\nUpdating team ratings...');
  const finalRatings = new Map<string, { rating: number; gamesPlayed: number; teamId: string; season: number }>();
  for (const update of ratingUpdates) {
    finalRatings.set(update.key, update);
  }

  const ratingBatch = [...finalRatings.values()].map(r => ({
    team_id: r.teamId,
    model_version_id: modelVersionId,
    season: r.season,
    rating: Math.round(r.rating),
    games_played: r.gamesPlayed,
    last_updated: new Date().toISOString(),
  }));

  for (let i = 0; i < ratingBatch.length; i += BATCH_SIZE) {
    const batch = ratingBatch.slice(i, i + BATCH_SIZE);
    await supabase
      .from('team_ratings')
      .upsert(batch, { onConflict: 'team_id,model_version_id,season' });

    result.ratingsUpdated += batch.length;
  }
  console.log(`  Updated ${result.ratingsUpdated} ratings`);

  result.seasonsProcessed = seasons.length;
  result.timeSeconds = Math.round((Date.now() - startTime) / 1000);

  return result;
}

/**
 * Get Elo summary after sync
 */
export async function getEloSummaryFast(season: number = 2025): Promise<{
  topTeams: Array<{ team: string; rating: number; games: number }>;
  bottomTeams: Array<{ team: string; rating: number; games: number }>;
  ratingSpread: number;
}> {
  const { data: ratings } = await supabase
    .from('team_ratings')
    .select(`
      rating,
      games_played,
      teams!inner(name)
    `)
    .eq('season', season)
    .gt('games_played', 0)
    .order('rating', { ascending: false });

  if (!ratings || ratings.length === 0) {
    return { topTeams: [], bottomTeams: [], ratingSpread: 0 };
  }

  const mapped = ratings.map(r => ({
    team: (Array.isArray(r.teams) ? (r.teams[0] as { name: string })?.name : (r.teams as { name: string })?.name) || 'Unknown',
    rating: Math.round(r.rating),
    games: r.games_played,
  }));

  return {
    topTeams: mapped.slice(0, 15),
    bottomTeams: mapped.slice(-15).reverse(),
    ratingSpread: mapped[0].rating - mapped[mapped.length - 1].rating,
  };
}
