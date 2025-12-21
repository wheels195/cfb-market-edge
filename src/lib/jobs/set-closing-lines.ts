import { supabase } from '@/lib/db/client';

export interface SetClosingLinesResult {
  eventsProcessed: number;
  linesSet: number;
  predictionsLocked: number;
  skippedAlreadySet: number;
  errors: string[];
}

// Only process events from the last 48 hours to avoid reprocessing old games
const LOOKBACK_HOURS = 48;

/**
 * Materialize closing lines for events that have kicked off
 *
 * Runs continuously (every 30 min on game days) to catch games as they start.
 * Per-event closing = last tick before that event's kickoff time.
 */
export async function setClosingLines(): Promise<SetClosingLinesResult> {
  const result: SetClosingLinesResult = {
    eventsProcessed: 0,
    linesSet: 0,
    predictionsLocked: 0,
    skippedAlreadySet: 0,
    errors: [],
  };

  const now = new Date();
  const lookbackTime = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  console.log(`[SetClosing] Finding events kicked off between ${lookbackTime.toISOString()} and ${now.toISOString()}`);

  try {
    // Get events that have kicked off within the lookback window
    // Include scheduled (missed status update), in_progress, and final
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, commence_time')
      .lt('commence_time', now.toISOString())
      .gt('commence_time', lookbackTime.toISOString())
      .order('commence_time', { ascending: false });

    if (eventsError) throw eventsError;

    if (!events || events.length === 0) {
      console.log('[SetClosing] No recently kicked-off events found');
      return result;
    }

    console.log(`[SetClosing] Found ${events.length} events to check`);

    // Check which events already have closing lines (optimization)
    const eventIds = events.map(e => e.id);
    const { data: existingClosings } = await supabase
      .from('closing_lines')
      .select('event_id')
      .in('event_id', eventIds);

    const eventsWithClosings = new Set((existingClosings || []).map(c => c.event_id));

    // Check which events already have game predictions
    const { data: existingPredictions } = await supabase
      .from('game_predictions')
      .select('event_id')
      .in('event_id', eventIds);

    const eventsWithPredictions = new Set((existingPredictions || []).map(p => p.event_id));

    for (const event of events) {
      try {
        // Process closing lines if not already set
        if (!eventsWithClosings.has(event.id)) {
          await processEventClosingLines(event.id, new Date(event.commence_time), result);
        } else {
          result.skippedAlreadySet++;
        }

        // Lock model prediction if not already done
        if (!eventsWithPredictions.has(event.id)) {
          await lockGamePrediction(event.id, result);
        }

        result.eventsProcessed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${event.id}: ${message}`);
      }
    }

    console.log(`[SetClosing] Complete: ${result.eventsProcessed} processed, ${result.linesSet} lines set, ${result.predictionsLocked} predictions locked, ${result.skippedAlreadySet} skipped`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Fetch failed: ${message}`);
    console.error(`[SetClosing] Error: ${message}`);
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

/**
 * Lock the model prediction for an event into game_predictions table
 * This preserves what our model said at game time for historical tracking
 */
async function lockGamePrediction(
  eventId: string,
  result: SetClosingLinesResult
): Promise<void> {
  // Get the edge (model prediction) for this event
  // Prefer DraftKings, fall back to any available
  const { data: edges, error: edgeError } = await supabase
    .from('edges')
    .select(`
      event_id,
      sportsbook_id,
      market_spread_home,
      model_spread_home,
      edge_points,
      recommended_side,
      recommended_bet_label
    `)
    .eq('event_id', eventId)
    .eq('market_type', 'spread');

  if (edgeError) throw edgeError;
  if (!edges || edges.length === 0) {
    console.log(`[SetClosing] No edge found for event ${eventId}`);
    return;
  }

  // Get DraftKings sportsbook ID
  const { data: dkBook } = await supabase
    .from('sportsbooks')
    .select('id')
    .eq('key', 'draftkings')
    .single();

  // Prefer DraftKings edge, otherwise take first available
  const edge = edges.find(e => e.sportsbook_id === dkBook?.id) || edges[0];

  // Get closing line for this event/sportsbook
  const { data: closingLine } = await supabase
    .from('closing_lines')
    .select('spread_points_home, price_american')
    .eq('event_id', eventId)
    .eq('sportsbook_id', edge.sportsbook_id)
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .single();

  // Insert game prediction
  const { error: insertError } = await supabase
    .from('game_predictions')
    .insert({
      event_id: eventId,
      sportsbook_id: edge.sportsbook_id,
      closing_spread_home: closingLine?.spread_points_home ?? edge.market_spread_home,
      closing_price_american: closingLine?.price_american,
      model_spread_home: edge.model_spread_home,
      edge_points: edge.edge_points,
      recommended_side: edge.recommended_side,
      recommended_bet: edge.recommended_bet_label,
      locked_at: new Date().toISOString(),
    });

  if (insertError) {
    // Ignore unique constraint violations (already exists)
    if (insertError.code !== '23505') {
      throw insertError;
    }
    return;
  }

  result.predictionsLocked++;
  console.log(`[SetClosing] Locked prediction for event ${eventId}: ${edge.recommended_bet_label}`);
}
