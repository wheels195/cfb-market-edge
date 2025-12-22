/**
 * Setup College Basketball support
 *
 * PREREQUISITE: Run the SQL migration in Supabase first!
 * File: scripts/migrations/cbb-schema.sql
 *
 * This script:
 * 1. Syncs CBB teams from CBBD API
 * 2. Syncs team efficiency ratings
 * 3. Syncs historical games with betting lines
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const CBBD_BASE_URL = 'https://api.collegebasketballdata.com';
const API_KEY = process.env.CFBD_API_KEY;

let apiCalls = 0;

async function fetchCBBD<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${CBBD_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  apiCalls++;
  console.log(`[CBBD API] ${endpoint} (call #${apiCalls})`);

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`CBBD API error: ${response.status}`);
  }

  return response.json();
}

async function checkMigration(): Promise<boolean> {
  console.log('Checking if CBB tables exist...');

  const { data, error } = await supabase
    .from('cbb_teams')
    .select('id')
    .limit(1);

  if (error && error.code === '42P01') {
    console.log('\n❌ CBB tables do not exist!');
    console.log('\nPlease run the migration SQL in Supabase SQL Editor:');
    console.log('  File: scripts/migrations/cbb-schema.sql\n');
    return false;
  }

  console.log('✓ CBB tables exist\n');
  return true;
}

async function syncTeams() {
  console.log('=== Syncing CBB Teams ===\n');

  // Fetch D1 teams from CBBD
  const teams = await fetchCBBD<any[]>('/teams');
  const d1Teams = teams.filter(t => t.conference !== null);

  console.log(`Found ${d1Teams.length} D1 teams from CBBD`);

  // Get existing teams
  const { data: existingTeams } = await supabase
    .from('cbb_teams')
    .select('id, cbbd_team_id');

  const existingMap = new Map((existingTeams || []).map(t => [t.cbbd_team_id, t.id]));
  console.log(`Existing teams in DB: ${existingMap.size}`);

  let created = 0;
  let skipped = 0;

  // Batch insert new teams
  const newTeams = d1Teams
    .filter(team => !existingMap.has(team.id))
    .map(team => ({
      cbbd_team_id: team.id,
      name: team.school,
      abbreviation: team.abbreviation,
      conference: team.conference,
      primary_color: team.primaryColor,
      secondary_color: team.secondaryColor,
      venue: team.currentVenue,
      city: team.currentCity,
      state: team.currentState,
    }));

  if (newTeams.length > 0) {
    // Insert in batches of 50
    for (let i = 0; i < newTeams.length; i += 50) {
      const batch = newTeams.slice(i, i + 50);
      const { error } = await supabase.from('cbb_teams').insert(batch);
      if (error) {
        console.log(`Error inserting batch: ${error.message}`);
      } else {
        created += batch.length;
      }
    }
  }

  skipped = d1Teams.length - newTeams.length;

  console.log(`\nTeam sync complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (existing): ${skipped}`);

  return created + skipped;
}

async function syncRatings(season: number) {
  console.log(`\n=== Syncing CBB Ratings for ${season} ===\n`);

  // Fetch adjusted ratings
  console.log('Fetching adjusted efficiency ratings...');
  const adjustedRatings = await fetchCBBD<any[]>('/ratings/adjusted', { season: season.toString() });
  console.log(`Found ${adjustedRatings.length} teams with adjusted ratings`);

  // Fetch SRS ratings
  console.log('Fetching SRS ratings...');
  const srsRatings = await fetchCBBD<any[]>('/ratings/srs', { season: season.toString() });
  const srsMap = new Map(srsRatings.map(r => [r.teamId, r.rating]));

  // Get team mapping
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, cbbd_team_id');

  const teamMap = new Map((teams || []).map(t => [t.cbbd_team_id, t.id]));

  // Build ratings to upsert
  const ratings = adjustedRatings
    .filter(r => teamMap.has(r.teamId))
    .map(r => ({
      team_id: teamMap.get(r.teamId),
      season: r.season,
      offensive_rating: r.offensiveRating,
      defensive_rating: r.defensiveRating,
      net_rating: r.netRating,
      srs_rating: srsMap.get(r.teamId) || null,
      offense_rank: r.rankings?.offense,
      defense_rank: r.rankings?.defense,
      net_rank: r.rankings?.net,
    }));

  console.log(`Syncing ${ratings.length} ratings...`);

  // Upsert in batches
  let synced = 0;
  for (let i = 0; i < ratings.length; i += 50) {
    const batch = ratings.slice(i, i + 50);
    const { error } = await supabase
      .from('cbb_team_ratings')
      .upsert(batch, { onConflict: 'team_id,season' });

    if (error) {
      console.log(`Error: ${error.message}`);
    } else {
      synced += batch.length;
    }
  }

  console.log(`Ratings sync complete: ${synced} synced`);
}

async function syncGamesWithLines(season: number) {
  console.log(`\n=== Syncing CBB Games with Lines for ${season} ===\n`);

  // Fetch games with betting lines
  const gamesWithLines = await fetchCBBD<any[]>('/lines', { season: season.toString() });
  console.log(`Found ${gamesWithLines.length} games with betting data`);

  // Get team mapping
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, cbbd_team_id, name');

  const teamIdMap = new Map((teams || []).map(t => [t.cbbd_team_id, t.id]));
  const teamNameMap = new Map((teams || []).map(t => [t.name.toLowerCase(), t.id]));

  // Check existing games
  const { data: existingGames } = await supabase
    .from('cbb_games')
    .select('cbbd_game_id')
    .eq('season', season);

  const existingGameIds = new Set((existingGames || []).map(g => g.cbbd_game_id));

  // Filter to new games only
  const newGames = gamesWithLines.filter(g => !existingGameIds.has(g.gameId));
  console.log(`New games to sync: ${newGames.length}`);

  let gamesCreated = 0;
  let linesCreated = 0;

  for (const game of newGames) {
    // Find team IDs
    const homeTeamId = teamIdMap.get(game.homeTeamId) ||
      teamNameMap.get(game.homeTeam?.toLowerCase());
    const awayTeamId = teamIdMap.get(game.awayTeamId) ||
      teamNameMap.get(game.awayTeam?.toLowerCase());

    // Insert game
    const { data: insertedGame, error: gameError } = await supabase
      .from('cbb_games')
      .insert({
        cbbd_game_id: game.gameId,
        season: game.season,
        season_type: game.seasonType || 'regular',
        start_date: game.startDate,
        status: game.homeScore !== null ? 'final' : 'scheduled',
        home_team_id: homeTeamId || null,
        away_team_id: awayTeamId || null,
        home_team_name: game.homeTeam,
        away_team_name: game.awayTeam,
        home_score: game.homeScore,
        away_score: game.awayScore,
      })
      .select('id')
      .single();

    if (gameError) {
      if (!gameError.message.includes('duplicate')) {
        console.log(`Game error: ${gameError.message}`);
      }
      continue;
    }

    gamesCreated++;

    // Insert betting lines
    if (game.lines && game.lines.length > 0 && insertedGame) {
      for (const line of game.lines) {
        const { error: lineError } = await supabase
          .from('cbb_betting_lines')
          .insert({
            game_id: insertedGame.id,
            cbbd_game_id: game.gameId,
            provider: line.provider,
            spread_home: line.spread,
            spread_open: line.spreadOpen,
            total: line.overUnder,
            total_open: line.overUnderOpen,
            home_moneyline: line.homeMoneyline,
            away_moneyline: line.awayMoneyline,
          });

        if (!lineError) linesCreated++;
      }
    }

    // Progress update every 100 games
    if (gamesCreated % 100 === 0) {
      console.log(`  Progress: ${gamesCreated} games, ${linesCreated} lines...`);
    }
  }

  console.log(`\nGames sync complete:`);
  console.log(`  Games created: ${gamesCreated}`);
  console.log(`  Lines created: ${linesCreated}`);
}

async function main() {
  console.log('========================================');
  console.log('  College Basketball Setup');
  console.log('========================================\n');

  if (!API_KEY) {
    console.error('Error: CFBD_API_KEY is required');
    process.exit(1);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY are required');
    process.exit(1);
  }

  // Check if migration has been run
  const migrationOk = await checkMigration();
  if (!migrationOk) {
    process.exit(1);
  }

  // Sync teams
  await syncTeams();

  // Sync ratings for current season
  const currentSeason = 2025;
  await syncRatings(currentSeason);

  // Sync games with lines for current season
  await syncGamesWithLines(currentSeason);

  console.log('\n========================================');
  console.log(`  Setup Complete!`);
  console.log(`  API calls used: ${apiCalls}`);
  console.log('========================================\n');
}

main().catch(console.error);
