/**
 * Fill in missing results for events that should have them
 * The historical sync hit Supabase's 1000 row limit
 */
import { supabase } from '../src/lib/db/client';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const BATCH_SIZE = 100;

async function getAllEventsWithCfbdId(): Promise<Array<{ id: string; cfbd_game_id: string }>> {
  const allEvents: Array<{ id: string; cfbd_game_id: string }> = [];
  let offset = 0;

  while (true) {
    const { data } = await supabase
      .from('events')
      .select('id, cfbd_game_id')
      .not('cfbd_game_id', 'is', null)
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    allEvents.push(...data);
    offset += data.length;

    if (data.length < 1000) break;
  }

  return allEvents;
}

async function getAllResultEventIds(): Promise<Set<string>> {
  const existingIds = new Set<string>();
  let offset = 0;

  while (true) {
    const { data } = await supabase
      .from('results')
      .select('event_id')
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    for (const r of data) {
      existingIds.add(r.event_id);
    }
    offset += data.length;

    if (data.length < 1000) break;
  }

  return existingIds;
}

async function main() {
  console.log('Finding missing results...\n');

  // Get all events with cfbd_game_id
  const allEvents = await getAllEventsWithCfbdId();
  console.log(`Total events with cfbd_game_id: ${allEvents.length}`);

  // Get existing result event_ids
  const existingResultIds = await getAllResultEventIds();
  console.log(`Existing results: ${existingResultIds.size}`);

  // Find events missing results
  const missingEvents = allEvents.filter(e => !existingResultIds.has(e.id));
  console.log(`Events missing results: ${missingEvents.length}\n`);

  if (missingEvents.length === 0) {
    console.log('No missing results found!');
    return;
  }

  // Fetch game data from CFBD API
  const client = getCFBDApiClient();
  const gameDataMap = new Map<string, { homePoints: number; awayPoints: number; startDate: string }>();

  console.log('Fetching game data from CFBD API...');
  for (const season of [2022, 2023, 2024, 2025]) {
    console.log(`  Fetching ${season}...`);
    const games = await client.getCompletedGames(season);
    for (const game of games) {
      if (game.homePoints !== null && game.awayPoints !== null) {
        gameDataMap.set(game.id.toString(), {
          homePoints: game.homePoints,
          awayPoints: game.awayPoints,
          startDate: game.startDate,
        });
      }
    }
  }
  console.log(`Loaded data for ${gameDataMap.size} games\n`);

  // Create missing results
  const resultsToCreate: Array<{
    event_id: string;
    home_score: number;
    away_score: number;
    completed_at: string;
  }> = [];

  for (const event of missingEvents) {
    const gameData = gameDataMap.get(event.cfbd_game_id);
    if (gameData) {
      resultsToCreate.push({
        event_id: event.id,
        home_score: gameData.homePoints,
        away_score: gameData.awayPoints,
        completed_at: gameData.startDate,
      });
    }
  }

  console.log(`Creating ${resultsToCreate.length} missing results...\n`);

  let created = 0;
  let errors = 0;

  for (let i = 0; i < resultsToCreate.length; i += BATCH_SIZE) {
    const batch = resultsToCreate.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('results').insert(batch);

    if (error) {
      console.log(`  Batch ${i} error: ${error.message}`);
      errors++;
    } else {
      created += batch.length;
    }

    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= resultsToCreate.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, resultsToCreate.length)}/${resultsToCreate.length}`);
    }
  }

  console.log('\n=== COMPLETE ===');
  console.log(`Results created: ${created}`);
  console.log(`Errors: ${errors}`);

  // Verify final counts
  const finalResultIds = await getAllResultEventIds();
  console.log(`\nFinal result count: ${finalResultIds.size}`);
}

main().catch(console.error);
