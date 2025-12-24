import { supabase } from '@/lib/db/client';
import { computeT60Projection, qualifiesForBet } from '@/lib/models/t60-ensemble-v1';
import { isFBSGame } from '@/lib/fbs-teams';

export interface SetClosingLinesResult {
  eventsProcessed: number;
  linesSet: number;
  predictionsLocked: number;
  predictionsCalculated: number;
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
    predictionsCalculated: 0,
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
 * Get team ratings for T-60 model calculation
 */
async function getTeamRatings(
  teamId: string,
  season: number
): Promise<{
  elo: number;
  spOverall: number;
  offPPA: number;
  defPPA: number;
} | null> {
  const { data: eloData } = await supabase
    .from('team_elo_snapshots')
    .select('elo')
    .eq('team_id', teamId)
    .eq('season', season)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  const { data: ratingsData } = await supabase
    .from('advanced_team_ratings')
    .select('sp_overall, off_ppa, def_ppa')
    .eq('team_id', teamId)
    .eq('season', season)
    .single();

  if (!eloData && !ratingsData) return null;

  return {
    elo: eloData?.elo || 1500,
    spOverall: ratingsData?.sp_overall || 0,
    offPPA: ratingsData?.off_ppa || 0,
    defPPA: ratingsData?.def_ppa || 0,
  };
}

/**
 * Lock the model prediction for an event into game_predictions table
 * This preserves what our model said at game time for historical tracking
 *
 * If no pre-calculated edge exists, calculates the prediction on-the-fly
 * using the T-60 ensemble model.
 */
async function lockGamePrediction(
  eventId: string,
  result: SetClosingLinesResult
): Promise<void> {
  // Get DraftKings sportsbook ID
  const { data: dkBook } = await supabase
    .from('sportsbooks')
    .select('id')
    .eq('key', 'draftkings')
    .single();

  if (!dkBook) {
    console.log(`[SetClosing] DraftKings sportsbook not found`);
    return;
  }

  // Get the edge (model prediction) for this event
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

  // Prefer DraftKings edge, otherwise take first available
  let edge = edges?.find(e => e.sportsbook_id === dkBook.id) || edges?.[0];

  // If no edge exists, calculate on-the-fly using T-60 model
  if (!edge) {
    console.log(`[SetClosing] No edge found for event ${eventId}, calculating on-the-fly...`);

    // Get event details with teams
    const { data: event } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:teams!events_home_team_id_fkey(id, name),
        away_team:teams!events_away_team_id_fkey(id, name)
      `)
      .eq('id', eventId)
      .single();

    if (!event) {
      console.log(`[SetClosing] Event ${eventId} not found`);
      return;
    }

    const homeTeam = Array.isArray(event.home_team) ? event.home_team[0] : event.home_team;
    const awayTeam = Array.isArray(event.away_team) ? event.away_team[0] : event.away_team;

    if (!homeTeam?.name || !awayTeam?.name) {
      console.log(`[SetClosing] Missing team data for event ${eventId}`);
      return;
    }

    // Check FBS filter
    if (!isFBSGame(homeTeam.name, awayTeam.name)) {
      console.log(`[SetClosing] Skipping non-FBS game: ${awayTeam.name} @ ${homeTeam.name}`);
      return;
    }

    // Get closing line (last tick before kickoff)
    const { data: closingTick } = await supabase
      .from('closing_lines')
      .select('spread_points_home, price_american')
      .eq('event_id', eventId)
      .eq('sportsbook_id', dkBook.id)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .single();

    // Or get latest tick if no closing line yet
    let marketSpread = closingTick?.spread_points_home;
    let priceAmerican = closingTick?.price_american;

    if (marketSpread === null || marketSpread === undefined) {
      const { data: latestTick } = await supabase
        .from('odds_ticks')
        .select('spread_points_home, price_american')
        .eq('event_id', eventId)
        .eq('sportsbook_id', dkBook.id)
        .eq('market_type', 'spread')
        .eq('side', 'home')
        .order('captured_at', { ascending: false })
        .limit(1)
        .single();

      marketSpread = latestTick?.spread_points_home;
      priceAmerican = latestTick?.price_american;
    }

    if (marketSpread === null || marketSpread === undefined) {
      console.log(`[SetClosing] No spread data for event ${eventId}`);
      return;
    }

    // Get team ratings
    const commenceDate = new Date(event.commence_time);
    const season = commenceDate.getMonth() === 0 ? commenceDate.getFullYear() - 1 : commenceDate.getFullYear();

    const homeRatings = await getTeamRatings(homeTeam.id, season);
    const awayRatings = await getTeamRatings(awayTeam.id, season);

    if (!homeRatings || !awayRatings) {
      console.log(`[SetClosing] Missing ratings for ${homeTeam.name} vs ${awayTeam.name}`);
      return;
    }

    // Calculate T-60 projection
    const projection = computeT60Projection(
      homeRatings.elo,
      awayRatings.elo,
      homeRatings.spOverall,
      awayRatings.spOverall,
      homeRatings.offPPA,
      homeRatings.defPPA,
      awayRatings.offPPA,
      awayRatings.defPPA
    );

    const betCheck = qualifiesForBet(marketSpread, projection.modelSpread, projection.modelDisagreement);

    // Build edge-like object
    let recommendedSide: string;
    let recommendedBetLabel: string;

    if (betCheck.edge > 0) {
      recommendedSide = 'home';
      recommendedBetLabel = `${homeTeam.name} ${marketSpread > 0 ? '+' : ''}${marketSpread}`;
    } else if (betCheck.edge < 0) {
      recommendedSide = 'away';
      recommendedBetLabel = `${awayTeam.name} ${-marketSpread > 0 ? '+' : ''}${-marketSpread}`;
    } else {
      recommendedSide = 'none';
      recommendedBetLabel = 'No edge';
    }

    // Insert calculated prediction
    const { error: insertError } = await supabase
      .from('game_predictions')
      .insert({
        event_id: eventId,
        sportsbook_id: dkBook.id,
        closing_spread_home: marketSpread,
        closing_price_american: priceAmerican,
        model_spread_home: projection.modelSpread,
        edge_points: betCheck.edge,
        recommended_side: recommendedSide,
        recommended_bet: recommendedBetLabel,
        locked_at: new Date().toISOString(),
      });

    if (insertError) {
      if (insertError.code !== '23505') throw insertError;
      return;
    }

    result.predictionsCalculated++;
    console.log(`[SetClosing] Calculated & locked prediction for ${awayTeam.name} @ ${homeTeam.name}: ${recommendedBetLabel} (${betCheck.edge.toFixed(1)} edge)`);
    return;
  }

  // Edge exists - use it
  const { data: closingLine } = await supabase
    .from('closing_lines')
    .select('spread_points_home, price_american')
    .eq('event_id', eventId)
    .eq('sportsbook_id', edge.sportsbook_id)
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .single();

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
    if (insertError.code !== '23505') throw insertError;
    return;
  }

  result.predictionsLocked++;
  console.log(`[SetClosing] Locked prediction for event ${eventId}: ${edge.recommended_bet_label}`);
}
