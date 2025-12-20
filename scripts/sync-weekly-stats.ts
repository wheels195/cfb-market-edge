/**
 * Sync weekly team stats snapshots from CFBD game-level PPA
 *
 * For each season-week, aggregates game PPA data cumulatively:
 * - Week N snapshot = cumulative average of games through week N
 * - Used for walk-forward backtesting (use week N-1 for games in week N)
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

// Map CFBD team names to our team UUIDs (uses cfbd_team_id)
async function buildTeamNameToId(): Promise<Map<string, string>> {
  // Get teams with cfbd_team_id that are used in events
  const { data: eventSample } = await supabase
    .from('events')
    .select('home_team_id, away_team_id')
    .limit(5000);

  const eventTeamIds = new Set<string>();
  for (const e of eventSample || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  const { data: ourTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  // Get CFBD teams to map names to IDs
  const cfbdTeams = await cfbd.getTeams();
  const cfbdIdToName = new Map<number, string>();
  for (const t of cfbdTeams) {
    cfbdIdToName.set(t.id, t.school.toLowerCase());
  }

  // Build cfbd_id -> our_team_id, preferring event team IDs
  const cfbdIdToOurId = new Map<number, string>();
  for (const team of ourTeams || []) {
    const cfbdId = parseInt(team.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;

    const existingId = cfbdIdToOurId.get(cfbdId);
    if (!existingId) {
      cfbdIdToOurId.set(cfbdId, team.id);
    } else if (eventTeamIds.has(team.id) && !eventTeamIds.has(existingId)) {
      cfbdIdToOurId.set(cfbdId, team.id);
    }
  }

  // Build cfbd_name -> our_team_id
  const nameToId = new Map<string, string>();
  for (const [cfbdId, ourId] of cfbdIdToOurId) {
    const name = cfbdIdToName.get(cfbdId);
    if (name) {
      nameToId.set(name, ourId);
    }
  }

  console.log(`  Mapped ${nameToId.size} team names to IDs`);
  return nameToId;
}

interface GamePPAData {
  team: string;
  week: number;
  offPPA: number;
  defPPA: number;
}

async function fetchGamePPA(season: number): Promise<GamePPAData[]> {
  console.log(`  Fetching game PPA for ${season}...`);

  // CFBD returns one record per team-game (not nested teams array)
  const games = await cfbd.getGamePPA(season) as Array<{
    gameId: number;
    season: number;
    week: number;
    team: string;
    offense?: { overall?: number };
    defense?: { overall?: number };
  }>;

  const results: GamePPAData[] = [];

  for (const game of games) {
    if (!game.team || game.offense?.overall === undefined) continue;

    results.push({
      team: game.team.toLowerCase(),
      week: game.week,
      offPPA: game.offense?.overall || 0,
      defPPA: game.defense?.overall || 0,
    });
  }

  console.log(`  Fetched ${results.length} team-game records`);
  return results;
}

interface WeeklySnapshot {
  teamId: string;
  season: number;
  week: number;
  gamesPlayed: number;
  offPPA: number;
  defPPA: number;
}

function aggregateToWeekly(
  gamePPA: GamePPAData[],
  teamNameToId: Map<string, string>,
  season: number,
  maxWeek: number
): WeeklySnapshot[] {
  // Group by team
  const byTeam = new Map<string, GamePPAData[]>();
  for (const g of gamePPA) {
    const teamId = teamNameToId.get(g.team);
    if (!teamId) continue;

    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, []);
    }
    byTeam.get(teamId)!.push(g);
  }

  const snapshots: WeeklySnapshot[] = [];

  for (const [teamId, games] of byTeam) {
    // Sort by week
    games.sort((a, b) => a.week - b.week);

    // Create cumulative snapshots for each week
    let cumOffPPA = 0;
    let cumDefPPA = 0;
    let gamesPlayed = 0;

    let gameIdx = 0;

    for (let week = 1; week <= maxWeek; week++) {
      // Add all games from this week
      while (gameIdx < games.length && games[gameIdx].week === week) {
        const g = games[gameIdx];
        cumOffPPA += g.offPPA;
        cumDefPPA += g.defPPA;
        gamesPlayed++;
        gameIdx++;
      }

      if (gamesPlayed === 0) continue;

      snapshots.push({
        teamId,
        season,
        week,
        gamesPlayed,
        offPPA: cumOffPPA / gamesPlayed,
        defPPA: cumDefPPA / gamesPlayed,
      });
    }
  }

  return snapshots;
}

async function syncSeasonStats(season: number, teamNameToId: Map<string, string>) {
  console.log(`\nSyncing ${season}...`);

  // Fetch game-level PPA
  const gamePPA = await fetchGamePPA(season);

  if (gamePPA.length === 0) {
    console.log(`  No game PPA data for ${season}`);
    return { inserted: 0, skipped: 0 };
  }

  // Find max week
  const maxWeek = Math.max(...gamePPA.map(g => g.week));
  console.log(`  Max week: ${maxWeek}`);

  // Aggregate to weekly snapshots
  const snapshots = aggregateToWeekly(gamePPA, teamNameToId, season, maxWeek);
  console.log(`  Generated ${snapshots.length} weekly snapshots`);

  // Upsert to database
  const records = snapshots.map(s => ({
    team_id: s.teamId,
    season: s.season,
    week: s.week,
    games_played: s.gamesPlayed,
    off_ppa: s.offPPA,
    def_ppa: s.defPPA,
    source: 'cfbd_ppa',
  }));

  // Upsert in batches
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error, count } = await supabase
      .from('team_stats_snapshots')
      .upsert(batch, {
        onConflict: 'team_id,season,week',
        count: 'exact',
      });

    if (error) {
      console.error(`  Error upserting batch: ${error.message}`);
      return { inserted, skipped: records.length - i };
    }

    inserted += count || batch.length;
  }

  console.log(`  Upserted ${inserted} records`);
  return { inserted, skipped: 0 };
}

async function main() {
  console.log('=== Syncing Weekly Team Stats ===\n');

  // Build team name mapping
  console.log('Building team mappings...');
  const teamNameToId = await buildTeamNameToId();

  // Sync seasons 2022-2024 (matching backtest period)
  const seasons = [2022, 2023, 2024];
  let totalInserted = 0;

  for (const season of seasons) {
    const result = await syncSeasonStats(season, teamNameToId);
    totalInserted += result.inserted;
  }

  console.log(`\n=== Sync Complete ===`);
  console.log(`Total records upserted: ${totalInserted}`);

  // Sample data
  const { data: sample } = await supabase
    .from('team_stats_snapshots')
    .select(`
      season,
      week,
      games_played,
      off_ppa,
      def_ppa,
      teams:team_id (name)
    `)
    .eq('season', 2024)
    .in('week', [3, 8, 12])
    .order('off_ppa', { ascending: false })
    .limit(9);

  if (sample && sample.length > 0) {
    console.log('\nSample (2024, weeks 3/8/12, top off_ppa):');
    for (const s of sample) {
      const teamName = (s.teams as any)?.name || 'Unknown';
      console.log(`  ${s.season} W${s.week}: ${teamName} - ${s.games_played}G, off_ppa=${(s.off_ppa as number)?.toFixed(3)}, def_ppa=${(s.def_ppa as number)?.toFixed(3)}`);
    }
  }
}

main().catch(console.error);
