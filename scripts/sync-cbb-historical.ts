/**
 * Sync historical CBB data for backtesting (2022-2024)
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
  console.log(`[CBBD API] ${endpoint}?${url.searchParams} (call #${apiCalls})`);

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

async function syncRatings(season: number) {
  console.log(`\n--- Syncing ratings for ${season} ---`);

  // Fetch adjusted ratings
  const adjustedRatings = await fetchCBBD<any[]>('/ratings/adjusted', { season: season.toString() });
  console.log(`Found ${adjustedRatings.length} adjusted ratings`);

  // Fetch SRS ratings
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

  // Upsert in batches
  let synced = 0;
  for (let i = 0; i < ratings.length; i += 50) {
    const batch = ratings.slice(i, i + 50);
    const { error } = await supabase
      .from('cbb_team_ratings')
      .upsert(batch, { onConflict: 'team_id,season' });

    if (!error) synced += batch.length;
  }

  console.log(`Synced ${synced} ratings for ${season}`);
}

async function syncGamesWithLines(season: number) {
  console.log(`\n--- Syncing games for ${season} ---`);

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

  if (newGames.length === 0) {
    console.log('No new games to sync.');
    return;
  }

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

    // Progress update every 500 games
    if (gamesCreated % 500 === 0) {
      console.log(`  Progress: ${gamesCreated} games, ${linesCreated} lines...`);
    }
  }

  console.log(`Games sync complete: ${gamesCreated} games, ${linesCreated} lines`);
}

async function main() {
  console.log('========================================');
  console.log('  CBB Historical Data Sync');
  console.log('  Seasons: 2022, 2023, 2024');
  console.log('========================================');

  const seasons = [2022, 2023, 2024];

  for (const season of seasons) {
    console.log(`\n========== SEASON ${season} ==========`);
    await syncRatings(season);
    await syncGamesWithLines(season);
  }

  console.log('\n========================================');
  console.log(`  Historical Sync Complete!`);
  console.log(`  API calls used: ${apiCalls}`);
  console.log('========================================\n');
}

main().catch(console.error);
