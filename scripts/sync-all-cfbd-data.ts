/**
 * Comprehensive CFBD Data Sync
 *
 * Syncs all data needed for the v2 model:
 * - Returning production
 * - Player season stats
 * - Player usage
 * - Rosters
 * - Recruiting classes
 * - Game advanced stats (PPA per game)
 * - Weather
 * - Transfer portal
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

// Seasons to sync
const SEASONS = [2021, 2022, 2023, 2024];

// Team name mapping (CFBD name -> our team_id)
let teamNameToId: Map<string, string> = new Map();

async function loadTeamMapping() {
  console.log('Loading team mappings...');
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name');

  if (teams) {
    for (const team of teams) {
      teamNameToId.set(team.name.toLowerCase(), team.id);
      // Also add common variations
      const shortName = team.name.replace(/ (Crimson Tide|Bulldogs|Tigers|Buckeyes|Volunteers|Hurricanes|Longhorns|Sooners|Wolverines|Spartans|Nittany Lions|Wildcats|Hawkeyes|Fighting Irish|Ducks|Trojans|Bears|Cardinals|Eagles|Seminoles|Gators|Yellow Jackets|Demon Deacons|Blue Devils|Tar Heels|Wolfpack|Cavaliers|Hokies|Mountaineers|Cyclones|Jayhawks|Red Raiders|Horned Frogs|Cowboys|Golden Hurricane|Owls|Mustangs|Mean Green|Roadrunners|Miners|Aggies|Rebels|Commodores|Razorbacks|Gamecocks|Broncos|Falcons|Zips|Golden Flashes|Rockets|RedHawks|Bobcats|Bulls|Chippewas|Huskies|Eagles|Thundering Herd|Hilltoppers|Blue Raiders|Chanticleers|Jaguars|Trojans|Blazers|Panthers|49ers|Monarchs|Flames|Dukes|Bearkats|Ragin' Cajuns|Warhawks|Wolf Pack|Aztecs)$/i, '');
      if (shortName !== team.name) {
        teamNameToId.set(shortName.toLowerCase().trim(), team.id);
      }
    }
  }
  console.log(`  Loaded ${teamNameToId.size} team mappings\n`);
}

function getTeamId(teamName: string): string | null {
  if (!teamName) return null;
  const lower = teamName.toLowerCase();
  return teamNameToId.get(lower) || null;
}

// ============================================================
// SYNC FUNCTIONS
// ============================================================

async function syncReturningProduction() {
  console.log('=== Syncing Returning Production ===');

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);
    try {
      const data = await cfbd.getReturningProduction(season);
      console.log(`    Got ${data.length} teams`);

      const rows = data
        .map(r => {
          const teamId = getTeamId(r.team);
          if (!teamId) return null;
          return {
            team_id: teamId,
            season,
            total_ppa: r.totalPPA,
            total_passing_ppa: r.totalPassingPPA,
            total_rushing_ppa: r.totalRushingPPA,
            total_receiving_ppa: r.totalReceivingPPA,
            percent_ppa: r.percentPPA,
            percent_passing_ppa: r.percentPassingPPA,
            percent_rushing_ppa: r.percentRushingPPA,
            percent_receiving_ppa: r.percentReceivingPPA,
            usage: r.usage,
            passing_usage: r.passingUsage,
            rushing_usage: r.rushingUsage,
            receiving_usage: r.receivingUsage,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error } = await supabase
          .from('returning_production')
          .upsert(rows, { onConflict: 'team_id,season' });
        if (error) console.log(`    Error: ${error.message}`);
        else console.log(`    Upserted ${rows.length} rows`);
      }
    } catch (err) {
      console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

async function syncPlayerSeasonStats() {
  console.log('\n=== Syncing Player Season Stats ===');

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);

    // Sync each category
    for (const category of ['passing', 'rushing', 'receiving', 'defensive'] as const) {
      try {
        const data = await cfbd.getPlayerSeasonStats(season, undefined, category);
        console.log(`    ${category}: ${data.length} players`);

        const rows: Record<string, any>[] = [];
        for (const player of data) {
          const teamId = getTeamId(player.team);
          if (!teamId) continue;

          // Find or create player row
          const existingRow = rows.find(r =>
            r.cfbd_player_id === player.playerId?.toString() &&
            r.season === season
          );

          if (existingRow) {
            // Merge stats into existing row
            Object.assign(existingRow, getStatsForCategory(player, category));
          } else {
            rows.push({
              cfbd_player_id: player.playerId?.toString() || `${player.player}_${season}`,
              player_name: player.player,
              team_id: teamId,
              season,
              position: player.position,
              ...getStatsForCategory(player, category),
            });
          }
        }

        if (rows.length > 0) {
          // Batch insert
          for (let i = 0; i < rows.length; i += 100) {
            const batch = rows.slice(i, i + 100);
            const { error } = await supabase
              .from('player_seasons')
              .upsert(batch, { onConflict: 'cfbd_player_id,season' });
            if (error && !error.message.includes('duplicate')) {
              console.log(`      Batch error: ${error.message}`);
            }
          }
        }
      } catch (err) {
        console.log(`    ${category} error: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }
  }
}

function getStatsForCategory(player: any, category: string): Record<string, number> {
  switch (category) {
    case 'passing':
      return {
        passing_completions: player.completions || 0,
        passing_attempts: player.attempts || 0,
        passing_yards: player.yards || 0,
        passing_tds: player.tds || 0,
        passing_ints: player.interceptions || 0,
      };
    case 'rushing':
      return {
        rushing_attempts: player.carries || 0,
        rushing_yards: player.yards || 0,
        rushing_tds: player.tds || 0,
      };
    case 'receiving':
      return {
        receptions: player.receptions || 0,
        receiving_yards: player.yards || 0,
        receiving_tds: player.tds || 0,
      };
    case 'defensive':
      return {
        tackles: player.totalTackles || 0,
        solo_tackles: player.soloTackles || 0,
        tackles_for_loss: player.tacklesForLoss || 0,
        sacks: player.sacks || 0,
        interceptions: player.interceptions || 0,
        passes_defended: player.passesDefended || 0,
      };
    default:
      return {};
  }
}

async function syncPlayerUsage() {
  console.log('\n=== Syncing Player Usage ===');

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);
    try {
      const data = await cfbd.getPlayerUsage(season);
      console.log(`    Got ${data.length} players`);

      const rows = data
        .map(p => {
          const teamId = getTeamId(p.team);
          if (!teamId) return null;
          return {
            cfbd_player_id: p.id?.toString() || `${p.name}_${season}`,
            player_name: p.name,
            team_id: teamId,
            season,
            position: p.position,
            overall_usage: p.usage?.overall,
            passing_usage: p.usage?.pass,
            rushing_usage: p.usage?.rush,
            first_down_usage: p.usage?.firstDown,
            second_down_usage: p.usage?.secondDown,
            third_down_usage: p.usage?.thirdDown,
            standard_downs_usage: p.usage?.standardDowns,
            passing_downs_usage: p.usage?.passingDowns,
          };
        })
        .filter(Boolean);

      // Batch insert
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase
          .from('player_usage')
          .upsert(batch, { onConflict: 'cfbd_player_id,season' });
        if (error) console.log(`    Batch error: ${error.message}`);
      }
      console.log(`    Upserted ${rows.length} rows`);
    } catch (err) {
      console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

async function syncRosters() {
  console.log('\n=== Syncing Rosters ===');

  // Get all team names we have
  const { data: teams } = await supabase.from('teams').select('id, name');
  if (!teams) return;

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);
    let totalPlayers = 0;

    for (const team of teams.slice(0, 150)) { // Limit to FBS-ish teams
      try {
        const roster = await cfbd.getRoster(team.name, season);
        if (!roster || roster.length === 0) continue;

        const rows = roster.map(p => ({
          team_id: team.id,
          season,
          cfbd_player_id: p.id?.toString() || `${p.firstName}_${p.lastName}_${season}`,
          player_name: `${p.firstName} ${p.lastName}`,
          first_name: p.firstName,
          last_name: p.lastName,
          position: p.position,
          jersey_number: p.jersey,
          height: p.height,
          weight: p.weight,
          year: p.year?.toString(),
          home_city: p.homeCity,
          home_state: p.homeState,
          recruit_stars: p.recruitStars,
          recruit_rating: p.recruitRating,
        }));

        if (rows.length > 0) {
          const { error } = await supabase
            .from('rosters')
            .upsert(rows, { onConflict: 'team_id,season,cfbd_player_id' });
          if (!error) totalPlayers += rows.length;
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        // Skip errors for teams not found
      }
    }
    console.log(`    Synced ${totalPlayers} players`);
  }
}

async function syncRecruitingClasses() {
  console.log('\n=== Syncing Recruiting Classes ===');

  for (const season of [...SEASONS, 2020, 2019, 2018]) { // Go back further for 4-year composite
    console.log(`  Season ${season}...`);
    try {
      const data = await cfbd.getRecruitingTeams(season);
      console.log(`    Got ${data.length} teams`);

      const rows = data
        .map(r => {
          const teamId = getTeamId(r.team);
          if (!teamId) return null;
          return {
            team_id: teamId,
            season: r.year,
            rank: r.rank,
            points: r.points,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error } = await supabase
          .from('recruiting_classes')
          .upsert(rows, { onConflict: 'team_id,season' });
        if (error) console.log(`    Error: ${error.message}`);
        else console.log(`    Upserted ${rows.length} rows`);
      }
    } catch (err) {
      console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

async function syncGameAdvancedStats() {
  console.log('\n=== Syncing Game Advanced Stats (PPA) ===');

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);

    // Get week by week
    for (let week = 1; week <= 15; week++) {
      try {
        const data = await cfbd.getGamePPA(season, week);
        if (!data || data.length === 0) continue;

        const rows = [];
        for (const game of data) {
          // Home team
          const homeTeamId = getTeamId(game.team);
          const awayTeamId = getTeamId(game.opponent);

          if (homeTeamId) {
            rows.push({
              cfbd_game_id: game.gameId,
              team_id: homeTeamId,
              season,
              week,
              opponent_id: awayTeamId,
              is_home: true,
              off_ppa: game.offense?.overall,
              off_passing_ppa: game.offense?.passing,
              off_rushing_ppa: game.offense?.rushing,
              off_success_rate: game.offense?.successRate,
              off_explosiveness: game.offense?.explosiveness,
              def_ppa: game.defense?.overall,
              def_passing_ppa: game.defense?.passing,
              def_rushing_ppa: game.defense?.rushing,
              def_success_rate: game.defense?.successRate,
              def_explosiveness: game.defense?.explosiveness,
            });
          }
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from('game_advanced_stats')
            .upsert(rows, { onConflict: 'cfbd_game_id,team_id' });
          if (error && !error.message.includes('duplicate')) {
            console.log(`      Week ${week} error: ${error.message}`);
          }
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        // Some weeks may not have data
      }
    }

    // Also get postseason
    try {
      const postData = await cfbd.getGamePPA(season, undefined, undefined, 'postseason');
      if (postData && postData.length > 0) {
        const rows = postData
          .map(game => {
            const teamId = getTeamId(game.team);
            if (!teamId) return null;
            return {
              cfbd_game_id: game.gameId,
              team_id: teamId,
              season,
              week: 16,
              is_home: true,
              off_ppa: game.offense?.overall,
              off_passing_ppa: game.offense?.passing,
              off_rushing_ppa: game.offense?.rushing,
              def_ppa: game.defense?.overall,
              def_passing_ppa: game.defense?.passing,
              def_rushing_ppa: game.defense?.rushing,
            };
          })
          .filter(Boolean);

        if (rows.length > 0) {
          await supabase
            .from('game_advanced_stats')
            .upsert(rows, { onConflict: 'cfbd_game_id,team_id' });
        }
      }
    } catch (err) {
      // Postseason may not be available
    }

    console.log(`    Completed season ${season}`);
  }
}

async function syncWeather() {
  console.log('\n=== Syncing Weather ===');

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);
    try {
      const data = await cfbd.getWeather(season);
      console.log(`    Got ${data.length} games with weather`);

      const rows = data.map(w => ({
        cfbd_game_id: w.id,
        season,
        week: w.week,
        temperature: w.temperature,
        dew_point: w.dewPoint,
        humidity: w.humidity,
        precipitation: w.precipitation,
        snowfall: w.snowfall,
        wind_direction: w.windDirection,
        wind_speed: w.windSpeed,
        pressure: w.pressure,
        weather_condition: w.weatherCondition,
        is_indoor: w.gameIndoors || false,
      }));

      // Batch insert
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase
          .from('game_weather')
          .upsert(batch, { onConflict: 'cfbd_game_id' });
        if (error && !error.message.includes('duplicate')) {
          console.log(`    Batch error: ${error.message}`);
        }
      }
      console.log(`    Upserted ${rows.length} rows`);
    } catch (err) {
      console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

async function syncTransferPortal() {
  console.log('\n=== Syncing Transfer Portal ===');

  for (const season of SEASONS) {
    console.log(`  Season ${season}...`);
    try {
      const data = await cfbd.getTransferPortal(season);
      console.log(`    Got ${data.length} transfers`);

      const rows = data.map(t => ({
        cfbd_player_id: t.playerId?.toString(),
        player_name: `${t.firstName} ${t.lastName}`,
        season,
        position: t.position,
        origin_team_id: getTeamId(t.origin),
        origin_team_name: t.origin,
        destination_team_id: t.destination ? getTeamId(t.destination) : null,
        destination_team_name: t.destination,
        transfer_date: t.transferDate,
        eligibility: t.eligibility,
        stars: t.stars,
        rating: t.rating,
      }));

      const { error } = await supabase
        .from('transfer_portal')
        .insert(rows);
      if (error && !error.message.includes('duplicate')) {
        console.log(`    Error: ${error.message}`);
      } else {
        console.log(`    Inserted ${rows.length} rows`);
      }
    } catch (err) {
      console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('============================================');
  console.log('       CFBD COMPREHENSIVE DATA SYNC');
  console.log('============================================\n');
  console.log(`Syncing seasons: ${SEASONS.join(', ')}\n`);

  await loadTeamMapping();

  const startTime = Date.now();

  // Run all syncs
  await syncReturningProduction();
  await syncRecruitingClasses();
  await syncPlayerUsage();
  await syncPlayerSeasonStats();
  await syncGameAdvancedStats();
  await syncWeather();
  await syncTransferPortal();

  // Rosters take a long time due to per-team API calls
  // Comment out for faster initial sync
  // await syncRosters();

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('\n============================================');
  console.log(`Sync completed in ${elapsed} seconds`);
  console.log('============================================');

  // Print summary
  const tables = [
    'returning_production',
    'recruiting_classes',
    'player_usage',
    'player_seasons',
    'game_advanced_stats',
    'game_weather',
    'transfer_portal',
  ];

  console.log('\nTable row counts:');
  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    console.log(`  ${table}: ${count || 0}`);
  }
}

main().catch(console.error);
