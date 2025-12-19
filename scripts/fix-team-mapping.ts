/**
 * Fix team mapping between Odds API and CFBD teams
 *
 * Problem: Odds API uses "Alabama Crimson Tide", CFBD uses "Alabama"
 * Solution: Map odds_api_name to cfbd_team_id by normalizing names
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Common mascot suffixes to strip for matching
const MASCOT_PATTERNS = [
  // SEC
  'Crimson Tide', 'Tigers', 'Razorbacks', 'Gators', 'Bulldogs', 'Wildcats',
  'Volunteers', 'Rebels', 'Aggies', 'Commodores', 'Gamecocks', 'Golden Eagles',
  // Big Ten
  'Buckeyes', 'Wolverines', 'Nittany Lions', 'Spartans', 'Hawkeyes', 'Badgers',
  'Gophers', 'Cornhuskers', 'Fighting Illini', 'Boilermakers', 'Hoosiers',
  'Scarlet Knights', 'Terrapins', 'Golden Gophers',
  // Big 12
  'Sooners', 'Longhorns', 'Bears', 'Horned Frogs', 'Red Raiders', 'Jayhawks',
  'Cyclones', 'Mountaineers', 'Cowboys', 'Bearcats', 'Cougars', 'Knights',
  'Utes', 'Sun Devils', 'Buffaloes',
  // ACC
  'Yellow Jackets', 'Seminoles', 'Hurricanes', 'Cavaliers', 'Hokies',
  'Wolfpack', 'Demon Deacons', 'Blue Devils', 'Tar Heels', 'Cardinals',
  'Orange', 'Panthers', 'Fighting Irish',
  // Pac-12 remnants
  'Ducks', 'Huskies', 'Beavers', 'Bruins', 'Trojans', 'Golden Bears',
  'Cardinal', 'Buffaloes', 'Utes',
  // Other common
  'Owls', 'Mustangs', 'Mean Green', 'Roadrunners', 'Bobcats', 'Rockets',
  'Broncos', 'Aztecs', 'Spartans', 'Eagles', 'Falcons', 'Hawks', 'Miners',
  'Thundering Herd', 'Golden Flashes', 'Zips', 'Rockets', 'Redhawks',
  'RedHawks', 'Penguins', 'Bulls', 'Huskies', 'Chippewas', 'Broncos',
  'Green Wave', 'Hilltoppers', 'Jaguars', 'Blazers', 'Monarchs',
  'Dukes', 'Chanticleers', 'Thunderbirds', 'Lobos', 'Rams', 'Falcons',
  'Black Knights', 'Midshipmen', 'Rainbow Warriors', 'Minutemen',
  'Terriers', 'Catamounts', 'Seawolves', 'Great Danes', 'Phoenix',
  'Mocs', 'Pirates', 'Wave', 'Flames', 'Paladins'
];

function normalizeTeamName(name: string): string {
  const original = name.trim();

  // Handle special cases FIRST (before mascot stripping)
  const specialMappings: Record<string, string> = {
    'Ole Miss': 'Mississippi',
    'Miami (OH)': 'Miami (OH)',
    'Miami Hurricanes': 'Miami',
    'LSU': 'LSU',
    'USC': 'USC',
    'UCLA': 'UCLA',
    'UCF': 'UCF',
    'SMU': 'SMU',
    'BYU': 'BYU',
    'UNLV': 'UNLV',
    'UTSA': 'UTSA',
    'UTEP': 'UTEP',
    'UConn': 'Connecticut',
    'NC State': 'NC State',
    'FIU': 'FIU',
    'FAU': 'FAU',
    // Fixed unmapped teams
    'Arkansas State Red Wolves': 'Arkansas State',
    'Southern Mississippi': 'Southern Miss',
    'Hawaii Rainbow Warriors': "Hawai'i",
    'California Golden Bears': 'California',
    'Minnesota Golden Gophers': 'Minnesota',
    'Army Black Knights': 'Army',
    'Appalachian State Mountaineers': 'App State',
  };

  for (const [from, to] of Object.entries(specialMappings)) {
    if (original.toLowerCase().includes(from.toLowerCase())) {
      return to;
    }
  }

  // Remove common mascot suffixes
  let normalized = original;
  for (const mascot of MASCOT_PATTERNS) {
    const pattern = new RegExp(`\\s+${mascot}$`, 'i');
    normalized = normalized.replace(pattern, '');
  }

  return normalized.trim();
}

async function fixTeamMapping() {
  console.log('=== FIXING TEAM MAPPING ===\n');

  // Get all teams from Odds API (have odds_api_name)
  const { data: oddsApiTeams } = await supabase
    .from('teams')
    .select('*')
    .not('odds_api_name', 'is', null);

  // Get all teams from CFBD (have cfbd_team_id)
  const { data: cfbdTeams } = await supabase
    .from('teams')
    .select('*')
    .not('cfbd_team_id', 'is', null);

  console.log(`Odds API teams: ${oddsApiTeams?.length || 0}`);
  console.log(`CFBD teams: ${cfbdTeams?.length || 0}\n`);

  if (!oddsApiTeams || !cfbdTeams) {
    console.log('No teams to process');
    return;
  }

  // Build CFBD lookup by normalized name
  const cfbdByName = new Map<string, typeof cfbdTeams[0]>();
  for (const team of cfbdTeams) {
    const normalized = normalizeTeamName(team.name).toLowerCase();
    cfbdByName.set(normalized, team);
    // Also add exact name
    cfbdByName.set(team.name.toLowerCase(), team);
  }

  let mapped = 0;
  let notFound = 0;
  const unmapped: string[] = [];

  for (const oddsTeam of oddsApiTeams) {
    // Skip if already has cfbd_team_id
    if (oddsTeam.cfbd_team_id) {
      console.log(`  ✓ ${oddsTeam.odds_api_name} already mapped`);
      mapped++;
      continue;
    }

    const normalized = normalizeTeamName(oddsTeam.odds_api_name || oddsTeam.name).toLowerCase();
    const cfbdTeam = cfbdByName.get(normalized);

    if (cfbdTeam) {
      // Update the Odds API team with CFBD team ID
      const { error } = await supabase
        .from('teams')
        .update({ cfbd_team_id: cfbdTeam.cfbd_team_id })
        .eq('id', oddsTeam.id);

      if (error) {
        console.log(`  ✗ ${oddsTeam.odds_api_name} -> ${cfbdTeam.name}: ${error.message}`);
      } else {
        console.log(`  ✓ ${oddsTeam.odds_api_name} -> ${cfbdTeam.name} (CFBD: ${cfbdTeam.cfbd_team_id})`);
        mapped++;
      }
    } else {
      console.log(`  ? ${oddsTeam.odds_api_name} (normalized: "${normalized}") - NO MATCH`);
      unmapped.push(`${oddsTeam.odds_api_name} -> "${normalized}"`);
      notFound++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Mapped: ${mapped}`);
  console.log(`Not found: ${notFound}`);

  if (unmapped.length > 0) {
    console.log(`\nUnmapped teams:`);
    for (const t of unmapped) {
      console.log(`  - ${t}`);
    }
  }
}

fixTeamMapping().catch(console.error);
