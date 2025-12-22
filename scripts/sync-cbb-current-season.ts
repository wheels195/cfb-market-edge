/**
 * Sync current CBB season (2025-26)
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
    const text = await response.text();
    throw new Error(`CBBD API error: ${response.status} - ${text}`);
  }

  return response.json();
}

async function syncGamesWithLines(season: number) {
  console.log(`\n--- Syncing games for ${season} ---`);

  // Fetch games with betting lines
  const gamesWithLines = await fetchCBBD<any[]>('/lines', { season: season.toString() });
  console.log(`Found ${gamesWithLines.length} games with betting data`);

  if (gamesWithLines.length === 0) {
    console.log('No games found from CBBD API for this season');
    return;
  }

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
  console.log(`Existing games in DB: ${existingGameIds.size}`);

  // Filter to new games only
  const newGames = gamesWithLines.filter(g => !existingGameIds.has(g.gameId));
  console.log(`New games to sync: ${newGames.length}`);

  if (newGames.length === 0) {
    console.log('No new games to sync.');
    return;
  }

  let gamesCreated = 0;
  let linesCreated = 0;
  let skipped = 0;

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
      skipped++;
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
  console.log(`  Created: ${gamesCreated} games`);
  console.log(`  Lines: ${linesCreated}`);
  console.log(`  Skipped: ${skipped}`);
}

async function main() {
  console.log('========================================');
  console.log('  CBB Current Season Sync');
  console.log('  Season: 2026 (2025-26)');
  console.log('========================================');

  // The 2025-26 season is labeled as 2026
  await syncGamesWithLines(2026);

  console.log('\n========================================');
  console.log(`  Sync Complete!`);
  console.log(`  API calls used: ${apiCalls}`);
  console.log('========================================\n');
}

main().catch(console.error);
