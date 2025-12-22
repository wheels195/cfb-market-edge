/**
 * Materialize Edges - T-60 Ensemble Model
 *
 * Uses the validated T-60 ensemble model (Elo 50% + SP+ 30% + PPA 20%)
 * for spread projections. FBS games only.
 *
 * Backtest: 758 bets, 63.2% win, +20.6% ROI (2022-2024)
 */

import { supabase } from '@/lib/db/client';
import { MarketType } from '@/types/database';
import {
  computeT60Projection,
  qualifiesForBet,
  T60_EDGE_FILTER,
  T60_CALIBRATION,
} from '@/lib/models/t60-ensemble-v1';
import { isFBSGame } from '@/lib/fbs-teams';
import { getCanonicalTeamName } from '@/lib/team-aliases';

export interface MaterializeEdgesResult {
  edgesCreated: number;
  edgesUpdated: number;
  eventsProcessed: number;
  fbsFiltered: number;
  errors: string[];
}

// Pipeline window configuration
const WINDOW_CONFIG = {
  LOOKAHEAD_DAYS: 10,
};

/**
 * Get team ratings (Elo, SP+, PPA) for a team
 */
async function getTeamRatings(
  teamId: string,
  teamName: string,
  season: number
): Promise<{
  elo: number;
  spOverall: number;
  offPPA: number;
  defPPA: number;
} | null> {
  // Get Elo (latest week for season)
  const { data: eloData } = await supabase
    .from('team_elo_snapshots')
    .select('elo, week')
    .eq('team_id', teamId)
    .eq('season', season)
    .order('week', { ascending: false })
    .limit(1)
    .single();

  // Get SP+ and PPA
  const { data: ratingsData } = await supabase
    .from('advanced_team_ratings')
    .select('sp_overall, off_ppa, def_ppa')
    .eq('team_id', teamId)
    .eq('season', season)
    .single();

  // Need at least some ratings
  if (!eloData && !ratingsData) {
    return null;
  }

  return {
    elo: eloData?.elo || 1500,
    spOverall: ratingsData?.sp_overall || 0,
    offPPA: ratingsData?.off_ppa || 0,
    defPPA: ratingsData?.def_ppa || 0,
  };
}

/**
 * Get calibration tier based on edge size
 */
function getCalibrationTier(absEdge: number): {
  winProbability: number;
  expectedValue: number;
  confidenceTier: 'very-high' | 'high' | 'medium' | 'low' | 'skip';
  qualifies: boolean;
} {
  const qualifies = absEdge >= T60_EDGE_FILTER.MIN_EDGE && absEdge < T60_EDGE_FILTER.MAX_EDGE;

  if (absEdge < T60_EDGE_FILTER.MIN_EDGE) {
    return { winProbability: 49, expectedValue: -7, confidenceTier: 'low', qualifies: false };
  }

  if (absEdge >= T60_EDGE_FILTER.MAX_EDGE) {
    return { winProbability: 46, expectedValue: -11, confidenceTier: 'skip', qualifies: false };
  }

  // Within profitable range (2.5-5 pts)
  // Use overall calibration from backtest
  return {
    winProbability: Math.round(T60_CALIBRATION.overall.winRate * 100),
    expectedValue: Math.round(T60_CALIBRATION.overall.roi * 100),
    confidenceTier: absEdge < 3 ? 'very-high' : absEdge < 4 ? 'high' : 'medium',
    qualifies: true,
  };
}

/**
 * Materialize edges using T-60 ensemble model
 */
export async function materializeEdgesT60(): Promise<MaterializeEdgesResult> {
  const result: MaterializeEdgesResult = {
    edgesCreated: 0,
    edgesUpdated: 0,
    eventsProcessed: 0,
    fbsFiltered: 0,
    errors: [],
  };

  try {
    const now = new Date();
    const lookaheadEnd = new Date(now.getTime() + WINDOW_CONFIG.LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const currentSeason = now.getFullYear();

    console.log(`[T60] Processing events from ${now.toISOString()} to ${lookaheadEnd.toISOString()}`);

    // Get upcoming events
    const { data: events } = await supabase
      .from('events')
      .select(`
        id,
        commence_time,
        home_team_id,
        away_team_id,
        home_team:teams!events_home_team_id_fkey(id, name),
        away_team:teams!events_away_team_id_fkey(id, name)
      `)
      .eq('status', 'scheduled')
      .gt('commence_time', now.toISOString())
      .lt('commence_time', lookaheadEnd.toISOString());

    if (!events || events.length === 0) {
      console.log('[T60] No upcoming events found');
      return result;
    }

    console.log(`[T60] Found ${events.length} upcoming events`);

    // Get DraftKings sportsbook ID
    const { data: sportsbooks } = await supabase
      .from('sportsbooks')
      .select('id, key')
      .eq('key', 'draftkings')
      .single();

    if (!sportsbooks) {
      result.errors.push('DraftKings sportsbook not found');
      return result;
    }

    const dkId = sportsbooks.id;

    // Process each event
    for (const rawEvent of events) {
      try {
        // Normalize event (Supabase returns arrays for relations)
        const homeTeam = Array.isArray(rawEvent.home_team) ? rawEvent.home_team[0] : rawEvent.home_team;
        const awayTeam = Array.isArray(rawEvent.away_team) ? rawEvent.away_team[0] : rawEvent.away_team;

        if (!homeTeam?.name || !awayTeam?.name) {
          continue;
        }

        const homeTeamName = homeTeam.name;
        const awayTeamName = awayTeam.name;

        // FBS filter
        if (!isFBSGame(homeTeamName, awayTeamName)) {
          result.fbsFiltered++;
          continue;
        }

        result.eventsProcessed++;

        // Get latest DK spread
        const { data: latestTick } = await supabase
          .from('odds_ticks')
          .select('spread_points_home, price_american, captured_at')
          .eq('event_id', rawEvent.id)
          .eq('sportsbook_id', dkId)
          .eq('market_type', 'spread')
          .eq('side', 'home')
          .order('captured_at', { ascending: false })
          .limit(1)
          .single();

        if (!latestTick || latestTick.spread_points_home === null) {
          continue;
        }

        const marketSpread = latestTick.spread_points_home;

        // Get team ratings
        const homeRatings = await getTeamRatings(homeTeam.id, homeTeamName, currentSeason);
        const awayRatings = await getTeamRatings(awayTeam.id, awayTeamName, currentSeason);

        if (!homeRatings || !awayRatings) {
          result.errors.push(`Missing ratings for ${homeTeamName} vs ${awayTeamName}`);
          continue;
        }

        // Compute T-60 projection
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

        // Check if bet qualifies
        const betCheck = qualifiesForBet(marketSpread, projection.modelSpread, projection.modelDisagreement);

        // Get calibration data
        const calibration = getCalibrationTier(betCheck.absEdge);

        // Determine recommendation
        let recommendedSide: string;
        let recommendedBetLabel: string;

        if (betCheck.edge > 0) {
          recommendedSide = 'home';
          recommendedBetLabel = `${homeTeamName} ${marketSpread > 0 ? '+' : ''}${marketSpread}`;
        } else if (betCheck.edge < 0) {
          recommendedSide = 'away';
          recommendedBetLabel = `${awayTeamName} ${-marketSpread > 0 ? '+' : ''}${-marketSpread}`;
        } else {
          recommendedSide = 'none';
          recommendedBetLabel = 'No edge';
        }

        // Upsert edge
        const edgeData = {
          event_id: rawEvent.id,
          sportsbook_id: dkId,
          market_type: 'spread' as MarketType,
          as_of: latestTick.captured_at,
          market_spread_home: marketSpread,
          market_total_points: null,
          market_price_american: latestTick.price_american,
          model_spread_home: projection.modelSpread,
          model_total_points: null,
          edge_points: betCheck.edge,
          recommended_side: recommendedSide,
          recommended_bet_label: recommendedBetLabel,
          explain: {
            modelVersion: 't60-ensemble-v1',
            winProbability: calibration.winProbability,
            expectedValue: calibration.expectedValue,
            confidenceTier: calibration.confidenceTier,
            qualifies: betCheck.qualifies,
            reason: betCheck.qualifies
              ? `T-60 edge ${betCheck.absEdge.toFixed(1)} pts (validated +20.6% ROI)`
              : betCheck.reason,
            warnings: [] as string[],
            projection: {
              eloSpread: projection.eloSpread,
              spSpread: projection.spSpread,
              ppaSpread: projection.ppaSpread,
              modelSpread: projection.modelSpread,
              modelDisagreement: projection.modelDisagreement,
              passesConfidenceFilter: projection.passesConfidenceFilter,
            },
            ratings: {
              home: {
                team: homeTeamName,
                elo: homeRatings.elo,
                sp: homeRatings.spOverall,
                offPPA: homeRatings.offPPA,
                defPPA: homeRatings.defPPA,
              },
              away: {
                team: awayTeamName,
                elo: awayRatings.elo,
                sp: awayRatings.spOverall,
                offPPA: awayRatings.offPPA,
                defPPA: awayRatings.defPPA,
              },
            },
          },
        };

        // Check if edge exists
        const { data: existing } = await supabase
          .from('edges')
          .select('id')
          .eq('event_id', rawEvent.id)
          .eq('sportsbook_id', dkId)
          .eq('market_type', 'spread')
          .single();

        if (existing) {
          await supabase.from('edges').update(edgeData).eq('id', existing.id);
          result.edgesUpdated++;
        } else {
          await supabase.from('edges').insert(edgeData);
          result.edgesCreated++;
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${rawEvent.id}: ${message}`);
      }
    }

    console.log(`[T60] Processed ${result.eventsProcessed} FBS events`);
    console.log(`[T60] Filtered ${result.fbsFiltered} non-FBS events`);
    console.log(`[T60] Created ${result.edgesCreated}, updated ${result.edgesUpdated} edges`);

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Materialize failed: ${message}`);
  }

  return result;
}
