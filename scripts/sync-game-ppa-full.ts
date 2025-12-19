/**
 * Full sync of game-level PPA data
 *
 * Gets all games for each season in one API call rather than week-by-week
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

const SEASONS = [2021, 2022, 2023, 2024];

// Build team name mapping with more variations
async function buildTeamMapping(): Promise<Map<string, string>> {
  const { data: teams } = await supabase.from('teams').select('id, name');
  const map = new Map<string, string>();

  for (const team of teams || []) {
    const name = team.name.toLowerCase();
    map.set(name, team.id);

    // Common variations
    map.set(name.replace(/state/g, 'st'), team.id);
    map.set(name.replace(/st\.?/g, 'state'), team.id);

    // Nicknames to remove
    const nicknames = [
      'crimson tide', 'bulldogs', 'tigers', 'buckeyes', 'volunteers',
      'hurricanes', 'longhorns', 'sooners', 'wolverines', 'spartans',
      'nittany lions', 'wildcats', 'hawkeyes', 'fighting irish', 'ducks',
      'trojans', 'bears', 'cardinals', 'eagles', 'seminoles', 'gators',
      'yellow jackets', 'demon deacons', 'blue devils', 'tar heels',
      'wolfpack', 'cavaliers', 'hokies', 'mountaineers', 'cyclones',
      'jayhawks', 'red raiders', 'horned frogs', 'cowboys', 'aggies',
      'rebels', 'commodores', 'razorbacks', 'gamecocks', 'broncos',
      'falcons', 'golden flashes', 'rockets', 'redhawks', 'bobcats',
      'bulls', 'chippewas', 'huskies', 'thundering herd', 'hilltoppers',
      'blue raiders', 'chanticleers', 'jaguars', 'blazers', 'panthers',
      '49ers', 'monarchs', 'flames', 'dukes', 'bearkats', 'ragin cajuns',
      'warhawks', 'wolf pack', 'aztecs', 'mean green', 'roadrunners',
      'miners', 'golden hurricane', 'owls', 'mustangs', 'zips',
    ];

    for (const nick of nicknames) {
      const withoutNick = name.replace(new RegExp(` ${nick}$`, 'i'), '').trim();
      if (withoutNick !== name) {
        map.set(withoutNick, team.id);
      }
    }
  }

  // Manual mappings for common mismatches
  const manualMappings: Record<string, string> = {
    'usc': 'southern california',
    'southern cal': 'southern california',
    'ole miss': 'mississippi',
    'lsu': 'louisiana state', // Will resolve to actual team ID
    'pitt': 'pittsburgh',
    'uconn': 'connecticut',
    'umass': 'massachusetts',
    'ucf': 'central florida',
    'smu': 'southern methodist',
    'tcu': 'texas christian',
    'utep': 'texas-el paso',
    'utsa': 'texas-san antonio',
    'fiu': 'florida international',
    'fau': 'florida atlantic',
    'unlv': 'nevada-las vegas',
    'uab': 'alabama-birmingham',
    'byu': 'brigham young',
    'miami (oh)': 'miami (oh)',
    'miami (fl)': 'miami',
    'nc state': 'north carolina state',
    'unc': 'north carolina',
  };

  for (const [alias, canonical] of Object.entries(manualMappings)) {
    const teamId = map.get(canonical.toLowerCase());
    if (teamId) {
      map.set(alias.toLowerCase(), teamId);
    }
  }

  return map;
}

function findTeamId(teamName: string, mapping: Map<string, string>): string | null {
  if (!teamName) return null;
  const lower = teamName.toLowerCase().trim();

  // Direct match
  if (mapping.has(lower)) return mapping.get(lower)!;

  // Try removing common suffixes
  const suffixes = [' state', ' university', ' college'];
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      const without = lower.slice(0, -suffix.length);
      if (mapping.has(without)) return mapping.get(without)!;
    }
  }

  // Try adding state
  if (mapping.has(lower + ' state')) return mapping.get(lower + ' state')!;

  return null;
}

async function syncSeason(season: number, teamMapping: Map<string, string>) {
  console.log(`\n=== Season ${season} ===`);

  // Get all game PPA for the season
  const allGames = await cfbd.getGamePPA(season);
  console.log(`  API returned ${allGames.length} team-game records`);

  // Track unmatched teams
  const unmatchedTeams = new Set<string>();
  let matchedCount = 0;

  const rows: any[] = [];

  for (const game of allGames) {
    const teamId = findTeamId(game.team, teamMapping);
    const opponentId = findTeamId(game.opponent, teamMapping);

    if (!teamId) {
      unmatchedTeams.add(game.team);
      continue;
    }

    matchedCount++;

    rows.push({
      cfbd_game_id: game.gameId,
      team_id: teamId,
      season,
      week: game.week,
      opponent_id: opponentId,
      is_home: game.conference ? true : null, // Not reliable, will need to fix
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

  console.log(`  Matched ${matchedCount} records`);

  if (unmatchedTeams.size > 0) {
    console.log(`  Unmatched teams (${unmatchedTeams.size}): ${Array.from(unmatchedTeams).slice(0, 10).join(', ')}${unmatchedTeams.size > 10 ? '...' : ''}`);
  }

  // Delete existing data for this season
  const { error: deleteError } = await supabase
    .from('game_advanced_stats')
    .delete()
    .eq('season', season);

  if (deleteError) {
    console.log(`  Delete error: ${deleteError.message}`);
  }

  // Insert in batches
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('game_advanced_stats')
      .insert(batch);

    if (error) {
      console.log(`  Insert error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Inserted ${inserted} records`);
}

async function main() {
  console.log('=== FULL GAME PPA SYNC ===');

  const teamMapping = await buildTeamMapping();
  console.log(`Loaded ${teamMapping.size} team name variations`);

  for (const season of SEASONS) {
    await syncSeason(season, teamMapping);
    await new Promise(r => setTimeout(r, 500)); // Rate limit between seasons
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  for (const season of SEASONS) {
    const { count } = await supabase
      .from('game_advanced_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season);
    console.log(`  ${season}: ${count} records`);
  }
}

main().catch(console.error);
