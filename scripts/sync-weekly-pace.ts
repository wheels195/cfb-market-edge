/**
 * Sync weekly pace (plays per game) from CFBD advanced game stats
 *
 * Updates team_stats_snapshots with:
 * - total_plays: cumulative offensive plays through this week
 * - plays_per_game: pace = total_plays / games_played
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

interface GameAdvancedStats {
  gameId: number;
  season: number;
  week: number;
  team: string;
  opponent: string;
  offense?: {
    plays?: number;
    drives?: number;
  };
}

async function fetchAdvancedGameStats(season: number): Promise<GameAdvancedStats[]> {
  console.log(`  Fetching advanced game stats for ${season}...`);

  const results: GameAdvancedStats[] = [];

  // Fetch week by week (API may have limits)
  for (let week = 1; week <= 16; week++) {
    try {
      const url = `https://api.collegefootballdata.com/stats/game/advanced?year=${season}&week=${week}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });

      if (!res.ok) {
        if (res.status === 404) continue; // Week doesn't exist
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      for (const game of data) {
        if (game.team && game.offense?.plays) {
          results.push({
            gameId: game.gameId,
            season: game.season || season,
            week: game.week || week,
            team: game.team.toLowerCase(),
            opponent: game.opponent?.toLowerCase() || '',
            offense: game.offense,
          });
        }
      }
    } catch (err) {
      console.log(`    Week ${week}: ${err}`);
    }
  }

  console.log(`  Fetched ${results.length} team-game records`);
  return results;
}

async function buildTeamNameToId(): Promise<Map<string, string>> {
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

  // Fetch CFBD teams for name mapping
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();

  const cfbdIdToName = new Map<number, string>();
  for (const t of cfbdTeams) {
    cfbdIdToName.set(t.id, t.school.toLowerCase());
  }

  const cfbdIdToOurId = new Map<number, string>();
  for (const team of ourTeams || []) {
    const cfbdId = parseInt(team.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;

    const existingId = cfbdIdToOurId.get(cfbdId);
    if (!existingId || (eventTeamIds.has(team.id) && !eventTeamIds.has(existingId))) {
      cfbdIdToOurId.set(cfbdId, team.id);
    }
  }

  const nameToId = new Map<string, string>();
  for (const [cfbdId, ourId] of cfbdIdToOurId) {
    const name = cfbdIdToName.get(cfbdId);
    if (name) nameToId.set(name, ourId);
  }

  console.log(`  Mapped ${nameToId.size} team names`);
  return nameToId;
}

async function syncPaceForSeason(season: number, teamNameToId: Map<string, string>) {
  console.log(`\nSyncing pace for ${season}...`);

  const gameStats = await fetchAdvancedGameStats(season);
  if (gameStats.length === 0) return;

  // Group by team
  const byTeam = new Map<string, GameAdvancedStats[]>();
  for (const g of gameStats) {
    const teamId = teamNameToId.get(g.team);
    if (!teamId) continue;

    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId)!.push(g);
  }

  // Calculate cumulative plays per game for each week
  const updates: Array<{ team_id: string; season: number; week: number; total_plays: number; plays_per_game: number }> = [];

  for (const [teamId, games] of byTeam) {
    games.sort((a, b) => a.week - b.week);

    let cumPlays = 0;
    let gamesPlayed = 0;
    let gameIdx = 0;
    const maxWeek = Math.max(...games.map(g => g.week));

    for (let week = 1; week <= maxWeek; week++) {
      while (gameIdx < games.length && games[gameIdx].week === week) {
        cumPlays += games[gameIdx].offense?.plays || 0;
        gamesPlayed++;
        gameIdx++;
      }

      if (gamesPlayed === 0) continue;

      updates.push({
        team_id: teamId,
        season,
        week,
        total_plays: cumPlays,
        plays_per_game: cumPlays / gamesPlayed,
      });
    }
  }

  console.log(`  Generated ${updates.length} pace updates`);

  // Update existing rows
  let updated = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('team_stats_snapshots')
      .update({
        total_plays: u.total_plays,
        plays_per_game: u.plays_per_game,
      })
      .eq('team_id', u.team_id)
      .eq('season', u.season)
      .eq('week', u.week);

    if (!error) updated++;
  }

  console.log(`  Updated ${updated} rows with pace data`);
}

async function main() {
  console.log('=== Syncing Weekly Pace Data ===\n');

  console.log('Building team mappings...');
  const teamNameToId = await buildTeamNameToId();

  for (const season of [2022, 2023, 2024]) {
    await syncPaceForSeason(season, teamNameToId);
  }

  // Sample
  const { data: sample } = await supabase
    .from('team_stats_snapshots')
    .select('season, week, plays_per_game, teams:team_id(name)')
    .eq('season', 2024)
    .not('plays_per_game', 'is', null)
    .order('plays_per_game', { ascending: false })
    .limit(10);

  console.log('\n=== Sync Complete ===');
  console.log('\nTop 10 pace (2024):');
  for (const s of sample || []) {
    console.log(`  ${(s.teams as any)?.name}: ${(s.plays_per_game as number)?.toFixed(1)} plays/game (W${s.week})`);
  }
}

main().catch(console.error);
