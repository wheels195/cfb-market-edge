/**
 * Sync SP+ and Pace Weekly Snapshots for Totals Model
 *
 * SP+: Season-level from CFBD, stored per-week for easy joining.
 * For point-in-time: Season N games use Season N-1's SP+ data.
 *
 * Pace: Computed as running average of plays per game from game_advanced_stats.
 * For point-in-time: Week N games use cumulative pace through Week N-1.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// FBS average plays per game (used for missing pace data)
const LEAGUE_AVG_PACE = 70;

interface TeamMapping {
  team_id: string;
  cfbd_team_name: string;
}

interface SPData {
  team_id: string;
  season: number;
  sp_overall: number | null;
  sp_offense: number | null;
  sp_defense: number | null;
}

interface GameStats {
  team_id: string;
  season: number;
  week: number;
  off_plays: number | null;
  def_plays: number | null;
}

async function getTeamMappings(): Promise<Map<string, string>> {
  // Get team_id -> cfbd_team_name mapping
  const { data } = await supabase
    .from('teams')
    .select('id, cfbd_team_name');

  const map = new Map<string, string>();
  for (const t of data || []) {
    if (t.cfbd_team_name) {
      map.set(t.cfbd_team_name, t.id);
    }
  }
  return map;
}

async function getSPDataBySeason(): Promise<Map<number, Map<string, SPData>>> {
  // Get SP+ ratings from advanced_team_ratings grouped by season
  const { data } = await supabase
    .from('advanced_team_ratings')
    .select('team_id, season, sp_overall, sp_offense, sp_defense')
    .not('sp_overall', 'is', null);

  const result = new Map<number, Map<string, SPData>>();

  for (const row of data || []) {
    if (!result.has(row.season)) {
      result.set(row.season, new Map());
    }
    result.get(row.season)!.set(row.team_id, {
      team_id: row.team_id,
      season: row.season,
      sp_overall: row.sp_overall,
      sp_offense: row.sp_offense,
      sp_defense: row.sp_defense,
    });
  }

  return result;
}

async function getGameStatsBySeason(): Promise<Map<number, GameStats[]>> {
  // Get game-level stats for computing running pace averages
  const { data } = await supabase
    .from('game_advanced_stats')
    .select('team_id, season, week, off_plays, def_plays')
    .order('season')
    .order('week');

  const result = new Map<number, GameStats[]>();

  for (const row of data || []) {
    if (!result.has(row.season)) {
      result.set(row.season, []);
    }
    result.get(row.season)!.push({
      team_id: row.team_id,
      season: row.season,
      week: row.week,
      off_plays: row.off_plays,
      def_plays: row.def_plays,
    });
  }

  return result;
}

async function createSPSnapshots() {
  console.log('=== Creating SP+ Weekly Snapshots ===');

  // For point-in-time: Season N uses Season N-1 SP+ data
  // We create entries for each (team, season, week) that uses prior season's SP+

  const spData = await getSPDataBySeason();

  const rows: Array<{
    team_id: string;
    season: number;
    week: number;
    sp_overall: number;
    sp_offense: number;
    sp_defense: number;
    source_season: number;
  }> = [];

  // For seasons 2022, 2023, 2024, use prior year's SP+
  for (const currentSeason of [2022, 2023, 2024]) {
    const priorSeason = currentSeason - 1;
    const priorSPData = spData.get(priorSeason);

    if (!priorSPData) {
      console.log(`  No SP+ data for ${priorSeason}, skipping ${currentSeason}`);
      continue;
    }

    // Create snapshot for each week 1-16 using prior season's SP+
    for (const [teamId, sp] of priorSPData.entries()) {
      if (sp.sp_overall === null) continue;

      // Same SP+ value for all weeks (preseason SP+)
      for (let week = 0; week <= 16; week++) {
        rows.push({
          team_id: teamId,
          season: currentSeason,
          week: week,
          sp_overall: sp.sp_overall,
          sp_offense: sp.sp_offense || 0,
          sp_defense: sp.sp_defense || 0,
          source_season: priorSeason,
        });
      }
    }

    console.log(`  ${currentSeason}: Using ${priorSeason} SP+ for ${priorSPData.size} teams`);
  }

  // Clear existing and insert
  if (rows.length > 0) {
    await supabase.from('sp_weekly_snapshots').delete().gte('season', 2022);

    // Insert in batches
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      const { error } = await supabase.from('sp_weekly_snapshots').insert(batch);
      if (error) {
        console.error(`  Insert error at batch ${i}: ${error.message}`);
      }
    }
  }

  console.log(`  Total SP+ snapshots: ${rows.length}`);
  return rows.length;
}

async function createPaceSnapshots() {
  console.log('\n=== Creating Pace Weekly Snapshots ===');

  // Pace = running average of total plays per game through week N-1
  // We use game_advanced_stats which has off_plays per game

  const gameStats = await getGameStatsBySeason();

  const rows: Array<{
    team_id: string;
    season: number;
    week: number;
    plays_per_game: number;
    games_played: number;
  }> = [];

  for (const season of [2021, 2022, 2023, 2024]) {
    const seasonStats = gameStats.get(season) || [];

    // Group by team
    const teamGames = new Map<string, { week: number; plays: number }[]>();
    for (const stat of seasonStats) {
      if (!teamGames.has(stat.team_id)) {
        teamGames.set(stat.team_id, []);
      }
      // Total plays = offensive plays (if available)
      // If off_plays is null, we skip this game
      const plays = stat.off_plays;
      if (plays !== null) {
        teamGames.get(stat.team_id)!.push({ week: stat.week, plays });
      }
    }

    // For each team, compute running average through each week
    for (const [teamId, games] of teamGames.entries()) {
      // Sort by week
      games.sort((a, b) => a.week - b.week);

      // Week 0 (preseason): No data, use league average
      rows.push({
        team_id: teamId,
        season,
        week: 0,
        plays_per_game: LEAGUE_AVG_PACE,
        games_played: 0,
      });

      // Running average through each week
      let totalPlays = 0;
      let gamesPlayed = 0;
      let lastProcessedWeek = 0;

      for (const game of games) {
        // Fill in weeks between games with the same running average
        for (let w = lastProcessedWeek + 1; w < game.week; w++) {
          rows.push({
            team_id: teamId,
            season,
            week: w,
            plays_per_game: gamesPlayed > 0 ? totalPlays / gamesPlayed : LEAGUE_AVG_PACE,
            games_played: gamesPlayed,
          });
        }

        // Add this game's plays to running total
        totalPlays += game.plays;
        gamesPlayed++;

        // The snapshot for this week is BEFORE this game (point-in-time)
        // So week N snapshot reflects games through week N-1
        rows.push({
          team_id: teamId,
          season,
          week: game.week,
          plays_per_game: gamesPlayed > 1 ? (totalPlays - game.plays) / (gamesPlayed - 1) : LEAGUE_AVG_PACE,
          games_played: gamesPlayed - 1,
        });

        lastProcessedWeek = game.week;
      }

      // Fill in remaining weeks with final running average
      for (let w = lastProcessedWeek + 1; w <= 16; w++) {
        rows.push({
          team_id: teamId,
          season,
          week: w,
          plays_per_game: gamesPlayed > 0 ? totalPlays / gamesPlayed : LEAGUE_AVG_PACE,
          games_played: gamesPlayed,
        });
      }
    }

    console.log(`  ${season}: ${teamGames.size} teams with pace data`);
  }

  // Clear existing and insert
  if (rows.length > 0) {
    await supabase.from('pace_weekly_snapshots').delete().gte('season', 2021);

    // Insert in batches
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      const { error } = await supabase.from('pace_weekly_snapshots').insert(batch);
      if (error) {
        console.error(`  Insert error at batch ${i}: ${error.message}`);
      }
    }
  }

  console.log(`  Total pace snapshots: ${rows.length}`);
  return rows.length;
}

async function verifyTables() {
  console.log('\n=== Verifying Tables Exist ===');

  // Check if tables exist
  const tables = ['sp_weekly_snapshots', 'pace_weekly_snapshots'];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error && error.message.includes('does not exist')) {
      console.log(`\n⚠️  Table '${table}' does not exist. Creating...`);

      if (table === 'sp_weekly_snapshots') {
        // Try to create via SQL
        console.log(`\nPlease run this SQL in Supabase SQL Editor:\n`);
        console.log(`
CREATE TABLE IF NOT EXISTS sp_weekly_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES teams(id),
  season int NOT NULL,
  week int NOT NULL,
  sp_overall numeric,
  sp_offense numeric,
  sp_defense numeric,
  source_season int,
  UNIQUE(team_id, season, week)
);

CREATE INDEX idx_sp_snapshots_lookup ON sp_weekly_snapshots(season, week, team_id);
        `);
      }

      if (table === 'pace_weekly_snapshots') {
        console.log(`
CREATE TABLE IF NOT EXISTS pace_weekly_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES teams(id),
  season int NOT NULL,
  week int NOT NULL,
  plays_per_game numeric,
  games_played int DEFAULT 0,
  UNIQUE(team_id, season, week)
);

CREATE INDEX idx_pace_snapshots_lookup ON pace_weekly_snapshots(season, week, team_id);
        `);
      }

      return false;
    } else if (error) {
      console.log(`  ${table}: Error - ${error.message}`);
    } else {
      console.log(`  ${table}: ✅ Exists`);
    }
  }

  return true;
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  SYNC SP+ & PACE WEEKLY SNAPSHOTS          ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const tablesExist = await verifyTables();

  if (!tablesExist) {
    console.log('\n❌ Please create the tables first, then run this script again.');
    return;
  }

  const spCount = await createSPSnapshots();
  const paceCount = await createPaceSnapshots();

  console.log('\n=== SYNC COMPLETE ===');
  console.log(`SP+ snapshots: ${spCount}`);
  console.log(`Pace snapshots: ${paceCount}`);

  // Verify data
  console.log('\n=== VERIFICATION ===');

  const { data: spSample } = await supabase
    .from('sp_weekly_snapshots')
    .select('season, week, sp_overall, sp_offense, sp_defense')
    .eq('season', 2024)
    .eq('week', 1)
    .limit(3);

  console.log('SP+ sample (2024 Week 1):', spSample);

  const { data: paceSample } = await supabase
    .from('pace_weekly_snapshots')
    .select('season, week, plays_per_game, games_played')
    .eq('season', 2024)
    .eq('week', 5)
    .limit(3);

  console.log('Pace sample (2024 Week 5):', paceSample);
}

main().catch(console.error);
