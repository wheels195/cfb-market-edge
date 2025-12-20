/**
 * Sync CFBD weekly Elo snapshots to team_elo_snapshots table
 *
 * Semantics:
 * - Week 0 = preseason Elo (rating BEFORE any games)
 * - Week N = rating AFTER week N games
 * - For a game in week N, use week N-1 snapshot (the "entering" rating)
 *
 * Fix: Match by cfbd_team_id instead of exact name
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

// Build a mapping from CFBD team name (e.g., "Oregon") to our team UUID
// Uses cfbd_team_id as the link
// IMPORTANT: Prefer team IDs that are actually used in events (from Odds API)
async function buildCFBDNameToTeamId(): Promise<Map<string, string>> {
  // Get our teams with cfbd_team_id
  const { data: ourTeams, error } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  if (error) throw new Error(`Failed to fetch teams: ${error.message}`);

  // Get team IDs that are actually used in events
  const { data: eventSample } = await supabase
    .from('events')
    .select('home_team_id, away_team_id')
    .limit(5000);

  const eventTeamIds = new Set<string>();
  for (const e of eventSample || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }
  console.log(`  Found ${eventTeamIds.size} unique team IDs used in events`);

  // Build cfbd_id (as number) -> our_team_id mapping
  // Prefer team IDs that are used in events (Odds API teams)
  const cfbdIdToOurId = new Map<number, string>();
  for (const team of ourTeams || []) {
    const cfbdId = parseInt(team.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;

    const existingId = cfbdIdToOurId.get(cfbdId);
    if (!existingId) {
      // First entry for this cfbd_id
      cfbdIdToOurId.set(cfbdId, team.id);
    } else if (eventTeamIds.has(team.id) && !eventTeamIds.has(existingId)) {
      // Current team is used in events but existing one is not - prefer current
      cfbdIdToOurId.set(cfbdId, team.id);
    }
    // Otherwise keep the existing one
  }

  console.log(`  Loaded ${cfbdIdToOurId.size} cfbd_team_id mappings`);

  // Get CFBD team list to map team names to cfbd IDs
  const cfbdTeams = await cfbd.getTeams();
  console.log(`  Fetched ${cfbdTeams.length} FBS teams from CFBD`);

  // Build cfbd_name -> our_team_id
  const cfbdNameToOurId = new Map<string, string>();
  let matched = 0;
  let unmatched = 0;

  for (const cfbdTeam of cfbdTeams) {
    const ourId = cfbdIdToOurId.get(cfbdTeam.id);
    if (ourId) {
      cfbdNameToOurId.set(cfbdTeam.school.toLowerCase(), ourId);
      matched++;
    } else {
      unmatched++;
    }
  }

  console.log(`  Matched: ${matched} FBS teams, Unmatched: ${unmatched}`);

  return cfbdNameToOurId;
}

async function syncEloForSeason(season: number, cfbdNameToTeamId: Map<string, string>) {
  console.log(`\nSyncing Elo for ${season}...`);

  // Regular season weeks 0-15, plus some buffer
  const weeks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  let totalInserted = 0;
  let totalSkipped = 0;
  const skippedTeams = new Set<string>();

  for (const week of weeks) {
    try {
      const eloData = await cfbd.getEloRatings(season, undefined, week);

      if (eloData.length === 0) {
        // No data for this week, skip
        continue;
      }

      const records: Array<{
        team_id: string;
        season: number;
        week: number;
        elo: number;
        source: string;
      }> = [];

      for (const entry of eloData) {
        // Find team_id from CFBD name mapping
        const teamId = cfbdNameToTeamId.get(entry.team.toLowerCase());

        if (!teamId) {
          totalSkipped++;
          skippedTeams.add(entry.team);
          continue;
        }

        records.push({
          team_id: teamId,
          season,
          week,
          elo: entry.elo,
          source: 'cfbd',
        });
      }

      if (records.length === 0) continue;

      // Upsert records
      const { error, count } = await supabase
        .from('team_elo_snapshots')
        .upsert(records, {
          onConflict: 'team_id,season,week',
          count: 'exact',
        });

      if (error) {
        console.error(`  Week ${week}: Error - ${error.message}`);
      } else {
        console.log(`  Week ${week}: ${records.length} teams, ${count} upserted`);
        totalInserted += count || 0;
      }
    } catch (err) {
      // Week might not exist in the API
      if (String(err).includes('404')) {
        // Expected for weeks that don't exist
        continue;
      }
      console.error(`  Week ${week}: ${err}`);
    }
  }

  console.log(`  Season ${season} complete: ${totalInserted} records, ${totalSkipped} skipped`);
  if (skippedTeams.size > 0 && skippedTeams.size <= 10) {
    console.log(`  Skipped teams: ${[...skippedTeams].join(', ')}`);
  } else if (skippedTeams.size > 10) {
    console.log(`  Skipped ${skippedTeams.size} unique teams (too many to list)`);
  }
}

async function syncAllSeasons() {
  console.log('=== Syncing CFBD Elo Snapshots ===\n');

  // Build mapping from CFBD team names to our team IDs
  console.log('Building team mappings...');
  const cfbdNameToTeamId = await buildCFBDNameToTeamId();
  console.log(`Mapping complete: ${cfbdNameToTeamId.size} CFBD names mapped`);

  // Sync 2022-2025 seasons for backtesting
  const seasons = [2022, 2023, 2024, 2025];

  for (const season of seasons) {
    await syncEloForSeason(season, cfbdNameToTeamId);
  }

  // Summary
  console.log('\n=== Sync Complete ===');

  const { count } = await supabase
    .from('team_elo_snapshots')
    .select('*', { count: 'exact', head: true });

  console.log(`Total Elo snapshots in database: ${count}`);

  // Sample data
  const { data: sample } = await supabase
    .from('team_elo_snapshots')
    .select(`
      season,
      week,
      elo,
      teams:team_id (name)
    `)
    .eq('season', 2024)
    .in('week', [0, 5, 10])
    .limit(9)
    .order('week')
    .order('elo', { ascending: false });

  if (sample) {
    console.log('\nSample (2024, weeks 0/5/10, top Elo):');
    for (const s of sample) {
      const teamName = (s.teams as any)?.name || 'Unknown';
      console.log(`  ${s.season} W${s.week}: ${teamName} = ${s.elo}`);
    }
  }
}

syncAllSeasons().catch(console.error);
