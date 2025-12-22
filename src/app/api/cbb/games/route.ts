import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/client';
import { CbbEloSystem, analyzeCbbBet } from '@/lib/models/cbb-elo';

export const dynamic = 'force-dynamic';

interface CbbGame {
  id: string;
  start_date: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  home_team: {
    id: string;
    name: string;
    elo: number;
    games_played: number;
  };
  away_team: {
    id: string;
    name: string;
    elo: number;
    games_played: number;
  };
  market_spread: number | null;
  model_spread: number | null;
  edge_points: number | null;
  spread_size: number | null;
  recommended_side: 'home' | 'away' | null;
  is_underdog_bet: boolean;
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

    // Load Elo ratings
    const { data: eloData } = await supabase
      .from('cbb_elo_snapshots')
      .select('team_id, elo, games_played')
      .eq('season', season);

    const eloMap = new Map<string, { elo: number; games: number }>();
    for (const row of eloData || []) {
      eloMap.set(row.team_id, { elo: row.elo, games: row.games_played });
    }

    // Build query based on filter (D1 only - both team IDs must exist)
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
      query = query
        .eq('home_score', 0)
        .eq('away_score', 0)
        .gte('start_date', now.toISOString())
        .order('start_date', { ascending: true });
    } else if (filter === 'completed') {
      // Completed games have actual scores (not 0-0)
      query = query
        .or('home_score.neq.0,away_score.neq.0')
        .order('start_date', { ascending: false });
    } else if (filter === 'bets') {
      // Games with qualifying bets
      query = query
        .order('start_date', { ascending: false });
    }

    query = query.limit(limit);

    const { data: games, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform games
    const elo = new CbbEloSystem();
    for (const [teamId, data] of eloMap) {
      elo.setElo(teamId, data.elo, data.games);
    }

    const result: CbbGame[] = (games || []).map((game: any) => {
      const prediction = game.cbb_game_predictions?.[0];

      const homeEloData = eloMap.get(game.home_team_id) || { elo: 1500, games: 0 };
      const awayEloData = eloMap.get(game.away_team_id) || { elo: 1500, games: 0 };

      // Determine status
      let status: 'upcoming' | 'in_progress' | 'completed' = 'upcoming';
      if (game.home_score !== null) {
        status = 'completed';
      } else if (new Date(game.start_date) <= now) {
        status = 'in_progress';
      }

      // Calculate model spread if no prediction exists
      let modelSpread = prediction?.model_spread_home;
      if (modelSpread === undefined || modelSpread === null) {
        modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
      }

      const marketSpread = prediction?.market_spread_home ?? null;

      // Analyze bet if we have market spread
      let analysis = {
        qualifies: false,
        isUnderdog: false,
        absEdge: 0,
        spreadSize: 0,
        side: null as 'home' | 'away' | null,
        qualificationReason: null as string | null,
      };

      if (marketSpread !== null) {
        analysis = analyzeCbbBet(
          marketSpread,
          modelSpread,
          homeEloData.games,
          awayEloData.games
        );
      }

      return {
        id: game.id,
        start_date: game.start_date,
        status,
        home_team: {
          id: game.home_team_id,
          name: game.home_team_name,
          elo: homeEloData.elo,
          games_played: homeEloData.games,
        },
        away_team: {
          id: game.away_team_id,
          name: game.away_team_name,
          elo: awayEloData.elo,
          games_played: awayEloData.games,
        },
        market_spread: marketSpread,
        model_spread: modelSpread,
        edge_points: analysis.absEdge,
        spread_size: analysis.spreadSize,
        recommended_side: analysis.qualifies ? analysis.side : (analysis.side || null),
        is_underdog_bet: analysis.isUnderdog,
        qualifies_for_bet: prediction?.qualifies_for_bet || analysis.qualifies,
        qualification_reason: prediction?.qualification_reason || analysis.qualificationReason,
        home_score: game.home_score,
        away_score: game.away_score,
        bet_result: prediction?.bet_result || null,
      };
    });

    // Filter for bets if requested
    let filteredResult = result;
    if (filter === 'bets') {
      filteredResult = result.filter(g => g.qualifies_for_bet);
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
