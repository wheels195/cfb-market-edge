import { supabase } from '@/lib/db/client';

export interface SetClosingLinesResult {
  eventsProcessed: number;
  linesSet: number;
  errors: string[];
}

/**
 * Materialize closing lines for events that have kicked off
 */
export async function setClosingLines(): Promise<SetClosingLinesResult> {
  const result: SetClosingLinesResult = {
    eventsProcessed: 0,
    linesSet: 0,
    errors: [],
  };

  try {
    // Get events that have started but don't have closing lines yet
    const now = new Date();
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, commence_time')
      .in('status', ['in_progress', 'final'])
      .lt('commence_time', now.toISOString());

    if (eventsError) throw eventsError;
    if (!events || events.length === 0) return result;

    // Also check for scheduled events that have passed their kickoff time
    const { data: pastScheduled, error: pastError } = await supabase
      .from('events')
      .select('id, commence_time')
      .eq('status', 'scheduled')
      .lt('commence_time', now.toISOString());

    if (pastError) throw pastError;

    const allEvents = [...(events || []), ...(pastScheduled || [])];

    for (const event of allEvents) {
      try {
        await processEventClosingLines(event.id, new Date(event.commence_time), result);
        result.eventsProcessed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${event.id}: ${message}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Fetch failed: ${message}`);
  }

  return result;
}

/**
 * Process closing lines for a single event
 */
async function processEventClosingLines(
  eventId: string,
  commenceTime: Date,
  result: SetClosingLinesResult
): Promise<void> {
  // Get all sportsbooks
  const { data: sportsbooks, error: sbError } = await supabase
    .from('sportsbooks')
    .select('id');

  if (sbError) throw sbError;

  for (const sportsbook of sportsbooks || []) {
    // Process spreads
    await setClosingLineForMarket(eventId, sportsbook.id, 'spread', 'home', commenceTime, result);
    await setClosingLineForMarket(eventId, sportsbook.id, 'spread', 'away', commenceTime, result);

    // Process totals
    await setClosingLineForMarket(eventId, sportsbook.id, 'total', 'over', commenceTime, result);
    await setClosingLineForMarket(eventId, sportsbook.id, 'total', 'under', commenceTime, result);
  }
}

/**
 * Set closing line for a specific event/book/market/side
 */
async function setClosingLineForMarket(
  eventId: string,
  sportsbookId: string,
  marketType: 'spread' | 'total',
  side: string,
  commenceTime: Date,
  result: SetClosingLinesResult
): Promise<void> {
  // Check if closing line already exists
  const { data: existing } = await supabase
    .from('closing_lines')
    .select('id')
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType)
    .eq('side', side)
    .single();

  if (existing) return; // Already set

  // Get the last tick before kickoff
  const { data: lastTick, error: tickError } = await supabase
    .from('odds_ticks')
    .select('*')
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType)
    .eq('side', side)
    .lt('captured_at', commenceTime.toISOString())
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (tickError && tickError.code !== 'PGRST116') throw tickError;
  if (!lastTick) return; // No ticks for this combination

  // Insert closing line
  const { error: insertError } = await supabase
    .from('closing_lines')
    .insert({
      event_id: eventId,
      sportsbook_id: sportsbookId,
      market_type: marketType,
      side: side,
      captured_at: lastTick.captured_at,
      spread_points_home: lastTick.spread_points_home,
      total_points: lastTick.total_points,
      price_american: lastTick.price_american,
      price_decimal: lastTick.price_decimal,
    });

  if (insertError) throw insertError;
  result.linesSet++;
}
