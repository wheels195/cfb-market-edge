import { supabase } from '@/lib/db/client';
import { getOddsApiClient, americanToDecimal, generateTickHash } from '@/lib/api/odds-api';
import { getPollableEvents, getSportsbookByKey, tickExists } from '@/lib/db/queries';
import { EventWithTeams } from '@/types/database';
import { OddsApiEvent, ParsedOdds } from '@/types/odds-api';

export interface PollOddsResult {
  eventsPolled: number;
  ticksWritten: number;
  dedupeHits: number;
  errors: string[];
}

/**
 * Determine polling interval based on time to kickoff
 */
function getPollingIntervalMinutes(commenceTime: Date): number {
  const now = new Date();
  const hoursToKickoff = (commenceTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  const farMinutes = parseInt(process.env.POLL_WINDOW_FAR_MINUTES || '60', 10);
  const mediumMinutes = parseInt(process.env.POLL_WINDOW_MEDIUM_MINUTES || '10', 10);
  const closeMinutes = parseInt(process.env.POLL_WINDOW_CLOSE_MINUTES || '2', 10);

  if (hoursToKickoff > 24) return farMinutes;
  if (hoursToKickoff > 4) return mediumMinutes;
  return closeMinutes;
}

/**
 * Check if an event should be polled based on last poll time
 */
async function shouldPollEvent(eventId: string, commenceTime: Date): Promise<boolean> {
  const intervalMinutes = getPollingIntervalMinutes(commenceTime);

  // Get most recent tick for this event
  const { data } = await supabase
    .from('odds_ticks')
    .select('captured_at')
    .eq('event_id', eventId)
    .order('captured_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastPollTime = new Date(data[0].captured_at);
  const minutesSinceLastPoll = (Date.now() - lastPollTime.getTime()) / (1000 * 60);

  return minutesSinceLastPoll >= intervalMinutes;
}

/**
 * Poll odds for all eligible events
 */
export async function pollOdds(): Promise<PollOddsResult> {
  const result: PollOddsResult = {
    eventsPolled: 0,
    ticksWritten: 0,
    dedupeHits: 0,
    errors: [],
  };

  try {
    const client = getOddsApiClient();

    // Fetch all odds at once (more efficient than per-event)
    const oddsData = await client.getOdds();

    // Get our events from DB
    const dbEvents = await getPollableEvents();
    const eventsByOddsApiId = new Map<string, EventWithTeams>();
    for (const event of dbEvents) {
      eventsByOddsApiId.set(event.odds_api_event_id, event);
    }

    // Process each API event
    for (const apiEvent of oddsData) {
      const dbEvent = eventsByOddsApiId.get(apiEvent.id);
      if (!dbEvent) continue;

      // Check if we should poll based on adaptive timing
      const commenceTime = new Date(dbEvent.commence_time);
      if (commenceTime <= new Date()) continue; // Skip past events

      const shouldPoll = await shouldPollEvent(dbEvent.id, commenceTime);
      if (!shouldPoll) continue;

      try {
        const ticksResult = await processEventOdds(dbEvent, apiEvent, result);
        result.ticksWritten += ticksResult.written;
        result.dedupeHits += ticksResult.deduped;
        result.eventsPolled++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${dbEvent.id}: ${message}`);
      }
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Fetch failed: ${message}`);
  }

  return result;
}

/**
 * Process odds for a single event
 */
async function processEventOdds(
  dbEvent: EventWithTeams,
  apiEvent: OddsApiEvent,
  result: PollOddsResult
): Promise<{ written: number; deduped: number }> {
  const client = getOddsApiClient();
  const parsedOddsList = client.parseOdds(apiEvent);

  let written = 0;
  let deduped = 0;

  for (const parsedOdds of parsedOddsList) {
    const sportsbook = await getSportsbookByKey(parsedOdds.bookmakerKey);
    if (!sportsbook) continue;

    const capturedAt = new Date().toISOString();

    // Process spreads
    if (parsedOdds.spreads) {
      // Home side
      const homeSpreadHash = generateTickHash(
        dbEvent.id,
        parsedOdds.bookmakerKey,
        'spread',
        'home',
        parsedOdds.spreads.home.points,
        parsedOdds.spreads.home.price
      );

      const homeExists = await tickExists(
        dbEvent.id,
        sportsbook.id,
        'spread',
        'home',
        homeSpreadHash
      );

      if (!homeExists) {
        await supabase.from('odds_ticks').insert({
          event_id: dbEvent.id,
          sportsbook_id: sportsbook.id,
          market_type: 'spread',
          side: 'home',
          spread_points_home: parsedOdds.spreads.home.points,
          price_american: parsedOdds.spreads.home.price,
          price_decimal: americanToDecimal(parsedOdds.spreads.home.price),
          payload_hash: homeSpreadHash,
          captured_at: capturedAt,
        });
        written++;
      } else {
        deduped++;
      }

      // Away side (store same spread_points_home but with away side marker)
      const awaySpreadHash = generateTickHash(
        dbEvent.id,
        parsedOdds.bookmakerKey,
        'spread',
        'away',
        parsedOdds.spreads.away.points,
        parsedOdds.spreads.away.price
      );

      const awayExists = await tickExists(
        dbEvent.id,
        sportsbook.id,
        'spread',
        'away',
        awaySpreadHash
      );

      if (!awayExists) {
        await supabase.from('odds_ticks').insert({
          event_id: dbEvent.id,
          sportsbook_id: sportsbook.id,
          market_type: 'spread',
          side: 'away',
          // Store home spread for canonical reference
          spread_points_home: parsedOdds.spreads.home.points,
          price_american: parsedOdds.spreads.away.price,
          price_decimal: americanToDecimal(parsedOdds.spreads.away.price),
          payload_hash: awaySpreadHash,
          captured_at: capturedAt,
        });
        written++;
      } else {
        deduped++;
      }
    }

    // Process totals
    if (parsedOdds.totals) {
      // Over side
      const overHash = generateTickHash(
        dbEvent.id,
        parsedOdds.bookmakerKey,
        'total',
        'over',
        parsedOdds.totals.over.points,
        parsedOdds.totals.over.price
      );

      const overExists = await tickExists(
        dbEvent.id,
        sportsbook.id,
        'total',
        'over',
        overHash
      );

      if (!overExists) {
        await supabase.from('odds_ticks').insert({
          event_id: dbEvent.id,
          sportsbook_id: sportsbook.id,
          market_type: 'total',
          side: 'over',
          total_points: parsedOdds.totals.over.points,
          price_american: parsedOdds.totals.over.price,
          price_decimal: americanToDecimal(parsedOdds.totals.over.price),
          payload_hash: overHash,
          captured_at: capturedAt,
        });
        written++;
      } else {
        deduped++;
      }

      // Under side
      const underHash = generateTickHash(
        dbEvent.id,
        parsedOdds.bookmakerKey,
        'total',
        'under',
        parsedOdds.totals.under.points,
        parsedOdds.totals.under.price
      );

      const underExists = await tickExists(
        dbEvent.id,
        sportsbook.id,
        'total',
        'under',
        underHash
      );

      if (!underExists) {
        await supabase.from('odds_ticks').insert({
          event_id: dbEvent.id,
          sportsbook_id: sportsbook.id,
          market_type: 'total',
          side: 'under',
          total_points: parsedOdds.totals.under.points,
          price_american: parsedOdds.totals.under.price,
          price_decimal: americanToDecimal(parsedOdds.totals.under.price),
          payload_hash: underHash,
          captured_at: capturedAt,
        });
        written++;
      } else {
        deduped++;
      }
    }
  }

  return { written, deduped };
}
