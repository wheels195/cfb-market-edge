/**
 * Sync historical betting lines from CFBD API
 * This provides closing lines for backtesting
 */
import { supabase } from '../src/lib/db/client';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const BATCH_SIZE = 100;

interface SyncOddsResult {
  seasonsProcessed: number;
  gamesWithLines: number;
  closingLinesCreated: number;
  apiCalls: number;
  timeSeconds: number;
  errors: string[];
}

async function syncHistoricalOdds(
  seasons: number[] = [2022, 2023, 2024, 2025]
): Promise<SyncOddsResult> {
  const startTime = Date.now();
  const result: SyncOddsResult = {
    seasonsProcessed: 0,
    gamesWithLines: 0,
    closingLinesCreated: 0,
    apiCalls: 0,
    timeSeconds: 0,
    errors: [],
  };

  const client = getCFBDApiClient();

  // Get sportsbook IDs
  const { data: sportsbooks } = await supabase.from('sportsbooks').select('id, key');
  if (!sportsbooks || sportsbooks.length === 0) {
    result.errors.push('No sportsbooks found');
    return result;
  }

  const sportsbookMap = new Map<string, string>();
  for (const sb of sportsbooks) {
    sportsbookMap.set(sb.key, sb.id);
  }

  // Get first sportsbook as default for consensus lines
  const defaultSportsbookId = sportsbooks[0].id;

  // Build event mapping from cfbd_game_id to event_id (with pagination)
  console.log('Loading event mapping...');
  const eventMap = new Map<string, string>();
  let offset = 0;

  while (true) {
    const { data: events } = await supabase
      .from('events')
      .select('id, cfbd_game_id')
      .not('cfbd_game_id', 'is', null)
      .range(offset, offset + 999);

    if (!events || events.length === 0) break;
    for (const e of events) {
      eventMap.set(e.cfbd_game_id, e.id);
    }
    offset += events.length;
    if (events.length < 1000) break;
  }
  console.log(`Found ${eventMap.size} events with cfbd_game_id\n`);

  // Get existing closing lines to avoid duplicates (with pagination)
  const existingLineKeys = new Set<string>();
  let lineOffset = 0;

  while (true) {
    const { data: existingLines } = await supabase
      .from('closing_lines')
      .select('event_id, sportsbook_id, market_type, side')
      .range(lineOffset, lineOffset + 999);

    if (!existingLines || existingLines.length === 0) break;
    for (const line of existingLines) {
      existingLineKeys.add(`${line.event_id}_${line.sportsbook_id}_${line.market_type}_${line.side}`);
    }
    lineOffset += existingLines.length;
    if (existingLines.length < 1000) break;
  }
  console.log(`${existingLineKeys.size} existing closing lines\n`);

  // Collect all lines to insert
  const linesToCreate: Array<{
    event_id: string;
    sportsbook_id: string;
    market_type: 'spread' | 'total';
    side: string;
    captured_at: string;
    spread_points_home?: number;
    total_points?: number;
    price_american: number;
    price_decimal: number;
  }> = [];

  for (const season of seasons.sort((a, b) => a - b)) {
    console.log(`Fetching betting lines for ${season}...`);

    try {
      const lines = await client.getBettingLines(season);
      result.apiCalls++;

      console.log(`  Found ${lines.length} games with lines`);

      for (const gameLine of lines) {
        const eventId = eventMap.get(gameLine.id.toString());
        if (!eventId) continue;

        result.gamesWithLines++;

        // Process each line from the game
        for (const line of gameLine.lines || []) {
          // Map provider to sportsbook
          const provider = line.provider?.toLowerCase() || 'consensus';
          let sportsbookId = defaultSportsbookId;

          if (provider.includes('draftkings')) {
            sportsbookId = sportsbookMap.get('draftkings') || defaultSportsbookId;
          } else if (provider.includes('fanduel')) {
            sportsbookId = sportsbookMap.get('fanduel') || defaultSportsbookId;
          } else if (provider.includes('bovada')) {
            sportsbookId = sportsbookMap.get('bovada') || defaultSportsbookId;
          }

          // Create spread line (home side)
          if (line.spread !== null && line.spread !== undefined) {
            const homeKey = `${eventId}_${sportsbookId}_spread_home`;
            const awayKey = `${eventId}_${sportsbookId}_spread_away`;

            if (!existingLineKeys.has(homeKey)) {
              linesToCreate.push({
                event_id: eventId,
                sportsbook_id: sportsbookId,
                market_type: 'spread',
                side: 'home',
                captured_at: gameLine.startDate,
                spread_points_home: line.spread,
                price_american: line.homeMoneyline || -110,
                price_decimal: americanToDecimal(line.homeMoneyline || -110),
              });
              existingLineKeys.add(homeKey);
            }

            if (!existingLineKeys.has(awayKey)) {
              linesToCreate.push({
                event_id: eventId,
                sportsbook_id: sportsbookId,
                market_type: 'spread',
                side: 'away',
                captured_at: gameLine.startDate,
                spread_points_home: line.spread, // Store home spread for both sides
                price_american: line.awayMoneyline || -110,
                price_decimal: americanToDecimal(line.awayMoneyline || -110),
              });
              existingLineKeys.add(awayKey);
            }
          }

          // Create total line (over/under)
          if (line.overUnder !== null && line.overUnder !== undefined) {
            const overKey = `${eventId}_${sportsbookId}_total_over`;
            const underKey = `${eventId}_${sportsbookId}_total_under`;

            if (!existingLineKeys.has(overKey)) {
              linesToCreate.push({
                event_id: eventId,
                sportsbook_id: sportsbookId,
                market_type: 'total',
                side: 'over',
                captured_at: gameLine.startDate,
                total_points: line.overUnder,
                price_american: line.overOdds || -110,
                price_decimal: americanToDecimal(line.overOdds || -110),
              });
              existingLineKeys.add(overKey);
            }

            if (!existingLineKeys.has(underKey)) {
              linesToCreate.push({
                event_id: eventId,
                sportsbook_id: sportsbookId,
                market_type: 'total',
                side: 'under',
                captured_at: gameLine.startDate,
                total_points: line.overUnder,
                price_american: line.underOdds || -110,
                price_decimal: americanToDecimal(line.underOdds || -110),
              });
              existingLineKeys.add(underKey);
            }
          }
        }
      }

      result.seasonsProcessed++;
      console.log(`  Collected ${linesToCreate.length} total lines so far`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Season ${season}: ${msg}`);
    }
  }

  // Batch insert lines
  console.log(`\nInserting ${linesToCreate.length} closing lines...`);
  for (let i = 0; i < linesToCreate.length; i += BATCH_SIZE) {
    const batch = linesToCreate.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('closing_lines').insert(batch);

    if (error) {
      result.errors.push(`Batch ${i}: ${error.message}`);
      continue;
    }

    result.closingLinesCreated += batch.length;

    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= linesToCreate.length) {
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, linesToCreate.length)}/${linesToCreate.length}`);
    }
  }

  result.timeSeconds = Math.round((Date.now() - startTime) / 1000);
  return result;
}

function americanToDecimal(american: number): number {
  if (american > 0) {
    return (american / 100) + 1;
  }
  return (100 / Math.abs(american)) + 1;
}

async function main() {
  console.log('Syncing historical betting lines...\n');

  const result = await syncHistoricalOdds([2022, 2023, 2024, 2025]);

  console.log('\n=== ODDS SYNC COMPLETE ===');
  console.log(`Time: ${result.timeSeconds} seconds`);
  console.log(`Seasons processed: ${result.seasonsProcessed}`);
  console.log(`Games with lines: ${result.gamesWithLines}`);
  console.log(`Closing lines created: ${result.closingLinesCreated}`);
  console.log(`API calls: ${result.apiCalls}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  // Show sample of closing lines
  console.log('\n=== SAMPLE CLOSING LINES ===');
  const { data: sampleLines } = await supabase
    .from('closing_lines')
    .select(`
      market_type,
      side,
      spread_points_home,
      total_points,
      price_american,
      events!inner(
        commence_time,
        home_team:teams!events_home_team_id_fkey(name),
        away_team:teams!events_away_team_id_fkey(name)
      )
    `)
    .order('captured_at', { ascending: false })
    .limit(10);

  if (sampleLines) {
    for (const line of sampleLines) {
      const event = line.events as unknown as {
        commence_time: string;
        home_team: { name: string };
        away_team: { name: string };
      };
      const date = new Date(event.commence_time).toLocaleDateString();
      if (line.market_type === 'spread') {
        console.log(`  ${event.away_team.name} @ ${event.home_team.name} (${date}): Home ${line.spread_points_home} (${line.price_american})`);
      } else {
        console.log(`  ${event.away_team.name} @ ${event.home_team.name} (${date}): Total ${line.total_points} ${line.side} (${line.price_american})`);
      }
    }
  }
}

main().catch(console.error);
