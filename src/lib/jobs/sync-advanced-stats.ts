/**
 * Sync Advanced Stats from CollegeFootballData API
 *
 * Fetches pace, success rate, explosiveness, havoc, and other
 * advanced metrics that power the enhanced model.
 */

import { getCFBDApiClient } from '@/lib/api/cfbd-api';
import { supabase } from '@/lib/db/client';

interface AdvancedStatRow {
  team_id: string;
  season: number;
  week: number | null;
  plays_per_game: number | null;
  seconds_per_play: number | null;
  pace_rank: number | null;
  off_success_rate: number | null;
  off_explosiveness: number | null;
  off_ppa: number | null;
  off_passing_ppa: number | null;
  off_rushing_ppa: number | null;
  def_success_rate: number | null;
  def_explosiveness: number | null;
  def_ppa: number | null;
  def_havoc_rate: number | null;
  def_havoc_front_seven: number | null;
  def_havoc_db: number | null;
  standard_downs_success_rate: number | null;
  passing_downs_success_rate: number | null;
  red_zone_success_rate: number | null;
}

export async function syncAdvancedStats(season?: number): Promise<{
  success: boolean;
  teamsUpdated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let teamsUpdated = 0;

  try {
    const cfbd = getCFBDApiClient();
    const currentSeason = season || cfbd.getCurrentSeason();

    // Fetch advanced stats from CFBD
    const advancedStats = await cfbd.getAdvancedTeamStats(currentSeason, undefined, true);

    if (!advancedStats || advancedStats.length === 0) {
      return { success: true, teamsUpdated: 0, errors: ['No advanced stats available'] };
    }

    // Get team ID mapping
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name');

    if (!teams) {
      return { success: false, teamsUpdated: 0, errors: ['Failed to fetch teams'] };
    }

    const teamMap = new Map(teams.map(t => [t.name.toLowerCase(), t.id]));

    // Calculate pace rankings
    const paceData = advancedStats
      .map(s => ({
        team: s.team,
        playsPerGame: s.offense.plays / Math.max(1, s.offense.drives),
      }))
      .sort((a, b) => b.playsPerGame - a.playsPerGame);

    const paceRanks = new Map(paceData.map((p, i) => [p.team.toLowerCase(), i + 1]));

    for (const stat of advancedStats) {
      const teamId = teamMap.get(stat.team.toLowerCase());
      if (!teamId) {
        // Try alternate matching
        const altTeamId = findTeamId(stat.team, teamMap);
        if (!altTeamId) {
          continue;
        }
      }

      const finalTeamId = teamId || findTeamId(stat.team, teamMap);
      if (!finalTeamId) continue;

      const row: AdvancedStatRow = {
        team_id: finalTeamId,
        season: currentSeason,
        week: null, // Season aggregate
        plays_per_game: stat.offense.plays / Math.max(1, stat.offense.drives),
        seconds_per_play: null, // Not directly available
        pace_rank: paceRanks.get(stat.team.toLowerCase()) || null,
        off_success_rate: stat.offense.successRate,
        off_explosiveness: stat.offense.explosiveness,
        off_ppa: stat.offense.ppa,
        off_passing_ppa: stat.offense.passing?.ppa || null,
        off_rushing_ppa: stat.offense.rushing?.ppa || null,
        def_success_rate: stat.defense.successRate,
        def_explosiveness: stat.defense.explosiveness,
        def_ppa: stat.defense.ppa,
        def_havoc_rate: stat.defense.havoc?.total || null,
        def_havoc_front_seven: stat.defense.havoc?.frontSeven || null,
        def_havoc_db: stat.defense.havoc?.db || null,
        standard_downs_success_rate: stat.offense.standardDowns?.successRate || null,
        passing_downs_success_rate: stat.offense.passingDowns?.successRate || null,
        red_zone_success_rate: null, // Would need play-by-play data
      };

      const { error } = await supabase
        .from('team_advanced_stats')
        .upsert(row, {
          onConflict: 'team_id,season,week',
        });

      if (error) {
        errors.push(`Failed to upsert stats for ${stat.team}: ${error.message}`);
      } else {
        teamsUpdated++;
      }
    }

    return { success: true, teamsUpdated, errors };
  } catch (err) {
    errors.push(`Sync failed: ${err}`);
    return { success: false, teamsUpdated: 0, errors };
  }
}

function findTeamId(teamName: string, teamMap: Map<string, string>): string | undefined {
  const normalized = teamName.toLowerCase();

  // Direct match
  if (teamMap.has(normalized)) {
    return teamMap.get(normalized);
  }

  // Common variations
  const variations: Record<string, string[]> = {
    'ole miss': ['mississippi'],
    'miami': ['miami (fl)', 'miami fl'],
    'miami (oh)': ['miami oh', 'miami ohio'],
    'lsu': ['louisiana state'],
    'usc': ['southern california'],
    'ucf': ['central florida'],
    'smu': ['southern methodist'],
    'tcu': ['texas christian'],
    'utep': ['texas el paso'],
    'utsa': ['texas san antonio'],
    'unlv': ['nevada las vegas'],
    'uab': ['alabama birmingham'],
    'fiu': ['florida international'],
    'fau': ['florida atlantic'],
    'unc': ['north carolina'],
    'nc state': ['north carolina state'],
  };

  // Check variations
  for (const [key, alts] of Object.entries(variations)) {
    if (normalized === key || alts.includes(normalized)) {
      for (const alt of [key, ...alts]) {
        if (teamMap.has(alt)) {
          return teamMap.get(alt);
        }
      }
    }
  }

  // Partial match
  for (const [name, id] of teamMap) {
    if (name.includes(normalized) || normalized.includes(name)) {
      return id;
    }
  }

  return undefined;
}

/**
 * Get pace adjustment for totals model
 * Returns adjustment in points based on team pace vs average
 */
export async function getPaceAdjustment(
  homeTeamId: string,
  awayTeamId: string,
  season: number
): Promise<{
  homeAdjustment: number;
  awayAdjustment: number;
  combinedPaceAdjustment: number;
  homePaceRank: number | null;
  awayPaceRank: number | null;
  confidence: 'high' | 'medium' | 'low';
}> {
  const { data: homeStats } = await supabase
    .from('team_advanced_stats')
    .select('*')
    .eq('team_id', homeTeamId)
    .eq('season', season)
    .is('week', null)
    .single();

  const { data: awayStats } = await supabase
    .from('team_advanced_stats')
    .select('*')
    .eq('team_id', awayTeamId)
    .eq('season', season)
    .is('week', null)
    .single();

  // Default: no adjustment
  if (!homeStats && !awayStats) {
    return {
      homeAdjustment: 0,
      awayAdjustment: 0,
      combinedPaceAdjustment: 0,
      homePaceRank: null,
      awayPaceRank: null,
      confidence: 'low',
    };
  }

  // FBS average is ~70 plays per game
  // Fast teams: 75+ plays/game
  // Slow teams: <65 plays/game
  const FBS_AVG_PLAYS = 70;
  const POINTS_PER_PLAY = 0.4; // Rough average

  const homePlays = homeStats?.plays_per_game || FBS_AVG_PLAYS;
  const awayPlays = awayStats?.plays_per_game || FBS_AVG_PLAYS;

  // Pace adjustment = deviation from average * points per play
  const homeDeviation = homePlays - FBS_AVG_PLAYS;
  const awayDeviation = awayPlays - FBS_AVG_PLAYS;

  // Combined effect (both teams contribute to game pace)
  const homeAdjustment = (homeDeviation * POINTS_PER_PLAY) / 2;
  const awayAdjustment = (awayDeviation * POINTS_PER_PLAY) / 2;
  const combinedPaceAdjustment = homeAdjustment + awayAdjustment;

  const confidence = homeStats && awayStats ? 'high' : 'medium';

  return {
    homeAdjustment: Math.round(homeAdjustment * 10) / 10,
    awayAdjustment: Math.round(awayAdjustment * 10) / 10,
    combinedPaceAdjustment: Math.round(combinedPaceAdjustment * 10) / 10,
    homePaceRank: homeStats?.pace_rank || null,
    awayPaceRank: awayStats?.pace_rank || null,
    confidence,
  };
}

/**
 * Get efficiency matchup analysis
 */
export async function getEfficiencyMatchup(
  homeTeamId: string,
  awayTeamId: string,
  season: number
): Promise<{
  homeOffenseVsAwayDefense: number;
  awayOffenseVsHomeDefense: number;
  expectedHomePPA: number;
  expectedAwayPPA: number;
  homeSuccessRateEdge: number;
  awaySuccessRateEdge: number;
  homeHavocRisk: number;
  awayHavocRisk: number;
}> {
  const { data: homeStats } = await supabase
    .from('team_advanced_stats')
    .select('*')
    .eq('team_id', homeTeamId)
    .eq('season', season)
    .is('week', null)
    .single();

  const { data: awayStats } = await supabase
    .from('team_advanced_stats')
    .select('*')
    .eq('team_id', awayTeamId)
    .eq('season', season)
    .is('week', null)
    .single();

  // Defaults (FBS average)
  const defaultPPA = 0;
  const defaultSuccessRate = 0.40;
  const defaultHavoc = 0.08;

  const homeOffPPA = homeStats?.off_ppa || defaultPPA;
  const awayDefPPA = awayStats?.def_ppa || defaultPPA;
  const awayOffPPA = awayStats?.off_ppa || defaultPPA;
  const homeDefPPA = homeStats?.def_ppa || defaultPPA;

  // PPA matchup (offense PPA - opponent defense PPA)
  const homeOffenseVsAwayDefense = homeOffPPA - awayDefPPA;
  const awayOffenseVsHomeDefense = awayOffPPA - homeDefPPA;

  // Expected PPA (average of offense and matchup-adjusted)
  const expectedHomePPA = (homeOffPPA + homeOffenseVsAwayDefense) / 2;
  const expectedAwayPPA = (awayOffPPA + awayOffenseVsHomeDefense) / 2;

  // Success rate edge
  const homeSuccessRateEdge = (homeStats?.off_success_rate || defaultSuccessRate) -
    (awayStats?.def_success_rate || defaultSuccessRate);
  const awaySuccessRateEdge = (awayStats?.off_success_rate || defaultSuccessRate) -
    (homeStats?.def_success_rate || defaultSuccessRate);

  // Havoc risk (defense havoc rate indicates turnover/TFL potential)
  const homeHavocRisk = awayStats?.def_havoc_rate || defaultHavoc;
  const awayHavocRisk = homeStats?.def_havoc_rate || defaultHavoc;

  return {
    homeOffenseVsAwayDefense: Math.round(homeOffenseVsAwayDefense * 100) / 100,
    awayOffenseVsHomeDefense: Math.round(awayOffenseVsHomeDefense * 100) / 100,
    expectedHomePPA: Math.round(expectedHomePPA * 100) / 100,
    expectedAwayPPA: Math.round(expectedAwayPPA * 100) / 100,
    homeSuccessRateEdge: Math.round(homeSuccessRateEdge * 100) / 100,
    awaySuccessRateEdge: Math.round(awaySuccessRateEdge * 100) / 100,
    homeHavocRisk: Math.round(homeHavocRisk * 100) / 100,
    awayHavocRisk: Math.round(awayHavocRisk * 100) / 100,
  };
}
