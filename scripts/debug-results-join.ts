/**
 * Debug why results aren't joining to events properly
 * With proper pagination
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function getAllIds(table: string, column: string, filter?: { column: string; value: string }): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase.from(table).select(column).range(offset, offset + pageSize - 1);
    if (filter) {
      query = query.eq(filter.column, filter.value);
    }

    const { data } = await query;
    if (!data || data.length === 0) break;

    for (const row of data) {
      ids.add((row as any)[column]);
    }

    offset += pageSize;
    if (data.length < pageSize) break;
  }

  return ids;
}

async function debug() {
  console.log('=== Debug Results Join (with pagination) ===\n');

  // Get ALL event IDs from events table (final status)
  console.log('Fetching all final event IDs...');
  const finalEventIds = await getAllIds('events', 'id', { column: 'status', value: 'final' });
  console.log(`Final events: ${finalEventIds.size}`);

  // Get ALL event_ids from results table
  console.log('Fetching all result event_ids...');
  const resultEventIds = await getAllIds('results', 'event_id');
  console.log(`Results: ${resultEventIds.size}`);

  // Find overlap
  let matchCount = 0;
  let resultsWithoutEvent = 0;
  let eventsWithoutResult = 0;

  for (const resultId of resultEventIds) {
    if (finalEventIds.has(resultId)) {
      matchCount++;
    } else {
      resultsWithoutEvent++;
    }
  }

  for (const eventId of finalEventIds) {
    if (!resultEventIds.has(eventId)) {
      eventsWithoutResult++;
    }
  }

  console.log(`\nResults matching a final event: ${matchCount}`);
  console.log(`Results with NO matching final event: ${resultsWithoutEvent}`);
  console.log(`Final events with NO result: ${eventsWithoutResult}`);

  // Check if non-matching results are linked to non-final events
  console.log('\n--- Investigating mismatches ---');

  // Get ALL event IDs (any status)
  const allEventIds = await getAllIds('events', 'id');
  console.log(`Total events (any status): ${allEventIds.size}`);

  let resultsLinkedToNonFinal = 0;
  let resultsOrphaned = 0;

  for (const resultId of resultEventIds) {
    if (!finalEventIds.has(resultId)) {
      if (allEventIds.has(resultId)) {
        resultsLinkedToNonFinal++;
      } else {
        resultsOrphaned++;
      }
    }
  }

  console.log(`Results linked to non-final events: ${resultsLinkedToNonFinal}`);
  console.log(`Results truly orphaned (no event): ${resultsOrphaned}`);

  // Sample events without results
  console.log('\n--- Sample final events without results ---');
  let sampleCount = 0;
  for (const eventId of finalEventIds) {
    if (!resultEventIds.has(eventId) && sampleCount < 5) {
      const { data: event } = await supabase
        .from('events')
        .select('commence_time, cfbd_game_id, home_team:home_team_id(name), away_team:away_team_id(name)')
        .eq('id', eventId)
        .single();

      if (event) {
        const home = (event.home_team as any)?.name || 'Unknown';
        const away = (event.away_team as any)?.name || 'Unknown';
        console.log(`  ${event.commence_time?.split('T')[0]}: ${away} @ ${home} (cfbd: ${event.cfbd_game_id})`);
      }
      sampleCount++;
    }
  }
}

debug().catch(console.error);
