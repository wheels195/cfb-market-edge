/**
 * Rebuild All Snapshots
 *
 * Clears and re-syncs:
 * 1. team_elo_snapshots
 * 2. team_stats_snapshots (PPA + Pace)
 *
 * Run AFTER fix-team-uuids to ensure correct mappings
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const API_KEY = process.env.CFBD_API_KEY || '';

// Build mapping: CFBD team name (lowercase) -> our team UUID
// Only maps to team IDs that are used in events
async function buildCFBDNameToTeamId(): Promise<Map<string, string>> {
  console.log('Building CFBD name → team ID mapping...');

  // Get all teams with cfbd_team_id
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  // Get team IDs that are actually used in events
  const { data: homeEvents } = await supabase.from('events').select('home_team_id');
  const { data: awayEvents } = await supabase.from('events').select('away_team_id');

  const eventTeamIds = new Set<string>();
  for (const e of homeEvents || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
  }
  for (const e of awayEvents || []) {
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }
  console.log(`  Event team IDs: ${eventTeamIds.size}`);

  // Build cfbd_id -> our_team_id, preferring event teams
  const cfbdIdToOurId = new Map<number, string>();
  for (const team of allTeams || []) {
    const cfbdId = parseInt(team.cfbd_team_id, 10);
    if (isNaN(cfbdId)) continue;

    if (eventTeamIds.has(team.id)) {
      // Always prefer event teams
      cfbdIdToOurId.set(cfbdId, team.id);
    } else if (!cfbdIdToOurId.has(cfbdId)) {
      // Only use non-event team if no event team exists
      cfbdIdToOurId.set(cfbdId, team.id);
    }
  }
  console.log(`  CFBD ID mappings: ${cfbdIdToOurId.size}`);

  // Fetch CFBD team list
  const res = await fetch('https://api.collegefootballdata.com/teams/fbs', {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  const cfbdTeams = await res.json();
  console.log(`  CFBD FBS teams: ${cfbdTeams.length}`);

  // Build name -> our_team_id
  const cfbdNameToOurId = new Map<string, string>();
  for (const cfbdTeam of cfbdTeams) {
    const ourId = cfbdIdToOurId.get(cfbdTeam.id);
    if (ourId) {
      cfbdNameToOurId.set(cfbdTeam.school.toLowerCase(), ourId);
    }
  }
  console.log(`  Mapped CFBD names: ${cfbdNameToOurId.size}`);

  // Verify overlap with event teams
  const mappedEventTeams = [...cfbdNameToOurId.values()].filter(id => eventTeamIds.has(id)).length;
  console.log(`  Mapped to event teams: ${mappedEventTeams}/${cfbdNameToOurId.size}`);

  return cfbdNameToOurId;
}

async function clearEloSnapshots() {
  console.log('\nClearing team_elo_snapshots...');
  const { error, count } = await supabase
    .from('team_elo_snapshots')
    .delete()
    .gte('id', '00000000-0000-0000-0000-000000000000'); // Delete all
  console.log(`  Deleted ${count || 'all'} rows`);
}

async function clearStatsSnapshots() {
  console.log('Clearing team_stats_snapshots...');
  const { error, count } = await supabase
    .from('team_stats_snapshots')
    .delete()
    .gte('id', '00000000-0000-0000-0000-000000000000');
  console.log(`  Deleted ${count || 'all'} rows`);
}

async function syncEloForSeason(season: number, cfbdNameToTeamId: Map<string, string>) {
  console.log(`\n--- Syncing Elo for ${season} ---`);

  const weeks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  let totalInserted = 0;

  for (const week of weeks) {
    try {
      const res = await fetch(
        `https://api.collegefootballdata.com/ratings/elo?year=${season}&week=${week}`,
        { headers: { 'Authorization': `Bearer ${API_KEY}` } }
      );

      if (!res.ok) continue;

      const eloData = await res.json();
      if (!eloData || eloData.length === 0) continue;

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

      if (records.length > 0) {
        const { error, count } = await supabase
          .from('team_elo_snapshots')
          .upsert(records, { onConflict: 'team_id,season,week', count: 'exact' });

        if (!error) {
          console.log(`  W${week}: ${count} teams`);
          totalInserted += count || 0;
        }
      }
    } catch (err) {
      // Week doesn't exist
    }
  }

  console.log(`  Season ${season}: ${totalInserted} total records`);
  return totalInserted;
}

async function syncPPAForSeason(season: number, cfbdNameToTeamId: Map<string, string>) {
  console.log(`\n--- Syncing PPA for ${season} ---`);

  // Fetch all PPA games for the season
  const res = await fetch(
    `https://api.collegefootballdata.com/ppa/games?year=${season}&excludeGarbageTime=true`,
    { headers: { 'Authorization': `Bearer ${API_KEY}` } }
  );

  if (!res.ok) {
    console.log(`  Failed to fetch PPA: ${res.status}`);
    return 0;
  }

  const ppaData = await res.json();
  console.log(`  Fetched ${ppaData.length} team-game records`);

  // Group by team and week
  const byTeamWeek = new Map<string, { offPPA: number[]; defPPA: number[] }>();

  for (const game of ppaData) {
    const teamId = cfbdNameToTeamId.get(game.team?.toLowerCase() || '');
    if (!teamId || game.week === undefined) continue;

    const key = `${teamId}-${game.week}`;
    if (!byTeamWeek.has(key)) byTeamWeek.set(key, { offPPA: [], defPPA: [] });

    if (game.offense?.overall !== undefined) {
      byTeamWeek.get(key)!.offPPA.push(game.offense.overall);
    }
    if (game.defense?.overall !== undefined) {
      byTeamWeek.get(key)!.defPPA.push(game.defense.overall);
    }
  }

  // Build cumulative records
  const teamWeeks = new Map<string, Map<number, { offPPA: number[]; defPPA: number[] }>>();

  for (const [key, data] of byTeamWeek) {
    const [teamId, weekStr] = key.split('-');
    const week = parseInt(weekStr, 10);

    if (!teamWeeks.has(teamId)) teamWeeks.set(teamId, new Map());
    teamWeeks.get(teamId)!.set(week, data);
  }

  const records: Array<{
    team_id: string;
    season: number;
    week: number;
    games_played: number;
    off_ppa: number;
    def_ppa: number;
    source: string;
  }> = [];

  for (const [teamId, weeks] of teamWeeks) {
    const weekNums = [...weeks.keys()].sort((a, b) => a - b);
    let cumOffPPA: number[] = [];
    let cumDefPPA: number[] = [];

    for (const week of weekNums) {
      const data = weeks.get(week)!;
      cumOffPPA = cumOffPPA.concat(data.offPPA);
      cumDefPPA = cumDefPPA.concat(data.defPPA);

      if (cumOffPPA.length > 0) {
        records.push({
          team_id: teamId,
          season,
          week,
          games_played: cumOffPPA.length,
          off_ppa: cumOffPPA.reduce((a, b) => a + b, 0) / cumOffPPA.length,
          def_ppa: cumDefPPA.reduce((a, b) => a + b, 0) / cumDefPPA.length,
          source: 'cfbd_ppa',
        });
      }
    }
  }

  console.log(`  Generated ${records.length} cumulative PPA records`);

  // Insert in batches
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error, count } = await supabase
      .from('team_stats_snapshots')
      .upsert(batch, { onConflict: 'team_id,season,week', count: 'exact' });

    if (!error) inserted += count || 0;
  }

  console.log(`  Inserted ${inserted} PPA records`);
  return inserted;
}

async function syncPaceForSeason(season: number, cfbdNameToTeamId: Map<string, string>) {
  console.log(`\n--- Syncing Pace for ${season} ---`);

  let allStats: Array<{ team: string; week: number; plays: number }> = [];

  for (let week = 1; week <= 16; week++) {
    try {
      const res = await fetch(
        `https://api.collegefootballdata.com/stats/game/advanced?year=${season}&week=${week}`,
        { headers: { 'Authorization': `Bearer ${API_KEY}` } }
      );

      if (!res.ok) continue;

      const data = await res.json();
      for (const game of data) {
        if (game.team && game.offense?.plays) {
          allStats.push({
            team: game.team.toLowerCase(),
            week: game.week || week,
            plays: game.offense.plays,
          });
        }
      }
    } catch (err) {
      // Week doesn't exist
    }
  }

  console.log(`  Fetched ${allStats.length} team-game pace records`);

  // Group by team
  const byTeam = new Map<string, Array<{ week: number; plays: number }>>();
  for (const stat of allStats) {
    const teamId = cfbdNameToTeamId.get(stat.team);
    if (!teamId) continue;

    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId)!.push({ week: stat.week, plays: stat.plays });
  }

  // Update existing stats records with pace data
  let updated = 0;
  for (const [teamId, games] of byTeam) {
    games.sort((a, b) => a.week - b.week);

    let cumPlays = 0;
    let gamesPlayed = 0;
    let gameIdx = 0;
    const maxWeek = Math.max(...games.map(g => g.week));

    for (let week = 1; week <= maxWeek; week++) {
      while (gameIdx < games.length && games[gameIdx].week === week) {
        cumPlays += games[gameIdx].plays;
        gamesPlayed++;
        gameIdx++;
      }

      if (gamesPlayed === 0) continue;

      const { error } = await supabase
        .from('team_stats_snapshots')
        .update({
          total_plays: cumPlays,
          plays_per_game: cumPlays / gamesPlayed,
        })
        .eq('team_id', teamId)
        .eq('season', season)
        .eq('week', week);

      if (!error) updated++;
    }
  }

  console.log(`  Updated ${updated} records with pace data`);
  return updated;
}

async function verifyCoverage() {
  console.log('\n=== COVERAGE VERIFICATION ===\n');

  // Get event team IDs
  const { data: events } = await supabase.from('events').select('home_team_id, away_team_id');
  const eventTeamIds = new Set<string>();
  for (const e of events || []) {
    if (e.home_team_id) eventTeamIds.add(e.home_team_id);
    if (e.away_team_id) eventTeamIds.add(e.away_team_id);
  }

  // Get elo team IDs
  const { data: eloRows } = await supabase.from('team_elo_snapshots').select('team_id');
  const eloTeamIds = new Set<string>();
  for (const e of eloRows || []) {
    if (e.team_id) eloTeamIds.add(e.team_id);
  }

  // Get stats team IDs
  const { data: statsRows } = await supabase.from('team_stats_snapshots').select('team_id');
  const statsTeamIds = new Set<string>();
  for (const s of statsRows || []) {
    if (s.team_id) statsTeamIds.add(s.team_id);
  }

  const eventEloOverlap = [...eventTeamIds].filter(id => eloTeamIds.has(id)).length;
  const eventStatsOverlap = [...eventTeamIds].filter(id => statsTeamIds.has(id)).length;

  console.log(`Unique team IDs in events:       ${eventTeamIds.size}`);
  console.log(`Unique team IDs in elo_snapshots:   ${eloTeamIds.size}`);
  console.log(`Unique team IDs in stats_snapshots: ${statsTeamIds.size}`);
  console.log(`\nEvents ∩ Elo:   ${eventEloOverlap}/${eventTeamIds.size} (${(eventEloOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);
  console.log(`Events ∩ Stats: ${eventStatsOverlap}/${eventTeamIds.size} (${(eventStatsOverlap / eventTeamIds.size * 100).toFixed(1)}%)`);

  // Check total counts
  const { count: eloCount } = await supabase
    .from('team_elo_snapshots')
    .select('*', { count: 'exact', head: true });
  const { count: statsCount } = await supabase
    .from('team_stats_snapshots')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal Elo snapshots: ${eloCount}`);
  console.log(`Total Stats snapshots: ${statsCount}`);
}

async function main() {
  console.log('=== REBUILDING ALL SNAPSHOTS ===\n');

  // Build the mapping ONCE
  const cfbdNameToTeamId = await buildCFBDNameToTeamId();

  // Clear existing data
  await clearEloSnapshots();
  await clearStatsSnapshots();

  // Sync Elo for all seasons
  const seasons = [2022, 2023, 2024];
  for (const season of seasons) {
    await syncEloForSeason(season, cfbdNameToTeamId);
  }

  // Sync PPA for all seasons
  for (const season of seasons) {
    await syncPPAForSeason(season, cfbdNameToTeamId);
  }

  // Sync Pace for all seasons
  for (const season of seasons) {
    await syncPaceForSeason(season, cfbdNameToTeamId);
  }

  // Verify coverage
  await verifyCoverage();

  console.log('\n✅ Rebuild complete!');
}

main().catch(console.error);
