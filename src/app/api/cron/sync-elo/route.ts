import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '@/lib/api/cfbd-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

/**
 * Weekly Elo Sync - Pulls latest CFBD Elo ratings into team_elo_snapshots
 * Should run after games complete (e.g., Monday morning)
 */
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[SyncElo] Starting weekly Elo sync...');

    // Determine current season
    const now = new Date();
    const season = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    // Build team name to ID mapping
    const cfbdNameToTeamId = await buildTeamMapping();
    console.log(`[SyncElo] Mapped ${cfbdNameToTeamId.size} CFBD teams`);

    // Sync latest weeks for current season
    const result = await syncEloForSeason(season, cfbdNameToTeamId);

    return NextResponse.json({
      success: true,
      season,
      ...result,
    });
  } catch (error) {
    console.error('[SyncElo] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function buildTeamMapping(): Promise<Map<string, string>> {
  // Get our teams with cfbd_team_id
  const { data: ourTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  // Get team IDs used in events (from Odds API)
  const { data: eventSample } = await supabase
    .from('events')
    .select('home_team_id, away_team_id')
    .limit(5000);

  const eventTeamIds = new Set<string>();
  for (const e of eventSample || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  // Build cfbd_id -> our_team_id, preferring teams used in events
  const cfbdIdToOurId = new Map<number, string>();
  for (const team of ourTeams || []) {
    const cfbdId = parseInt(team.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;

    const existingId = cfbdIdToOurId.get(cfbdId);
    if (!existingId || (eventTeamIds.has(team.id) && !eventTeamIds.has(existingId))) {
      cfbdIdToOurId.set(cfbdId, team.id);
    }
  }

  // Get CFBD team list
  const cfbdTeams = await cfbd.getTeams();

  // Build cfbd_name -> our_team_id
  const cfbdNameToOurId = new Map<string, string>();
  for (const cfbdTeam of cfbdTeams) {
    const ourId = cfbdIdToOurId.get(cfbdTeam.id);
    if (ourId) {
      cfbdNameToOurId.set(cfbdTeam.school.toLowerCase(), ourId);
    }
  }

  return cfbdNameToOurId;
}

async function syncEloForSeason(
  season: number,
  cfbdNameToTeamId: Map<string, string>
): Promise<{ weeksProcessed: number; teamsUpdated: number; errors: string[] }> {
  const errors: string[] = [];
  let weeksProcessed = 0;
  let teamsUpdated = 0;

  // Sync weeks 0-16 (regular season + bowls)
  const weeks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  for (const week of weeks) {
    try {
      const eloData = await cfbd.getEloRatings(season, undefined, week);

      if (eloData.length === 0) continue;

      const records: Array<{
        team_id: string;
        season: number;
        week: number;
        elo: number;
        source: string;
      }> = [];

      for (const entry of eloData) {
        const teamId = cfbdNameToTeamId.get(entry.team.toLowerCase());
        if (!teamId) continue;

        records.push({
          team_id: teamId,
          season,
          week,
          elo: entry.elo,
          source: 'cfbd',
        });
      }

      if (records.length === 0) continue;

      const { error, count } = await supabase
        .from('team_elo_snapshots')
        .upsert(records, {
          onConflict: 'team_id,season,week',
          count: 'exact',
        });

      if (error) {
        errors.push(`Week ${week}: ${error.message}`);
      } else {
        weeksProcessed++;
        teamsUpdated += count || 0;
        console.log(`[SyncElo] Week ${week}: ${records.length} teams synced`);
      }
    } catch (err) {
      // Skip weeks that don't exist in API
      if (!String(err).includes('404')) {
        errors.push(`Week ${week}: ${err}`);
      }
    }
  }

  console.log(`[SyncElo] Season ${season}: ${weeksProcessed} weeks, ${teamsUpdated} updates`);
  return { weeksProcessed, teamsUpdated, errors };
}
