import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/client';
import { CbbRatingSystem, analyzeCbbBet } from '@/lib/models/cbb-elo';

export const dynamic = 'force-dynamic';

interface CbbGame {
  id: string;
  start_date: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  home_team: {
    id: string;
    name: string;
    conference: string | null;
    rating: number;
    games_played: number;
  };
  away_team: {
    id: string;
    name: string;
    conference: string | null;
    rating: number;
    games_played: number;
  };
  market_spread: number | null;
  model_spread: number | null;
  edge_points: number | null;
  spread_size: number | null;
  recommended_side: 'home' | 'away' | null;
  is_underdog_bet: boolean;
  bet_strategy: 'favorite' | 'underdog' | null;  // NEW: Which strategy this qualifies under
  qualifies_for_bet: boolean;
  qualification_reason: string | null;
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
}

/**
 * Get the current CBB season (2025-26 = 2026)
 */
function getCurrentSeason(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // CBB season labels: Nov 2025 - Apr 2026 = "2026" season
  if (month >= 11) return year + 1;
  if (month <= 4) return year;
  return year + 1; // Off-season defaults to upcoming season
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'upcoming';
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const season = getCurrentSeason();
    const now = new Date();

    // Load team conferences
    const { data: teamsData } = await supabase
      .from('cbb_teams')
      .select('id, conference');

    const confMap = new Map<string, string>();
    for (const team of teamsData || []) {
      if (team.conference) {
        confMap.set(team.id, team.conference);
      }
    }

    // Load ratings (DB column is 'elo' but stores team rating)
    const { data: ratingData } = await supabase
      .from('cbb_elo_snapshots')
      .select('team_id, elo, games_played')
      .eq('season', season);

    const ratingMap = new Map<string, { rating: number; games: number }>();
    for (const row of ratingData || []) {
      ratingMap.set(row.team_id, { rating: row.elo, games: row.games_played });
    }

    // Build query based on filter (D1 only - both team IDs must exist)
    // Join betting lines to get market spread
    let query = supabase
      .from('cbb_games')
      .select(`
        id,
        start_date,
        home_team_id,
        away_team_id,
        home_team_name,
        away_team_name,
        home_score,
        away_score,
        cbb_betting_lines (
          spread_home,
          total,
          provider
        ),
        cbb_game_predictions (
          model_spread_home,
          market_spread_home,
          edge_points,
          predicted_side,
          is_underdog_bet,
          qualifies_for_bet,
          qualification_reason,
          bet_result
        )
      `)
      .eq('season', season)
      .not('home_team_id', 'is', null) // D1 filter
      .not('away_team_id', 'is', null); // D1 filter

    if (filter === 'upcoming') {
      // CBBD returns 0-0 for upcoming games, not null
      // Fetch more games to ensure we have enough with odds
      query = query
        .eq('home_score', 0)
        .eq('away_score', 0)
        .gte('start_date', now.toISOString())
        .order('start_date', { ascending: true })
        .limit(300); // Fetch more to filter for games with odds
    } else if (filter === 'bets') {
      // For bets, fetch more games since we filter after
      query = query
        .eq('home_score', 0)
        .eq('away_score', 0)
        .gte('start_date', now.toISOString())
        .order('start_date', { ascending: true })
        .limit(500); // Override limit to catch all qualifiers
    } else if (filter === 'completed') {
      // Completed games - fetch more to filter for qualifying bets with results
      query = query
        .or('home_score.neq.0,away_score.neq.0')
        .order('start_date', { ascending: false })
        .limit(500); // Fetch more to find qualifying bets
    }

    // Don't override limit for 'bets' and 'completed' filters (already set to 500)
    if (filter !== 'bets' && filter !== 'completed') {
      query = query.limit(limit);
    }

    const { data: games, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Initialize rating system
    const ratingSystem = new CbbRatingSystem();
    for (const [teamId, conf] of confMap) {
      ratingSystem.setTeamConference(teamId, conf);
    }
    for (const [teamId, data] of ratingMap) {
      ratingSystem.setRating(teamId, data.rating, data.games);
    }

    const result: CbbGame[] = (games || []).map((game: any) => {
      // Handle both array and object formats from Supabase join
      const predRaw = game.cbb_game_predictions;
      const prediction = Array.isArray(predRaw) ? predRaw[0] : predRaw;
      const lineRaw = game.cbb_betting_lines;
      const bettingLine = Array.isArray(lineRaw) ? lineRaw[0] : lineRaw;

      const homeRatingData = ratingMap.get(game.home_team_id) || { rating: 0, games: 0 };
      const awayRatingData = ratingMap.get(game.away_team_id) || { rating: 0, games: 0 };
      const homeConf = confMap.get(game.home_team_id) || null;
      const awayConf = confMap.get(game.away_team_id) || null;

      // Determine status - CBBD uses 0-0 for upcoming, not null
      let status: 'upcoming' | 'in_progress' | 'completed' = 'upcoming';
      const isCompleted = game.home_score !== 0 || game.away_score !== 0;
      if (isCompleted) {
        status = 'completed';
      } else if (new Date(game.start_date) <= now) {
        status = 'in_progress';
      }

      // Calculate model spread from rating system
      const modelSpread = ratingSystem.getSpread(game.home_team_id, game.away_team_id);

      // Get market spread from betting lines or predictions
      const marketSpread = bettingLine?.spread_home ?? prediction?.market_spread_home ?? null;

      // Analyze bet if we have market spread
      let analysis: {
        qualifies: boolean;
        isUnderdog: boolean;
        strategy: 'favorite' | 'underdog' | null;
        absEdge: number;
        spreadSize: number;
        side: 'home' | 'away';
        qualificationReason: string | null;
        reason: string | null;
      } = {
        qualifies: false,
        isUnderdog: false,
        strategy: null,
        absEdge: 0,
        spreadSize: 0,
        side: 'home',
        qualificationReason: null,
        reason: null,
      };

      if (marketSpread !== null) {
        const betAnalysis = analyzeCbbBet(
          marketSpread,
          modelSpread,
          homeConf,
          awayConf
        );
        analysis = {
          qualifies: betAnalysis.qualifies,
          isUnderdog: betAnalysis.isUnderdog,
          strategy: betAnalysis.strategy,
          absEdge: betAnalysis.absEdge,
          spreadSize: betAnalysis.spreadSize,
          side: betAnalysis.side,
          qualificationReason: betAnalysis.qualificationReason,
          reason: betAnalysis.reason,
        };
      }

      // Get total rating (team + conference) for display
      const homeTotalRating = ratingSystem.getTotalRating(game.home_team_id);
      const awayTotalRating = ratingSystem.getTotalRating(game.away_team_id);

      return {
        id: game.id,
        start_date: game.start_date,
        status,
        home_team: {
          id: game.home_team_id,
          name: game.home_team_name,
          conference: homeConf,
          rating: homeTotalRating,
          games_played: homeRatingData.games,
        },
        away_team: {
          id: game.away_team_id,
          name: game.away_team_name,
          conference: awayConf,
          rating: awayTotalRating,
          games_played: awayRatingData.games,
        },
        market_spread: marketSpread,
        model_spread: modelSpread,
        edge_points: analysis.absEdge,
        spread_size: analysis.spreadSize,
        recommended_side: analysis.qualifies ? analysis.side : null,
        is_underdog_bet: analysis.isUnderdog,
        bet_strategy: analysis.strategy,
        qualifies_for_bet: prediction?.qualifies_for_bet || analysis.qualifies,
        qualification_reason: prediction?.qualification_reason || analysis.qualificationReason || analysis.reason,
        home_score: game.home_score,
        away_score: game.away_score,
        bet_result: prediction?.bet_result || null,
      };
    });

    // Filter based on requested view
    let filteredResult = result;
    if (filter === 'upcoming') {
      // For upcoming: Only show games WITH odds, sorted by start time
      // Games with qualifying bets first, then other games with odds
      const withOdds = result.filter(g => g.market_spread !== null);
      const qualifying = withOdds.filter(g => g.qualifies_for_bet);
      const nonQualifying = withOdds.filter(g => !g.qualifies_for_bet);
      filteredResult = [...qualifying, ...nonQualifying].slice(0, limit);
    } else if (filter === 'bets') {
      filteredResult = result.filter(g => g.qualifies_for_bet);
    } else if (filter === 'completed') {
      // Only show qualifying bets that have been graded
      filteredResult = result.filter(g => g.qualifies_for_bet && g.bet_result !== null);
    }

    // Get season stats
    const { data: stats } = await supabase
      .from('cbb_game_predictions')
      .select('bet_result, qualifies_for_bet')
      .eq('qualifies_for_bet', true)
      .not('bet_result', 'is', null);

    const wins = stats?.filter(s => s.bet_result === 'win').length || 0;
    const losses = stats?.filter(s => s.bet_result === 'loss').length || 0;
    const totalBets = wins + losses;
    const profitUnits = (wins * 0.91) - losses;
    const roi = totalBets > 0 ? profitUnits / totalBets : 0;

    return NextResponse.json({
      games: filteredResult,
      season,
      stats: {
        total_bets: totalBets,
        wins,
        losses,
        win_rate: totalBets > 0 ? wins / totalBets : 0,
        profit_units: profitUnits,
        roi,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
