import { supabase } from '@/lib/db/client';

const CFBD_API_KEY = process.env.CFBD_API_KEY;
const BASE_URL = 'https://apinext.collegefootballdata.com';

interface CFBDRankingTeam {
  rank: number;
  teamId: number;
  school: string;
  conference: string;
  firstPlaceVotes: number | null;
  points: number | null;
}

interface CFBDPoll {
  poll: string;
  ranks: CFBDRankingTeam[];
}

interface CFBDRankingsResponse {
  season: number;
  seasonType: string;
  week: number;
  polls: CFBDPoll[];
}

export interface SyncRankingsResult {
  success: boolean;
  rankingsUpdated: number;
  errors: string[];
}

/**
 * Sync team rankings from CFBD API
 * Fetches AP Top 25 and Coaches Poll for the current season
 */
export async function syncRankings(): Promise<SyncRankingsResult> {
  const result: SyncRankingsResult = {
    success: false,
    rankingsUpdated: 0,
    errors: [],
  };

  if (!CFBD_API_KEY) {
    result.errors.push('CFBD_API_KEY not configured');
    return result;
  }

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    // College football season is Aug-Jan, so use current year if Aug-Dec, previous year if Jan
    const season = currentMonth >= 7 ? currentYear : currentYear - 1;

    console.log(`[SyncRankings] Fetching rankings for ${season} season`);

    // Fetch both regular and postseason rankings
    const seasonTypes = ['regular', 'postseason'];

    for (const seasonType of seasonTypes) {
      const url = `${BASE_URL}/rankings?year=${season}&seasonType=${seasonType}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${CFBD_API_KEY}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`[SyncRankings] No ${seasonType} rankings available`);
        continue;
      }

      const data: CFBDRankingsResponse[] = await response.json();

      if (!data || data.length === 0) {
        continue;
      }

      // Get the most recent week's rankings
      const latestRankings = data[data.length - 1];
      console.log(`[SyncRankings] Processing ${seasonType} week ${latestRankings.week}`);

      // Get team mapping (cfbd_team_id -> our team_id)
      const { data: teams } = await supabase
        .from('teams')
        .select('id, cfbd_team_id');

      const teamIdMap = new Map<string, string>();
      for (const team of teams || []) {
        if (team.cfbd_team_id) {
          teamIdMap.set(team.cfbd_team_id, team.id);
        }
      }

      // Process AP Top 25 and Coaches Poll
      const pollsToSync = ['AP Top 25', 'Coaches Poll'];

      for (const poll of latestRankings.polls) {
        if (!pollsToSync.includes(poll.poll)) continue;

        console.log(`[SyncRankings] Processing ${poll.poll}: ${poll.ranks.length} teams`);

        for (const ranking of poll.ranks) {
          const teamId = teamIdMap.get(ranking.teamId.toString());

          const { error } = await supabase
            .from('team_rankings')
            .upsert({
              team_id: teamId || null,
              cfbd_team_id: ranking.teamId,
              season: latestRankings.season,
              week: latestRankings.week,
              season_type: latestRankings.seasonType,
              poll: poll.poll,
              rank: ranking.rank,
              points: ranking.points,
              first_place_votes: ranking.firstPlaceVotes,
              synced_at: new Date().toISOString(),
            }, {
              onConflict: 'cfbd_team_id,season,week,season_type,poll',
            });

          if (error) {
            result.errors.push(`Failed to upsert ${ranking.school}: ${error.message}`);
          } else {
            result.rankingsUpdated++;
          }
        }
      }
    }

    result.success = result.errors.length === 0;
    console.log(`[SyncRankings] Complete: ${result.rankingsUpdated} rankings updated`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(message);
    console.error(`[SyncRankings] Error: ${message}`);
  }

  return result;
}

/**
 * Get current AP ranking for a team
 */
export async function getTeamRanking(teamId: string): Promise<number | null> {
  const { data } = await supabase
    .from('team_rankings')
    .select('rank')
    .eq('team_id', teamId)
    .eq('poll', 'AP Top 25')
    .order('season', { ascending: false })
    .order('week', { ascending: false })
    .limit(1)
    .single();

  return data?.rank || null;
}
