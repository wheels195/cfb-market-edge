import { supabase } from './client';
import { EventWithTeams, Sportsbook, OddsTick } from '@/types/database';

/**
 * Get all sportsbooks
 */
export async function getSportsbooks(): Promise<Sportsbook[]> {
  const { data, error } = await supabase
    .from('sportsbooks')
    .select('*')
    .order('name');

  if (error) throw error;
  return data || [];
}

/**
 * Get sportsbook by key
 */
export async function getSportsbookByKey(key: string): Promise<Sportsbook | null> {
  const { data, error } = await supabase
    .from('sportsbooks')
    .select('*')
    .eq('key', key)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get upcoming events with team details
 */
export async function getUpcomingEvents(limit: number = 50): Promise<EventWithTeams[]> {
  const { data, error } = await supabase
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

  if (error) throw error;

  // Transform the nested structure
  return (data || []).map((event) => ({
    ...event,
    home_team_name: event.home_team?.name || 'Unknown',
    home_team_abbrev: event.home_team?.abbrev || null,
    away_team_name: event.away_team?.name || 'Unknown',
    away_team_abbrev: event.away_team?.abbrev || null,
  }));
}

/**
 * Get event by ID with team details
 */
export async function getEventById(id: string): Promise<EventWithTeams | null> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      home_team:teams!events_home_team_id_fkey(name, abbrev),
      away_team:teams!events_away_team_id_fkey(name, abbrev)
    `)
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return {
    ...data,
    home_team_name: data.home_team?.name || 'Unknown',
    home_team_abbrev: data.home_team?.abbrev || null,
    away_team_name: data.away_team?.name || 'Unknown',
    away_team_abbrev: data.away_team?.abbrev || null,
  };
}

/**
 * Get event by Odds API event ID
 */
export async function getEventByOddsApiId(oddsApiEventId: string): Promise<EventWithTeams | null> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      home_team:teams!events_home_team_id_fkey(name, abbrev),
      away_team:teams!events_away_team_id_fkey(name, abbrev)
    `)
    .eq('odds_api_event_id', oddsApiEventId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return {
    ...data,
    home_team_name: data.home_team?.name || 'Unknown',
    home_team_abbrev: data.home_team?.abbrev || null,
    away_team_name: data.away_team?.name || 'Unknown',
    away_team_abbrev: data.away_team?.abbrev || null,
  };
}

/**
 * Get latest odds ticks for an event
 */
export async function getLatestOddsForEvent(eventId: string): Promise<OddsTick[]> {
  // Get distinct latest ticks for each book/market/side combo
  const { data, error } = await supabase
    .from('odds_ticks')
    .select('*')
    .eq('event_id', eventId)
    .order('captured_at', { ascending: false });

  if (error) throw error;

  // Dedupe to get only the latest for each combination
  const latest = new Map<string, OddsTick>();
  for (const tick of data || []) {
    const key = `${tick.sportsbook_id}-${tick.market_type}-${tick.side}`;
    if (!latest.has(key)) {
      latest.set(key, tick);
    }
  }

  return Array.from(latest.values());
}

/**
 * Get odds history for an event (for line movement charts)
 */
export async function getOddsHistory(
  eventId: string,
  sportsbookId?: string,
  marketType?: 'spread' | 'total'
): Promise<OddsTick[]> {
  let query = supabase
    .from('odds_ticks')
    .select('*')
    .eq('event_id', eventId)
    .order('captured_at', { ascending: true });

  if (sportsbookId) {
    query = query.eq('sportsbook_id', sportsbookId);
  }

  if (marketType) {
    query = query.eq('market_type', marketType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Check if a tick already exists (for deduplication)
 */
export async function tickExists(
  eventId: string,
  sportsbookId: string,
  marketType: string,
  side: string,
  payloadHash: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('odds_ticks')
    .select('id')
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType)
    .eq('side', side)
    .eq('payload_hash', payloadHash)
    .limit(1);

  if (error) throw error;
  return (data?.length || 0) > 0;
}

/**
 * Insert odds tick
 */
export async function insertOddsTick(tick: Omit<OddsTick, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase
    .from('odds_ticks')
    .insert(tick);

  if (error) throw error;
}

/**
 * Get events that need polling based on time to kickoff
 */
export async function getPollableEvents(): Promise<EventWithTeams[]> {
  const now = new Date();
  const daysAhead = parseInt(process.env.EVENTS_SYNC_DAYS_AHEAD || '10', 10);
  const futureLimit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      home_team:teams!events_home_team_id_fkey(name, abbrev),
      away_team:teams!events_away_team_id_fkey(name, abbrev)
    `)
    .eq('status', 'scheduled')
    .gt('commence_time', now.toISOString())
    .lt('commence_time', futureLimit.toISOString())
    .order('commence_time', { ascending: true });

  if (error) throw error;

  return (data || []).map((event) => ({
    ...event,
    home_team_name: event.home_team?.name || 'Unknown',
    home_team_abbrev: event.home_team?.abbrev || null,
    away_team_name: event.away_team?.name || 'Unknown',
    away_team_abbrev: event.away_team?.abbrev || null,
  }));
}
