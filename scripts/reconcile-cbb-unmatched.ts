/**
 * Reconcile unmatched CBB team names against current KNOWN_MAPPINGS
 *
 * This script:
 * 1. Loads all unmatched team names from database
 * 2. Checks each against KNOWN_MAPPINGS
 * 3. If found, creates the mapping and marks as resolved
 * 4. Reports what's still truly unmatched
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Copy of KNOWN_MAPPINGS from build-cbb-team-mapping.ts
const KNOWN_MAPPINGS: Record<string, string> = {
  // Abbreviation differences
  'NC State Wolfpack': 'North Carolina State',
  'UNC Tar Heels': 'North Carolina',
  'UConn Huskies': 'Connecticut',
  'Ole Miss Rebels': 'Mississippi',
  'Pitt Panthers': 'Pittsburgh',
  'Cal Bears': 'California',
  'USC Trojans': 'Southern California',
  'LSU Tigers': 'LSU',
  'SMU Mustangs': 'SMU',
  'TCU Horned Frogs': 'TCU',
  'UCF Knights': 'UCF',
  'BYU Cougars': 'BYU',
  'VCU Rams': 'VCU',
  'UTEP Miners': 'UTEP',
  'UTSA Roadrunners': 'UTSA',
  'UAB Blazers': 'UAB',
  'UMass Minutemen': 'Massachusetts',
  'UIC Flames': 'Illinois-Chicago',
  'UMBC Retrievers': 'UMBC',
  'SIUE Cougars': 'SIU Edwardsville',
  'SIU Edwardsville Cougars': 'SIU Edwardsville',
  'LIU Sharks': 'Long Island University',
  'FIU Panthers': 'FIU',
  'FDU Knights': 'Fairleigh Dickinson',
  'ETSU Buccaneers': 'East Tennessee State',
  'MTSU Blue Raiders': 'Middle Tennessee',
  'FGCU Eagles': 'Florida Gulf Coast',
  'UNCG Spartans': 'UNC Greensboro',
  'UNCW Seahawks': 'UNC Wilmington',
  'UNCA Bulldogs': 'UNC Asheville',

  // Saint vs St variations
  "Saint Joseph's Hawks": "Saint Joseph's",
  "St. John's Red Storm": "St. John's",
  "Saint Mary's Gaels": "Saint Mary's",
  "St. Bonaventure Bonnies": "St. Bonaventure",
  "Saint Peter's Peacocks": "Saint Peter's",
  "Saint Louis Billikens": "Saint Louis",
  "St. Thomas Tommies": "St. Thomas",

  // State/location variations
  'Miami Hurricanes': 'Miami',
  'Miami (FL) Hurricanes': 'Miami',
  'Miami (OH) RedHawks': 'Miami (OH)',
  'Texas A&M Aggies': 'Texas A&M',

  // Direction prefix variations
  'N. Colorado Bears': 'Northern Colorado',
  'N. Kentucky Norse': 'Northern Kentucky',
  'N. Arizona Lumberjacks': 'Northern Arizona',
  'N. Iowa Panthers': 'Northern Iowa',
  'N. Illinois Huskies': 'Northern Illinois',
  'S. Carolina Gamecocks': 'South Carolina',
  'S. Florida Bulls': 'South Florida',
  'S. Illinois Salukis': 'Southern Illinois',
  'S. Alabama Jaguars': 'South Alabama',
  'S. Miss Golden Eagles': 'Southern Miss',
  'W. Virginia Mountaineers': 'West Virginia',
  'W. Kentucky Hilltoppers': 'Western Kentucky',
  'W. Michigan Broncos': 'Western Michigan',
  'W. Illinois Leathernecks': 'Western Illinois',
  'E. Carolina Pirates': 'East Carolina',
  'E. Michigan Eagles': 'Eastern Michigan',
  'E. Kentucky Colonels': 'Eastern Kentucky',
  'E. Illinois Panthers': 'Eastern Illinois',
  'E. Washington Eagles': 'Eastern Washington',
  'C. Michigan Chippewas': 'Central Michigan',
  'C. Florida Knights': 'UCF',
  'C. Arkansas Bears': 'Central Arkansas',
  'C. Connecticut Blue Devils': 'Central Connecticut',

  // Other variations
  'CSUN Matadors': 'Cal State Northridge',
  'CS Fullerton Titans': 'Cal State Fullerton',
  'CS Bakersfield Roadrunners': 'Cal State Bakersfield',
  'CSU Northridge Matadors': 'Cal State Northridge',
  'San Jose State Spartans': 'San José State',
  'Loyola Chicago Ramblers': 'Loyola Chicago',
  'Loyola Marymount Lions': 'Loyola Marymount',
  'Loyola (MD) Greyhounds': 'Loyola (MD)',
  'UT Arlington Mavericks': 'UT Arlington',
  'UT Martin Skyhawks': 'UT Martin',
  'UT Rio Grande Valley Vaqueros': 'UTRGV',
  'Texas State Bobcats': 'Texas State',
  'Texas Southern Tigers': 'Texas Southern',
  'Texas-San Antonio Roadrunners': 'UTSA',
  'Green Bay Phoenix': 'Green Bay',
  'Little Rock Trojans': 'Little Rock',
  'Arkansas State Red Wolves': 'Arkansas State',
  'Arkansas Pine Bluff Golden Lions': 'Arkansas-Pine Bluff',
  'Kansas City Roos': 'UMKC',
  'UL Monroe Warhawks': 'Louisiana-Monroe',
  'Louisiana Ragin Cajuns': 'Louisiana',
  'LA Tech Bulldogs': 'Louisiana Tech',
  'SE Louisiana Lions': 'Southeastern Louisiana',
  'SE Missouri State Redhawks': 'Southeast Missouri State',
  'SW Missouri State Bears': 'Missouri State',
  'Missouri State Bears': 'Missouri State',
  'Milwaukee Panthers': 'Milwaukee',
  'Omaha Mavericks': 'Nebraska Omaha',
  'IUPUI Jaguars': 'IUPUI',
  'Grand Canyon Antelopes': 'Grand Canyon',
  'Abilene Christian Wildcats': 'Abilene Christian',
  'Sam Houston Bearkats': 'Sam Houston',
  'Sam Houston State Bearkats': 'Sam Houston',
  'Stephen F. Austin Lumberjacks': 'Stephen F. Austin',
  'Tarleton State Texans': 'Tarleton State',
  'Seattle Redhawks': 'Seattle',
  'Portland Pilots': 'Portland',
  'Gonzaga Bulldogs': 'Gonzaga',

  // Single-word mascot teams (Ivy League, etc.)
  'Harvard Crimson': 'Harvard',
  'Cornell Big Red': 'Cornell',
  'Pennsylvania Quakers': 'Pennsylvania',
  'Dartmouth Big Green': 'Dartmouth',
  'Columbia Lions': 'Columbia',
  'Yale Bulldogs': 'Yale',
  'Princeton Tigers': 'Princeton',
  'Brown Bears': 'Brown',

  // State mascot teams
  'Alabama Crimson Tide': 'Alabama',
  'Tennessee Volunteers': 'Tennessee',
  'Florida Gators': 'Florida',
  'Kentucky Wildcats': 'Kentucky',
  'Georgia Bulldogs': 'Georgia',
  'Auburn Tigers': 'Auburn',
  'Minnesota Golden Gophers': 'Minnesota',
  'Michigan Wolverines': 'Michigan',
  'Ohio State Buckeyes': 'Ohio State',
  'Indiana Hoosiers': 'Indiana',
  'Illinois Fighting Illini': 'Illinois',
  'Iowa Hawkeyes': 'Iowa',
  'Wisconsin Badgers': 'Wisconsin',
  'Purdue Boilermakers': 'Purdue',
  'Northwestern Wildcats': 'Northwestern',
  'Nebraska Cornhuskers': 'Nebraska',
  'Maryland Terrapins': 'Maryland',
  'Rutgers Scarlet Knights': 'Rutgers',
  'Penn State Nittany Lions': 'Penn State',

  // Misc unmatched
  'George Mason Patriots': 'George Mason',
  'Marquette Golden Eagles': 'Marquette',
  'Notre Dame Fighting Irish': 'Notre Dame',
  'American Eagles': 'American',
  'Stetson Hatters': 'Stetson',
  'Le Moyne Dolphins': 'Le Moyne',
  'Sacred Heart Pioneers': 'Sacred Heart',
  'New Orleans Privateers': 'New Orleans',

  // St/State abbreviation variations
  'Northwestern St Demons': 'Northwestern State',
  'Houston Baptist Huskies': 'Houston Christian',
  'Miss Valley St Delta Devils': 'Mississippi Valley State',
  'Central Connecticut St Blue Devils': 'Central Connecticut',
  'Chicago St Cougars': 'Chicago State',
  'Alabama St Hornets': 'Alabama State',
  'Nicholls St Colonels': 'Nicholls',
  'Grambling St Tigers': 'Grambling',
  'Alcorn St Braves': 'Alcorn State',
  'Jackson St Tigers': 'Jackson State',
  'Southern U Jaguars': 'Southern',
  'Coppin St Eagles': 'Coppin State',
  'Morgan St Bears': 'Morgan State',
  'Norfolk St Spartans': 'Norfolk State',
  'Delaware St Hornets': 'Delaware State',
  'SC State Bulldogs': 'South Carolina State',
  'NC A&T Aggies': 'North Carolina A&T',
  'NC Central Eagles': 'North Carolina Central',
  'McNeese Cowboys': 'McNeese',
  'McNeese St Cowboys': 'McNeese',

  // A&M/HBCU schools
  'Prairie View Panthers': 'Prairie View A&M',
  'Arkansas-Pine Bluff Golden Lions': 'Arkansas-Pine Bluff',
  'Florida A&M Rattlers': 'Florida A&M',
  'Bethune-Cookman Wildcats': 'Bethune-Cookman',
  'Texas A&M-CC Islanders': 'Texas A&M-Corpus Christi',

  // St. Francis variants
  'St. Francis (PA) Red Flash': 'St. Francis (PA)',
  'St. Francis Brooklyn Terriers': 'St. Francis Brooklyn',

  // More mascot-based teams
  'Villanova Wildcats': 'Villanova',
  'Duke Blue Devils': 'Duke',
  'Kansas Jayhawks': 'Kansas',
  'Baylor Bears': 'Baylor',
  'Houston Cougars': 'Houston',
  'Arizona Wildcats': 'Arizona',
  'Arizona State Sun Devils': 'Arizona State',
  'Colorado Buffaloes': 'Colorado',
  'Utah Utes': 'Utah',
  'Oregon Ducks': 'Oregon',
  'Oregon State Beavers': 'Oregon State',
  'Washington Huskies': 'Washington',
  'Washington State Cougars': 'Washington State',
  'Stanford Cardinal': 'Stanford',
  'UCLA Bruins': 'UCLA',
  'Creighton Bluejays': 'Creighton',
  'Xavier Musketeers': 'Xavier',
  'Butler Bulldogs': 'Butler',
  'Providence Friars': 'Providence',
  'Seton Hall Pirates': 'Seton Hall',
  'Georgetown Hoyas': 'Georgetown',
  'DePaul Blue Demons': 'DePaul',

  // More conference schools
  'Syracuse Orange': 'Syracuse',
  'Louisville Cardinals': 'Louisville',
  'Virginia Cavaliers': 'Virginia',
  'Virginia Tech Hokies': 'Virginia Tech',
  'Wake Forest Demon Deacons': 'Wake Forest',
  'Clemson Tigers': 'Clemson',
  'Florida State Seminoles': 'Florida State',
  'Boston College Eagles': 'Boston College',
  'Georgia Tech Yellow Jackets': 'Georgia Tech',
  'North Carolina Tar Heels': 'North Carolina',

  // AAC/Big 12 expansion
  'Cincinnati Bearcats': 'Cincinnati',
  'Memphis Tigers': 'Memphis',
  'Tulane Green Wave': 'Tulane',
  'Tulsa Golden Hurricane': 'Tulsa',
  'Temple Owls': 'Temple',
  'East Carolina Pirates': 'East Carolina',
  'Wichita State Shockers': 'Wichita State',

  // MWC
  'San Diego State Aztecs': 'San Diego State',
  'Nevada Wolf Pack': 'Nevada',
  'UNLV Rebels': 'UNLV',
  'Fresno State Bulldogs': 'Fresno State',
  'Boise State Broncos': 'Boise State',
  'Colorado State Rams': 'Colorado State',
  'Wyoming Cowboys': 'Wyoming',
  'Air Force Falcons': 'Air Force',
  'New Mexico Lobos': 'New Mexico',
  'Utah State Aggies': 'Utah State',

  // SEC extras
  'Mississippi State Bulldogs': 'Mississippi State',
  'Vanderbilt Commodores': 'Vanderbilt',
  'Missouri Tigers': 'Missouri',
  'Texas Longhorns': 'Texas',
  'Oklahoma Sooners': 'Oklahoma',
  'Oklahoma State Cowboys': 'Oklahoma State',
  'Kansas State Wildcats': 'Kansas State',
  'Iowa State Cyclones': 'Iowa State',
  'Texas Tech Red Raiders': 'Texas Tech',
  'West Virginia Mountaineers': 'West Virginia',

  // Others that may appear
  'Dayton Flyers': 'Dayton',
  'Davidson Wildcats': 'Davidson',
  'Richmond Spiders': 'Richmond',
  'Rhode Island Rams': 'Rhode Island',
  'George Washington Colonials': 'George Washington',
  'St. Louis Billikens': 'Saint Louis',
  'Massachusetts Minutemen': 'Massachusetts',
  'La Salle Explorers': 'La Salle',
  'Duquesne Dukes': 'Duquesne',
  'Fordham Rams': 'Fordham',

  // Univ. abbreviation
  'Boston Univ. Terriers': 'Boston University',

  // River Hawks etc. mascots
  'UMass Lowell River Hawks': 'UMass Lowell',
  'Marist Red Foxes': 'Marist',
  'Lehigh Mountain Hawks': 'Lehigh',
  'Maine Black Bears': 'Maine',
  'Drexel Dragons': 'Drexel',
  'Fort Wayne Mastodons': 'Purdue Fort Wayne',
  'Valparaiso Beacons': 'Valparaiso',
  'Charleston Southern Buccaneers': 'Charleston Southern',
  'Presbyterian Blue Hose': 'Presbyterian',
  'VMI Keydets': 'VMI',
  'Albany Great Danes': 'Albany',
  'Evansville Purple Aces': 'Evansville',
  'North Florida Ospreys': 'North Florida',
  'Campbell Fighting Camels': 'Campbell',
  'Idaho State Bengals': 'Idaho State',
  'Cal Golden Bears': 'California',
  'California Golden Bears': 'California',

  // St abbreviation (without period)
  'Oklahoma St Cowboys': 'Oklahoma State',
  'Arizona St Sun Devils': 'Arizona State',
  'Oregon St Beavers': 'Oregon State',
  'Murray St Racers': 'Murray State',
  'Kennesaw St Owls': 'Kennesaw State',
  'New Mexico St Aggies': 'New Mexico State',
  'Sam Houston St Bearkats': 'Sam Houston',
  'Cleveland St Vikings': 'Cleveland State',
  'Wichita St Shockers': 'Wichita State',
  'Illinois St Redbirds': 'Illinois State',
  'Indiana St Sycamores': 'Indiana State',
  'Kansas St Wildcats': 'Kansas State',
  'Michigan St Spartans': 'Michigan State',
  'Ohio St Buckeyes': 'Ohio State',
  'Penn St Nittany Lions': 'Penn State',
  'Fresno St Bulldogs': 'Fresno State',
  'Boise St Broncos': 'Boise State',
  'Colorado St Rams': 'Colorado State',
  'San Diego St Aztecs': 'San Diego State',
  'Utah St Aggies': 'Utah State',
  'San Jose St Spartans': 'San José State',
  'Florida St Seminoles': 'Florida State',
  'Mississippi St Bulldogs': 'Mississippi State',
  'Iowa St Cyclones': 'Iowa State',
  'Ball St Cardinals': 'Ball State',
  'Bowling Green Falcons': 'Bowling Green',
  'Kent St Golden Flashes': 'Kent State',
  'Toledo Rockets': 'Toledo',
  'Akron Zips': 'Akron',
  'Weber St Wildcats': 'Weber State',
  'Portland St Vikings': 'Portland State',
  'Sacramento St Hornets': 'Sacramento State',
  'Montana St Bobcats': 'Montana State',
  'Idaho St Bengals': 'Idaho State',
  'Northern Arizona Lumberjacks': 'Northern Arizona',
  'Southern Utah Thunderbirds': 'Southern Utah',

  // CSU variations
  'CSU Fullerton Titans': 'Cal State Fullerton',
  'CSU Bakersfield Roadrunners': 'Cal State Bakersfield',
  'CSU Northridge Matadors': 'Cal State Northridge',

  // Loyola variations
  'Loyola Maryland Greyhounds': 'Loyola (MD)',

  // More teams that appeared
  'Arkansas Razorbacks': 'Arkansas',
  'Austin Peay Governors': 'Austin Peay',
  'Long Beach St 49ers': 'Long Beach State',
  'North Dakota Fighting Hawks': 'North Dakota',
  'North Dakota St Bison': 'North Dakota State',
  'South Carolina Gamecocks': 'South Carolina',
  'San José St Spartans': 'San José State',
  'UMKC Kangaroos': 'Kansas City',

  // Fixed team name variations
  'Albany Great Danes': 'UAlbany',
  'American Eagles': 'American University',
  'Loyola (MD) Greyhounds': 'Loyola Maryland',
  'Loyola Maryland Greyhounds': 'Loyola Maryland',
};

async function reconcile() {
  console.log('========================================');
  console.log('  Reconcile Unmatched Team Names');
  console.log('========================================\n');

  // Load all CBBD teams
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name');

  const teamsByName = new Map<string, string>();
  for (const t of teams || []) {
    teamsByName.set(t.name.toLowerCase(), t.id);
  }

  console.log(`Loaded ${teams?.length || 0} CBBD teams\n`);

  // Load unmatched team names
  const { data: unmatched } = await supabase
    .from('cbb_unmatched_team_names')
    .select('id, team_name')
    .eq('resolved', false);

  console.log(`Found ${unmatched?.length || 0} unmatched team names\n`);

  let resolved = 0;
  let stillUnmatched = 0;
  const stillUnmatchedNames: string[] = [];

  for (const u of unmatched || []) {
    const oddsApiName = u.team_name;

    // Check if in KNOWN_MAPPINGS
    const cbbdName = KNOWN_MAPPINGS[oddsApiName];

    if (cbbdName) {
      // Find the team ID
      const teamId = teamsByName.get(cbbdName.toLowerCase());

      if (teamId) {
        // Update team's odds_api_name
        await supabase
          .from('cbb_teams')
          .update({ odds_api_name: oddsApiName })
          .eq('id', teamId);

        // Add to mappings table
        await supabase
          .from('cbb_team_name_mappings')
          .upsert({
            source_name: oddsApiName,
            source_type: 'odds_api',
            team_id: teamId,
          }, { onConflict: 'source_name,source_type' });

        // Mark as resolved
        await supabase
          .from('cbb_unmatched_team_names')
          .update({ resolved: true, resolved_team_id: teamId, resolved_at: new Date().toISOString() })
          .eq('id', u.id);

        resolved++;
        console.log(`  ✓ ${oddsApiName} → ${cbbdName}`);
      } else {
        stillUnmatched++;
        stillUnmatchedNames.push(`${oddsApiName} (mapped to "${cbbdName}" but team not found)`);
      }
    } else {
      stillUnmatched++;
      stillUnmatchedNames.push(oddsApiName);
    }
  }

  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`Resolved: ${resolved}`);
  console.log(`Still unmatched: ${stillUnmatched}`);

  if (stillUnmatchedNames.length > 0) {
    console.log('\n--- Still Unmatched ---');
    for (const name of stillUnmatchedNames.sort()) {
      console.log(`  ${name}`);
    }
  }

  // Final counts
  const { count: totalMappings } = await supabase
    .from('cbb_team_name_mappings')
    .select('*', { count: 'exact', head: true });

  const { count: teamsWithOddsName } = await supabase
    .from('cbb_teams')
    .select('*', { count: 'exact', head: true })
    .not('odds_api_name', 'is', null);

  const { count: remainingUnmatched } = await supabase
    .from('cbb_unmatched_team_names')
    .select('*', { count: 'exact', head: true })
    .eq('resolved', false);

  console.log('\n--- Database State ---');
  console.log(`Teams with odds_api_name: ${teamsWithOddsName}`);
  console.log(`Total explicit mappings: ${totalMappings}`);
  console.log(`Remaining unmatched: ${remainingUnmatched}`);
}

reconcile().catch(console.error);
