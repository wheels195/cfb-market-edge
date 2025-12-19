import { supabase } from './client';
import { EdgeWithDetails, MarketType } from '@/types/database';

export interface EdgesFilter {
  sportsbookKey?: string;
  marketType?: MarketType;
  minEdge?: number;
  hoursAhead?: number;
}

/**
 * Get edges with full event and sportsbook details
 */
export async function getEdgesWithDetails(
  filter: EdgesFilter = {}
): Promise<EdgeWithDetails[]> {
  const { sportsbookKey, marketType, minEdge, hoursAhead = 72 } = filter;

  // Calculate time window
  const now = new Date();
  const futureLimit = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  // Build query - note: projections is joined via event, not directly from edges
  let query = supabase
    .from('edges')
    .select(`
      *,
      event:events(
        *,
        home_team:teams!events_home_team_id_fkey(name, abbrev),
        away_team:teams!events_away_team_id_fkey(name, abbrev),
        projections(*)
      ),
      sportsbook:sportsbooks(id, key, name)
    `)
    .order('rank_abs_edge', { ascending: true });

  // Apply filters
  if (marketType) {
    query = query.eq('market_type', marketType);
  }

  if (minEdge !== undefined && minEdge > 0) {
    // Filter by absolute edge
    query = query.or(`edge_points.gte.${minEdge},edge_points.lte.${-minEdge}`);
  }

  const { data: edges, error } = await query;

  if (error) throw error;
  if (!edges) return [];

  // Helper to normalize Supabase nested results
  const normalize = <T>(val: T | T[]): T | undefined =>
    Array.isArray(val) ? val[0] : val;

  // Filter by sportsbook if specified (need to do post-fetch due to nested filter)
  let filtered = edges;
  if (sportsbookKey) {
    filtered = edges.filter(e => {
      const sb = normalize(e.sportsbook);
      return sb?.key === sportsbookKey;
    });
  }

  // Filter by event time window
  filtered = filtered.filter(e => {
    const event = normalize(e.event);
    if (!event) return false;
    const commenceTime = new Date(event.commence_time);
    return commenceTime > now && commenceTime < futureLimit && event.status === 'scheduled';
  });

  // Transform to EdgeWithDetails format
  // Note: Supabase returns nested relations as arrays
  const transformed = filtered.map(edge => {
    const rawEvent = edge.event;
    const event = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;
    const homeTeam = event?.home_team;
    const awayTeam = event?.away_team;
    const normalizedHomeTeam = Array.isArray(homeTeam) ? homeTeam[0] : homeTeam;
    const normalizedAwayTeam = Array.isArray(awayTeam) ? awayTeam[0] : awayTeam;
    const sportsbook = Array.isArray(edge.sportsbook) ? edge.sportsbook[0] : edge.sportsbook;
    // Projection is now nested under event
    const rawProjections = event?.projections;
    const projection = Array.isArray(rawProjections) ? rawProjections[0] : rawProjections;

    return {
      ...edge,
      event: event ? {
        ...event,
        home_team_name: normalizedHomeTeam?.name || 'Unknown',
        home_team_abbrev: normalizedHomeTeam?.abbrev || null,
        away_team_name: normalizedAwayTeam?.name || 'Unknown',
        away_team_abbrev: normalizedAwayTeam?.abbrev || null,
      } : null,
      sportsbook,
      projection,
    } as EdgeWithDetails;
  });

  // Sort by: 1) qualifying bets first, 2) expected value descending
  transformed.sort((a, b) => {
    const aExplain = a.explain as { qualifies?: boolean; expectedValue?: number } | null;
    const bExplain = b.explain as { qualifies?: boolean; expectedValue?: number } | null;

    const aQualifies = aExplain?.qualifies ?? false;
    const bQualifies = bExplain?.qualifies ?? false;

    // Qualifying bets first
    if (aQualifies && !bQualifies) return -1;
    if (!aQualifies && bQualifies) return 1;

    // Then by expected value (highest first)
    const aEV = aExplain?.expectedValue ?? -999;
    const bEV = bExplain?.expectedValue ?? -999;
    return bEV - aEV;
  });

  return transformed;
}

/**
 * Get opening line for an edge (for line movement preview)
 */
export async function getOpeningLine(
  eventId: string,
  sportsbookId: string,
  marketType: MarketType
): Promise<{ spread_points_home?: number; total_points?: number } | null> {
  const side = marketType === 'spread' ? 'home' : 'over';

  const { data } = await supabase
    .from('odds_ticks')
    .select('spread_points_home, total_points')
    .eq('event_id', eventId)
    .eq('sportsbook_id', sportsbookId)
    .eq('market_type', marketType)
    .eq('side', side)
    .order('captured_at', { ascending: true })
    .limit(1)
    .single();

  return data;
}
