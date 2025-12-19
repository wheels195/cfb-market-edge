import { supabase } from './client';
import { EventWithOdds, EventWithTeams, Sportsbook } from '@/types/database';

interface RawOddsTick {
  id: string;
  event_id: string;
  sportsbook_id: string;
  market_type: 'spread' | 'total';
  side: string;
  spread_points_home: number | null;
  total_points: number | null;
  price_american: number;
  captured_at: string;
  sportsbook: { key: string }[] | { key: string } | null;
}

function getSportsbookKey(sportsbook: RawOddsTick['sportsbook']): string {
  if (!sportsbook) return 'unknown';
  if (Array.isArray(sportsbook)) return sportsbook[0]?.key || 'unknown';
  return sportsbook.key || 'unknown';
}

/**
 * Get upcoming events with their latest odds from all books
 */
export async function getEventsWithOdds(limit: number = 50): Promise<EventWithOdds[]> {
  // First get upcoming events
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select(`
      *,
      home_team:teams!events_home_team_id_fkey(name, abbrev),
      away_team:teams!events_away_team_id_fkey(name, abbrev)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', new Date().toISOString())
    .order('commence_time', { ascending: true })
    .limit(limit);

  if (eventsError) throw eventsError;
  if (!events || events.length === 0) return [];

  const eventIds = events.map(e => e.id);

  // Get all latest odds for these events
  const { data: oddsTicks, error: oddsError } = await supabase
    .from('odds_ticks')
    .select(`
      id,
      event_id,
      sportsbook_id,
      market_type,
      side,
      spread_points_home,
      total_points,
      price_american,
      captured_at,
      sportsbook:sportsbooks(key)
    `)
    .in('event_id', eventIds)
    .order('captured_at', { ascending: false });

  if (oddsError) throw oddsError;

  // Build a map of latest odds per event/book/market/side
  const latestOdds = new Map<string, RawOddsTick>();
  for (const tick of (oddsTicks || []) as unknown as RawOddsTick[]) {
    const key = `${tick.event_id}-${tick.sportsbook_id}-${tick.market_type}-${tick.side}`;
    if (!latestOdds.has(key)) {
      latestOdds.set(key, tick);
    }
  }

  // Transform events with their odds
  return events.map(event => {
    const eventOdds: EventWithOdds['odds'] = {};

    // Process all ticks for this event
    for (const [, tick] of latestOdds) {
      if (tick.event_id !== event.id) continue;

      const bookKey = getSportsbookKey(tick.sportsbook);
      if (!eventOdds[bookKey]) {
        eventOdds[bookKey] = {};
      }

      if (tick.market_type === 'spread' && tick.spread_points_home !== null) {
        if (!eventOdds[bookKey].spread) {
          eventOdds[bookKey].spread = {
            home: { points: 0, price: 0 },
            away: { points: 0, price: 0 },
            updated_at: tick.captured_at,
          };
        }

        if (tick.side === 'home') {
          eventOdds[bookKey].spread!.home = {
            points: tick.spread_points_home,
            price: tick.price_american,
          };
        } else if (tick.side === 'away') {
          eventOdds[bookKey].spread!.away = {
            points: -tick.spread_points_home, // Away spread is inverse
            price: tick.price_american,
          };
        }
        eventOdds[bookKey].spread!.updated_at = tick.captured_at;
      }

      if (tick.market_type === 'total' && tick.total_points !== null) {
        if (!eventOdds[bookKey].total) {
          eventOdds[bookKey].total = {
            over: { points: 0, price: 0 },
            under: { points: 0, price: 0 },
            updated_at: tick.captured_at,
          };
        }

        if (tick.side === 'over') {
          eventOdds[bookKey].total!.over = {
            points: tick.total_points,
            price: tick.price_american,
          };
        } else if (tick.side === 'under') {
          eventOdds[bookKey].total!.under = {
            points: tick.total_points,
            price: tick.price_american,
          };
        }
        eventOdds[bookKey].total!.updated_at = tick.captured_at;
      }
    }

    return {
      ...event,
      home_team_name: event.home_team?.name || 'Unknown',
      home_team_abbrev: event.home_team?.abbrev || null,
      away_team_name: event.away_team?.name || 'Unknown',
      away_team_abbrev: event.away_team?.abbrev || null,
      odds: eventOdds,
    } as EventWithOdds;
  });
}

/**
 * Format American odds for display
 */
export function formatOdds(price: number): string {
  if (price > 0) return `+${price}`;
  return price.toString();
}

/**
 * Format spread points for display
 */
export function formatSpread(points: number): string {
  if (points > 0) return `+${points}`;
  return points.toString();
}
