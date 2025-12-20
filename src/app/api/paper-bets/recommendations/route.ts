import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { projectSpread, calculateEdge } from '@/lib/models/v1-elo-model';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

interface RecommendedBet {
  event_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  side: 'home' | 'away';
  market_spread_home: number;
  spread_price_home: number;
  spread_price_away: number;
  model_spread_home: number;
  edge_points: number;
  abs_edge: number;
  rank: number;
  already_bet: boolean;
}

// PROD_V1_LOCKED filter: exclude spreads 3-7
function passesSpreadFilter(spread: number): boolean {
  const absSpread = Math.abs(spread);
  return absSpread <= 3 || absSpread >= 7;
}

export async function GET() {
  try {
    // Get upcoming events with odds
    const now = new Date().toISOString();
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:home_team_id (id, name),
        away_team:away_team_id (id, name)
      `)
      .gte('commence_time', now)
      .eq('status', 'scheduled')
      .order('commence_time')
      .limit(100);

    if (eventsError) throw eventsError;

    // Get latest odds for these events
    const eventIds = events?.map(e => e.id) || [];
    const { data: odds, error: oddsError } = await supabase
      .from('odds_ticks')
      .select('event_id, side, spread_points_home, price_american, captured_at')
      .in('event_id', eventIds)
      .eq('market_type', 'spread')
      .order('captured_at', { ascending: false });

    if (oddsError) throw oddsError;

    // Build latest odds map
    const latestOdds = new Map<string, { spreadHome: number; priceHome: number; priceAway: number }>();
    for (const tick of odds || []) {
      if (!latestOdds.has(tick.event_id)) {
        latestOdds.set(tick.event_id, { spreadHome: tick.spread_points_home, priceHome: -110, priceAway: -110 });
      }
      const existing = latestOdds.get(tick.event_id)!;
      existing.spreadHome = tick.spread_points_home;
      if (tick.side === 'home') existing.priceHome = tick.price_american;
      else existing.priceAway = tick.price_american;
    }

    // Get current season/week
    const today = new Date();
    const season = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const getSeason = (date: Date): number => {
      return date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear();
    };
    const getWeek = (date: Date, s: number): number => {
      const month = date.getMonth();
      if (month === 0) return 16;
      if (month === 7) return date.getDate() < 25 ? 0 : 1;
      const sept1 = new Date(s, 8, 1).getTime();
      const daysSince = Math.floor((date.getTime() - sept1) / (1000 * 60 * 60 * 24));
      return Math.max(1, Math.min(16, 1 + Math.floor(daysSince / 7)));
    };
    const week = getWeek(today, season);

    // Get Elo for teams - use latest available data
    const teamIds = new Set<string>();
    for (const e of events || []) {
      if (e.home_team_id) teamIds.add(e.home_team_id);
      if (e.away_team_id) teamIds.add(e.away_team_id);
    }

    // First try current season, then fall back to previous season
    let { data: eloData } = await supabase
      .from('team_elo_snapshots')
      .select('team_id, elo, week, season')
      .in('team_id', [...teamIds])
      .eq('season', season)
      .order('week', { ascending: false });

    // If no data for current season, try previous season
    if (!eloData || eloData.length === 0) {
      const { data: prevSeasonData } = await supabase
        .from('team_elo_snapshots')
        .select('team_id, elo, week, season')
        .in('team_id', [...teamIds])
        .eq('season', season - 1)
        .order('week', { ascending: false });
      eloData = prevSeasonData;
    }

    // Get latest Elo per team
    const eloMap = new Map<string, number>();
    for (const e of eloData || []) {
      if (!eloMap.has(e.team_id)) {
        eloMap.set(e.team_id, e.elo);
      }
    }

    console.log(`Loaded Elo for ${eloMap.size} teams from season ${eloData?.[0]?.season || 'unknown'}`);

    // Check which events already have paper bets
    const { data: existingBets } = await supabase
      .from('paper_bets')
      .select('event_id')
      .in('event_id', eventIds);

    const alreadyBet = new Set((existingBets || []).map(b => b.event_id));

    // Calculate edges for all events
    const recommendations: RecommendedBet[] = [];

    for (const event of events || []) {
      const odds = latestOdds.get(event.id);
      if (!odds) continue;

      const homeElo = eloMap.get(event.home_team_id) || 1500;
      const awayElo = eloMap.get(event.away_team_id) || 1500;

      const { modelSpreadHome } = projectSpread(homeElo, awayElo);
      const { edge, side } = calculateEdge(odds.spreadHome, modelSpreadHome);

      // Apply PROD_V1 spread filter
      if (!passesSpreadFilter(odds.spreadHome)) continue;

      recommendations.push({
        event_id: event.id,
        home_team: (event.home_team as any)?.name || 'Unknown',
        away_team: (event.away_team as any)?.name || 'Unknown',
        commence_time: event.commence_time,
        side,
        market_spread_home: odds.spreadHome,
        spread_price_home: odds.priceHome,
        spread_price_away: odds.priceAway,
        model_spread_home: modelSpreadHome,
        edge_points: edge,
        abs_edge: Math.abs(edge),
        rank: 0,
        already_bet: alreadyBet.has(event.id),
      });
    }

    // Sort by absolute edge and take top 10
    recommendations.sort((a, b) => b.abs_edge - a.abs_edge);
    const top10 = recommendations.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));

    return NextResponse.json({
      season,
      week,
      recommendations: top10,
      total_eligible: recommendations.length,
    });
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return NextResponse.json(
      { error: 'Failed to get recommendations' },
      { status: 500 }
    );
  }
}
