import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// CFBD API for rankings
const CFBD_API_KEY = process.env.CFBD_API_KEY;
const CFBD_BASE_URL = 'https://apinext.collegefootballdata.com';

// Only use reliable sportsbooks
const ALLOWED_SPORTSBOOKS = ['draftkings', 'bovada'];

// Cache for rankings (5 minute TTL)
let rankingsCache: { data: Map<number, number>; timestamp: number } | null = null;
const RANKINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch AP Top 25 rankings from CFBD API
 * Returns a map of cfbd_team_id -> rank
 */
async function fetchAPRankings(): Promise<Map<number, number>> {
  // Check cache first
  if (rankingsCache && Date.now() - rankingsCache.timestamp < RANKINGS_CACHE_TTL) {
    return rankingsCache.data;
  }

  const rankingMap = new Map<number, number>();

  if (!CFBD_API_KEY) {
    console.warn('[Rankings] CFBD_API_KEY not configured');
    return rankingMap;
  }

  try {
    // Determine season based on current date (bowl games run into January)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const season = currentMonth <= 1 ? currentYear - 1 : currentYear;

    // Try postseason first, then regular season
    for (const seasonType of ['postseason', 'regular']) {
      const url = `${CFBD_BASE_URL}/rankings?year=${season}&seasonType=${seasonType}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${CFBD_API_KEY}`,
          'Accept': 'application/json',
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (!data || data.length === 0) continue;

      // Get the most recent week's rankings
      const latestRankings = data[data.length - 1];

      // Find AP Top 25 poll
      const apPoll = latestRankings.polls?.find((p: { poll: string }) => p.poll === 'AP Top 25');
      if (apPoll && apPoll.ranks) {
        for (const team of apPoll.ranks) {
          rankingMap.set(team.teamId, team.rank);
        }
        console.log(`[Rankings] Loaded ${rankingMap.size} AP rankings for ${season} ${seasonType}`);
        break; // Found rankings, stop looking
      }
    }

    // Update cache
    rankingsCache = { data: rankingMap, timestamp: Date.now() };
  } catch (err) {
    console.error('[Rankings] Failed to fetch:', err);
  }

  return rankingMap;
}

// Elo model constants
const ELO_DIVISOR = 25;
const HOME_FIELD_ADVANTAGE = 2.5;
const DEFAULT_ELO = 1500;

interface EdgeData {
  event_id: string;
  sportsbook_id: string;
  market_spread_home: number | null;
  market_price_american: number | null;
  edge_points: number | null;
}

interface ClosingLineData {
  event_id: string;
  spread_points_home: number | null;
}

interface ResultData {
  event_id: string;
  home_score: number;
  away_score: number;
}

interface EloSnapshot {
  team_id: string;
  elo: number;
  week: number;
  season: number;
}

interface GameWeekInfo {
  cfbd_game_id: number;
  season: number;
  week: number;
}

interface GamePrediction {
  event_id: string;
  closing_spread_home: number | null;
  model_spread_home: number | null;
  edge_points: number | null;
  recommended_side: string | null;
  recommended_bet: string | null;
}

interface GameResponse {
  event_id: string;
  home_team: string;
  away_team: string;
  home_team_id: string;
  away_team_id: string;
  home_rank: number | null;
  away_rank: number | null;
  commence_time: string;
  status: 'scheduled' | 'in_progress' | 'final';
  // Live odds (for upcoming games)
  market_spread_home: number | null;
  model_spread_home: number | null;
  edge_points: number | null;
  abs_edge: number | null;
  side: 'home' | 'away' | null;
  spread_price_home: number | null;
  spread_price_away: number | null;
  sportsbook: string | null;
  // Closing/locked odds (for completed games)
  closing_spread_home: number | null;
  closing_model_spread: number | null;
  // Results
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
  // Explicit bet recommendation
  recommended_bet: string | null;
}

/**
 * Calculate model spread from Elo ratings
 * Returns the home spread (negative = home favored)
 */
function calculateEloSpread(homeElo: number, awayElo: number): number {
  const eloDiff = homeElo - awayElo;
  const spreadFromElo = eloDiff / ELO_DIVISOR;
  const modelSpreadHome = -(spreadFromElo + HOME_FIELD_ADVANTAGE);
  return Math.round(modelSpreadHome * 2) / 2; // Round to 0.5
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const daysBack = parseInt(searchParams.get('daysBack') || '14');
    const daysAhead = parseInt(searchParams.get('daysAhead') || '14');

    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // Fetch AP rankings (cached)
    const apRankings = await fetchAPRankings();

    // Get events within date range
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        status,
        home_team_id,
        away_team_id,
        cfbd_game_id,
        home_team:teams!events_home_team_id_fkey(id, name, cfbd_team_id),
        away_team:teams!events_away_team_id_fkey(id, name, cfbd_team_id)
      `)
      .gte('commence_time', startDate.toISOString())
      .lte('commence_time', endDate.toISOString())
      .order('commence_time', { ascending: true });

    if (eventsError) {
      console.error('Events fetch error:', eventsError);
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ games: [] });
    }

    const eventIds = events.map(e => e.id);
    const teamIds = [...new Set(events.flatMap(e => [e.home_team_id, e.away_team_id]))];

    // Get sportsbook IDs for allowed books
    const { data: sportsbooks } = await supabase
      .from('sportsbooks')
      .select('id, key')
      .in('key', ALLOWED_SPORTSBOOKS);

    const sportsbookIds = sportsbooks?.map(s => s.id) || [];

    // Create sportsbook ID to key mapping
    const sportsbookKeyById = new Map<string, string>();
    for (const sb of sportsbooks || []) {
      sportsbookKeyById.set(sb.id, sb.key);
    }

    // Get latest edges for upcoming games (only from allowed sportsbooks)
    const { data: edges } = await supabase
      .from('edges')
      .select('*')
      .in('event_id', eventIds)
      .in('sportsbook_id', sportsbookIds)
      .eq('market_type', 'spread');

    // Create map of event_id -> best edge (highest absolute edge from allowed books)
    const edgeByEvent = new Map<string, EdgeData & { sportsbook_key: string }>();
    for (const edge of (edges || []) as EdgeData[]) {
      const existing = edgeByEvent.get(edge.event_id);
      if (!existing || Math.abs(edge.edge_points || 0) > Math.abs(existing.edge_points || 0)) {
        edgeByEvent.set(edge.event_id, {
          ...edge,
          sportsbook_key: sportsbookKeyById.get(edge.sportsbook_id) || 'unknown'
        });
      }
    }

    // Get closing lines for completed games
    const { data: closingLines } = await supabase
      .from('closing_lines')
      .select('*')
      .in('event_id', eventIds)
      .in('sportsbook_id', sportsbookIds)
      .eq('market_type', 'spread');

    // Create map of event_id -> closing line (prefer DraftKings)
    const closingByEvent = new Map<string, ClosingLineData>();
    for (const cl of (closingLines || []) as ClosingLineData[]) {
      const existing = closingByEvent.get(cl.event_id);
      if (!existing) {
        closingByEvent.set(cl.event_id, cl);
      }
    }

    // Get results for completed games
    const { data: results } = await supabase
      .from('results')
      .select('event_id, home_score, away_score')
      .in('event_id', eventIds);

    const resultByEvent = new Map<string, ResultData>();
    for (const r of (results || []) as ResultData[]) {
      resultByEvent.set(r.event_id, r);
    }

    // Get locked game predictions for completed games
    const { data: gamePredictions } = await supabase
      .from('game_predictions')
      .select('event_id, closing_spread_home, model_spread_home, edge_points, recommended_side, recommended_bet')
      .in('event_id', eventIds);

    const predictionByEvent = new Map<string, GamePrediction>();
    for (const gp of (gamePredictions || []) as GamePrediction[]) {
      predictionByEvent.set(gp.event_id, gp);
    }

    // Get projections for model spreads
    const { data: projections } = await supabase
      .from('projections')
      .select('event_id, model_spread_home, model_version_id, generated_at')
      .in('event_id', eventIds);

    // Get model version mapping
    const { data: modelVersions } = await supabase
      .from('model_versions')
      .select('id, name');

    const versionNameById = new Map<string, string>();
    for (const v of modelVersions || []) {
      versionNameById.set(v.id, v.name);
    }

    // Create map of event_id -> projection
    const projByEvent = new Map<string, { model_spread_home: number; generated_at: string }>();
    for (const p of projections || []) {
      const versionName = versionNameById.get(p.model_version_id);
      const existing = projByEvent.get(p.event_id);
      if (!existing) {
        projByEvent.set(p.event_id, { model_spread_home: p.model_spread_home, generated_at: p.generated_at });
      } else if (versionName === 'SPREADS_MARKET_ANCHORED_V1') {
        projByEvent.set(p.event_id, { model_spread_home: p.model_spread_home, generated_at: p.generated_at });
      }
    }

    // Get cfbd_game_ids from events
    const cfbdGameIds = events
      .filter(e => e.cfbd_game_id)
      .map(e => parseInt(e.cfbd_game_id));

    // Get week/season info from cfbd_betting_lines
    const { data: bettingLines } = await supabase
      .from('cfbd_betting_lines')
      .select('cfbd_game_id, season, week')
      .in('cfbd_game_id', cfbdGameIds);

    // Create map of cfbd_game_id -> {season, week}
    const weekInfoByGame = new Map<number, { season: number; week: number }>();
    for (const bl of (bettingLines || []) as GameWeekInfo[]) {
      if (!weekInfoByGame.has(bl.cfbd_game_id)) {
        weekInfoByGame.set(bl.cfbd_game_id, { season: bl.season, week: bl.week });
      }
    }

    // Get all Elo snapshots for teams (for point-in-time lookups)
    const { data: eloSnapshots } = await supabase
      .from('team_elo_snapshots')
      .select('team_id, elo, week, season')
      .in('team_id', teamIds)
      .order('season', { ascending: true })
      .order('week', { ascending: true });

    // Create map of team_id -> season -> week -> elo for point-in-time lookups
    const eloByTeamSeasonWeek = new Map<string, Map<number, Map<number, number>>>();
    for (const snap of (eloSnapshots || []) as EloSnapshot[]) {
      if (!eloByTeamSeasonWeek.has(snap.team_id)) {
        eloByTeamSeasonWeek.set(snap.team_id, new Map());
      }
      const teamMap = eloByTeamSeasonWeek.get(snap.team_id)!;
      if (!teamMap.has(snap.season)) {
        teamMap.set(snap.season, new Map());
      }
      teamMap.get(snap.season)!.set(snap.week, snap.elo);
    }

    // Helper to get point-in-time Elo (week N-1 for week N games)
    function getPointInTimeElo(teamId: string, season: number, gameWeek: number): number | null {
      const teamMap = eloByTeamSeasonWeek.get(teamId);
      if (!teamMap) return null;

      const seasonMap = teamMap.get(season);
      if (!seasonMap) return null;

      // For week 1 games, use week 0 (preseason)
      // For week N games, use week N-1
      const lookupWeek = gameWeek <= 1 ? 0 : gameWeek - 1;
      return seasonMap.get(lookupWeek) ?? null;
    }

    // Helper to get latest Elo for a team in a given season (fallback when week unknown)
    function getLatestSeasonElo(teamId: string, season: number): number | null {
      const teamMap = eloByTeamSeasonWeek.get(teamId);
      if (!teamMap) return null;

      const seasonMap = teamMap.get(season);
      if (!seasonMap || seasonMap.size === 0) return null;

      // Get the highest week number we have
      const maxWeek = Math.max(...seasonMap.keys());
      return seasonMap.get(maxWeek) ?? null;
    }

    // Build response
    const games: GameResponse[] = events.map(event => {
      const homeTeam = Array.isArray(event.home_team) ? event.home_team[0] : event.home_team;
      const awayTeam = Array.isArray(event.away_team) ? event.away_team[0] : event.away_team;
      const edge = edgeByEvent.get(event.id);
      const closing = closingByEvent.get(event.id);
      const result = resultByEvent.get(event.id);
      const lockedPrediction = predictionByEvent.get(event.id);

      const homeTeamName = homeTeam?.name || 'Home';
      const awayTeamName = awayTeam?.name || 'Away';

      // Get AP rankings for teams (if ranked)
      const homeCfbdId = homeTeam?.cfbd_team_id ? parseInt(homeTeam.cfbd_team_id) : null;
      const awayCfbdId = awayTeam?.cfbd_team_id ? parseInt(awayTeam.cfbd_team_id) : null;
      const homeRank = homeCfbdId ? apRankings.get(homeCfbdId) ?? null : null;
      const awayRank = awayCfbdId ? apRankings.get(awayCfbdId) ?? null : null;

      const isCompleted = event.status === 'final' || (result?.home_score !== null && result?.home_score !== undefined);

      // For completed games with locked predictions, use those
      // For upcoming games, use live edges
      let modelSpreadHome: number | null = null;
      let marketSpread: number | null = null;
      let edgePoints: number | null = null;
      let absEdge: number | null = null;
      let side: 'home' | 'away' | null = null;
      let recommendedBet: string | null = null;

      if (isCompleted && lockedPrediction) {
        // Use locked prediction data for completed games
        modelSpreadHome = lockedPrediction.model_spread_home;
        marketSpread = lockedPrediction.closing_spread_home ?? closing?.spread_points_home ?? null;
        edgePoints = lockedPrediction.edge_points;
        absEdge = edgePoints !== null ? Math.abs(edgePoints) : null;
        side = lockedPrediction.recommended_side === 'home' ? 'home' :
               lockedPrediction.recommended_side === 'away' ? 'away' : null;
        recommendedBet = lockedPrediction.recommended_bet;
      } else if (!isCompleted && edge) {
        // Use live edge data for upcoming games
        modelSpreadHome = edge.market_spread_home !== null ?
          (edge.market_spread_home - (edge.edge_points || 0)) : null;
        marketSpread = edge.market_spread_home;
        edgePoints = edge.edge_points;
        absEdge = edgePoints !== null ? Math.abs(edgePoints) : null;

        if (edgePoints !== null && edgePoints !== 0) {
          side = edgePoints > 0 ? 'home' : 'away';
          const betTeam = side === 'home' ? homeTeamName : awayTeamName;
          const betSpread = side === 'home' ? (marketSpread ?? 0) : -(marketSpread ?? 0);
          const betSpreadStr = betSpread > 0 ? `+${betSpread}` : betSpread === 0 ? 'PK' : `${betSpread}`;
          recommendedBet = `${betTeam} ${betSpreadStr}`;
        }
      } else if (isCompleted && closing) {
        // Completed game without locked prediction - just show closing line, no model data
        marketSpread = closing.spread_points_home;
        // Don't show fake model data for games we don't have predictions for
      }

      // Calculate bet result for completed games that have predictions
      let betResult: 'win' | 'loss' | 'push' | null = null;
      if (isCompleted && result && marketSpread !== null && side) {
        const actualMargin = result.home_score - result.away_score;

        if (side === 'home') {
          const cover = actualMargin + marketSpread;
          if (Math.abs(cover) < 0.001) betResult = 'push';
          else if (cover > 0) betResult = 'win';
          else betResult = 'loss';
        } else {
          const cover = -actualMargin - marketSpread;
          if (Math.abs(cover) < 0.001) betResult = 'push';
          else if (cover > 0) betResult = 'win';
          else betResult = 'loss';
        }
      }

      // Format sportsbook name for display
      const sportsbookDisplay = edge?.sportsbook_key === 'draftkings' ? 'DK' :
                                edge?.sportsbook_key === 'bovada' ? 'Bovada' :
                                edge?.sportsbook_key || null;

      return {
        event_id: event.id,
        home_team: homeTeamName,
        away_team: awayTeamName,
        home_team_id: event.home_team_id,
        away_team_id: event.away_team_id,
        home_rank: homeRank,
        away_rank: awayRank,
        commence_time: event.commence_time,
        status: event.status || 'scheduled',
        // Live odds
        market_spread_home: edge?.market_spread_home ?? null,
        model_spread_home: modelSpreadHome,
        edge_points: edgePoints,
        abs_edge: absEdge,
        side,
        spread_price_home: edge?.market_price_american ?? null,
        spread_price_away: edge?.market_price_american ? -edge.market_price_american : null,
        sportsbook: sportsbookDisplay,
        // Closing odds
        closing_spread_home: closing?.spread_points_home ?? null,
        closing_model_spread: modelSpreadHome,
        // Results
        home_score: result?.home_score ?? null,
        away_score: result?.away_score ?? null,
        bet_result: betResult,
        // Explicit recommendation
        recommended_bet: recommendedBet,
      };
    });

    // Filter out completed games that don't have model predictions
    // (games we couldn't track because we didn't have data at the time)
    const filteredGames = games.filter(game => {
      const isCompleted = game.status === 'final' || game.home_score !== null;
      if (isCompleted && !game.recommended_bet && !game.model_spread_home) {
        return false; // Skip completed games without predictions
      }
      return true;
    });

    return NextResponse.json({ games: filteredGames });
  } catch (error) {
    console.error('Games API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
