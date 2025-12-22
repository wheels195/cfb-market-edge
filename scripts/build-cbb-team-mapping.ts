/**
 * Build CBB Team Name Mapping (Strict)
 *
 * Creates explicit mappings between Odds API team names and CBBD teams.
 * NO fuzzy matching in production - only explicit mappings.
 *
 * Strategy:
 * 1. Fetch sample Odds API names
 * 2. Apply hardcoded known mappings
 * 3. For remaining, attempt exact normalized match (one-time setup only)
 * 4. Log unmatched for manual review
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY!;
const BASE_URL = 'https://api.the-odds-api.com/v4';

// EXPLICIT KNOWN MAPPINGS - Odds API name → CBBD name
// These are hardcoded because they can't be derived algorithmically
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
  'NC State Wolfpack': 'North Carolina State',
  'Florida St Seminoles': 'Florida State',
  'Mississippi St Bulldogs': 'Mississippi State',
  'Iowa St Cyclones': 'Iowa State',
  'Texas Tech Red Raiders': 'Texas Tech',
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

  // Loyola variations - use actual CBBD name
  'Loyola (MD) Greyhounds': 'Loyola Maryland',
  'Loyola Maryland Greyhounds': 'Loyola Maryland',

  // Fixed CBBD name variations
  'Albany Great Danes': 'UAlbany',
  'American Eagles': 'American University',
  'UMKC Kangaroos': 'Kansas City',

  // Full directional names (in addition to abbreviated versions)
  'Eastern Michigan Eagles': 'Eastern Michigan',
  'Western Michigan Broncos': 'Western Michigan',
  'Central Michigan Chippewas': 'Central Michigan',
  'Northern Illinois Huskies': 'Northern Illinois',
  'Northern Iowa Panthers': 'Northern Iowa',
  'Southern Illinois Salukis': 'Southern Illinois',
  'East Tennessee St Buccaneers': 'East Tennessee State',
  'East Tennessee State Buccaneers': 'East Tennessee State',
  'Western Carolina Catamounts': 'Western Carolina',
  'Western Kentucky Hilltoppers': 'Western Kentucky',

  // Full "State" names (in addition to "St" abbreviations)
  'Ball State Cardinals': 'Ball State',
  'Kent State Golden Flashes': 'Kent State',
  'South Carolina State Bulldogs': 'South Carolina State',
  'South Carolina St Bulldogs': 'South Carolina State',
  'North Carolina Central Eagles': 'North Carolina Central',
  'Florida Gulf Coast Eagles': 'Florida Gulf Coast',

  // More HBCU/smaller schools
  'Northeastern Huskies': 'Northeastern',
  'Howard Bison': 'Howard',
  'Maryland-Eastern Shore Hawks': 'Maryland-Eastern Shore',
  'Texas A&M-Commerce Lions': 'Texas A&M-Commerce',
  'Ohio Bobcats': 'Ohio',
  'Buffalo Bulls': 'Buffalo',
  'Army Knights': 'Army',
  'Navy Midshipmen': 'Navy',
  'Youngstown St Penguins': 'Youngstown State',
  'Youngstown State Penguins': 'Youngstown State',
  'Bucknell Bison': 'Bucknell',
  'Lafayette Leopards': 'Lafayette',
  'Holy Cross Crusaders': 'Holy Cross',
  'Queens University Royals': 'Queens',
  'The Citadel Bulldogs': 'Citadel',
  'Marshall Thundering Herd': 'Marshall',
  'Georgia Southern Eagles': 'Georgia Southern',
  'High Point Panthers': 'High Point',
  'Liberty Flames': 'Liberty',
  'Jacksonville St Gamecocks': 'Jacksonville State',
  'Jacksonville State Gamecocks': 'Jacksonville State',
  'Wofford Terriers': 'Wofford',
  'Mercer Bears': 'Mercer',
  'Oakland Golden Grizzlies': 'Oakland',
  'Winthrop Eagles': 'Winthrop',
  'Robert Morris Colonials': 'Robert Morris',
  'Wright St Raiders': 'Wright State',
  'Wright State Raiders': 'Wright State',
  'Belmont Bruins': 'Belmont',
  'Missouri St Bears': 'Missouri State',
  'Troy Trojans': 'Troy',
  "Louisiana Ragin' Cajuns": 'Louisiana',
  'Louisiana Ragin Cajuns': 'Louisiana',
  'Washington St Cougars': 'Washington State',

  // Remaining unmatched (from build script output)
  'Denver Pioneers': 'Denver',
  'Seattle Redhawks': 'Seattle',
  'SIU-Edwardsville Cougars': 'SIU Edwardsville',
  'Siena Saints': 'Siena',
  'Canisius Golden Griffins': 'Canisius',
  'Rider Broncs': 'Rider',
  'Utah Tech Trailblazers': 'Utah Tech',
  'Oral Roberts Golden Eagles': 'Oral Roberts',
  'UT-Arlington Mavericks': 'UT Arlington',
  'Appalachian St Mountaineers': 'Appalachian State',
  'Appalachian State Mountaineers': 'Appalachian State',
  'Delaware Blue Hens': 'Delaware',
  'William & Mary Tribe': 'William & Mary',
  "Florida Int'l Golden Panthers": 'FIU',
  'Middle Tennessee Blue Raiders': 'Middle Tennessee',
  'Arkansas-Little Rock Trojans': 'Little Rock',
  'Morehead St Eagles': 'Morehead State',
  'Morehead State Eagles': 'Morehead State',
  'Georgia St Panthers': 'Georgia State',
  'Georgia State Panthers': 'Georgia State',
  'South Dakota St Jackrabbits': 'South Dakota State',
  'South Dakota State Jackrabbits': 'South Dakota State',
  'South Dakota Coyotes': 'South Dakota',
  'Arkansas St Red Wolves': 'Arkansas State',
  'SE Missouri St Redhawks': 'Southeast Missouri State',
  'Tenn-Martin Skyhawks': 'UT Martin',
  'Southern Indiana Screaming Eagles': 'Southern Indiana',
  'Southern Miss Golden Eagles': 'Southern Miss',
  'Tennessee Tech Golden Eagles': 'Tennessee Tech',
  'Lipscomb Bisons': 'Lipscomb',
  'Cal Baptist Lancers': 'California Baptist',
  "Hawai'i Rainbow Warriors": 'Hawaii',
  'Hawaii Rainbow Warriors': 'Hawaii',
  'Loyola (Chi) Ramblers': 'Loyola Chicago',

  // Final unmatched batch
  'N Colorado Bears': 'Northern Colorado',
  'UC San Diego Tritons': 'UC San Diego',
  "Mt. St. Mary's Mountaineers": "Mount St. Mary's",
  'Longwood Lancers': 'Longwood',
  'Stony Brook Seawolves': 'Stony Brook',
  'UNC Asheville Bulldogs': 'UNC Asheville',
  'USC Upstate Spartans': 'USC Upstate',
  'UT San Antonio Roadrunners': 'UTSA',
  'Northern Kentucky Norse': 'Northern Kentucky',
  'Northern Colorado Bears': 'Northern Colorado',

  // From 2023-24 season sync
  'Detroit Mercy Titans': 'Detroit Mercy',
  'Niagara Purple Eagles': 'Niagara',
  "St. Thomas (MN) Tommies": "St. Thomas",
  'Bellarmine Knights': 'Bellarmine',
  'Seattle Redhawks': 'Seattle',
  'Omaha Mavericks': 'Nebraska Omaha',
  'Jacksonville Dolphins': 'Jacksonville',
  'Rice Owls': 'Rice',
  'Montana Grizzlies': 'Montana',
  'Tennessee St Tigers': 'Tennessee State',
  'Tennessee State Tigers': 'Tennessee State',
};

interface CBBDTeam {
  id: string;
  name: string;
  cbbd_team_id: number;
  odds_api_name: string | null;
}

async function fetchOddsApiTeamNames(): Promise<Set<string>> {
  console.log('Fetching sample Odds API team names...\n');

  const teamNames = new Set<string>();

  // First try LIVE API (doesn't use historical credits)
  console.log('Trying live API (no historical credits)...');
  try {
    const liveUrl = new URL(`${BASE_URL}/sports/basketball_ncaab/odds`);
    liveUrl.searchParams.set('apiKey', ODDS_API_KEY);
    liveUrl.searchParams.set('regions', 'us');
    liveUrl.searchParams.set('markets', 'spreads');

    const liveResponse = await fetch(liveUrl.toString());
    if (liveResponse.ok) {
      const liveData = await liveResponse.json();
      for (const event of liveData || []) {
        teamNames.add(event.home_team);
        teamNames.add(event.away_team);
      }
      console.log(`  Live API: Found ${liveData?.length || 0} events, ${teamNames.size} unique teams`);
    } else {
      console.log(`  Live API: HTTP ${liveResponse.status}`);
    }
  } catch (e) {
    console.log(`  Live API: Error - ${e}`);
  }

  // Then try historical dates
  console.log('\nTrying historical API...');
  const sampleDates = [
    '2024-01-15T20:00:00Z',
    '2024-02-15T20:00:00Z',
    '2024-03-15T20:00:00Z',
    '2023-01-15T20:00:00Z',
    '2023-02-15T20:00:00Z',
    '2022-12-15T20:00:00Z',
  ];

  for (const date of sampleDates) {
    try {
      const url = new URL(`${BASE_URL}/historical/sports/basketball_ncaab/odds`);
      url.searchParams.set('apiKey', ODDS_API_KEY);
      url.searchParams.set('regions', 'us');
      url.searchParams.set('markets', 'spreads');
      url.searchParams.set('date', date);

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.log(`  ${date}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      for (const event of data.data || []) {
        teamNames.add(event.home_team);
        teamNames.add(event.away_team);
      }

      console.log(`  ${date}: Found ${data.data?.length || 0} events`);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`  ${date}: Error - ${e}`);
    }
  }

  console.log(`\nTotal unique Odds API team names: ${teamNames.size}\n`);
  return teamNames;
}

async function loadCBBDTeams(): Promise<CBBDTeam[]> {
  const { data: teams, error } = await supabase
    .from('cbb_teams')
    .select('id, name, cbbd_team_id, odds_api_name');

  if (error) throw error;
  return teams || [];
}

function stripMascot(name: string): string {
  // Common mascots to strip
  const mascots = [
    'Bulldogs', 'Wildcats', 'Tigers', 'Bears', 'Lions', 'Eagles', 'Hawks',
    'Panthers', 'Cardinals', 'Devils', 'Blue Devils', 'Demons', 'Warriors',
    'Knights', 'Cavaliers', 'Huskies', 'Terrapins', 'Longhorns', 'Sooners',
    'Buckeyes', 'Wolverines', 'Spartans', 'Hoosiers', 'Boilermakers', 'Badgers',
    'Gophers', 'Hawkeyes', 'Cyclones', 'Jayhawks', 'Mountaineers', 'Cowboys',
    'Raiders', 'Red Raiders', 'Aggies', 'Horned Frogs', 'Mustangs', 'Cougars',
    'Ducks', 'Beavers', 'Bruins', 'Trojans', 'Sun Devils', 'Utes', 'Buffaloes',
    'Rams', 'Falcons', 'Broncos', 'Aztecs', 'Rebels', 'Wolf Pack', 'Wolfpack',
    'Rainbow Warriors', 'Owls', 'Mean Green', 'Blazers', 'Hilltoppers',
    'Red Wolves', 'Braves', 'Flames', 'Thundering Herd', 'Rockets', 'RedHawks',
    'Redhawks', 'Zips', 'Bobcats', 'Golden Flashes', 'Chippewas', 'Bulls',
    'Redbirds', 'Sycamores', 'Jaguars', 'Grizzlies', 'Vandals', 'Hornets',
    'Lumberjacks', 'Anteaters', 'Gauchos', 'Matadors', 'Titans', '49ers',
    'Highlanders', 'Toreros', 'Pilots', 'Waves', 'Gaels', 'Dons', 'Ramblers',
    'Phoenix', 'Peacocks', 'Bonnies', 'Friars', 'Hoyas', 'Musketeers',
    'Billikens', 'Flyers', 'Explorers', 'Colonials', 'Dukes', 'Spiders',
    'Monarchs', 'Pirates', 'Seahawks', 'Chanticleers', 'Paladins',
    'Catamounts', 'Retrievers', 'Terriers', 'Greyhounds', 'Jaspers',
    'Gaels', 'Stags', 'Seawolves', 'Pride', 'Great Danes', 'River Hawks',
    'Bearcats', 'Penguins', 'Golden Eagles', 'Shockers', 'Salukis',
    'Leathernecks', 'Braves', 'Bison', 'Mastodons', 'Kangaroos', 'Norse',
    'Flames', 'Penguins', 'Lakers', 'Tommies', 'Mocs', 'Vaqueros',
    'Texans', 'Bearkats', 'Skyhawks', 'Warhawks', 'Cajuns', 'Colonels',
  ];

  let result = name;
  for (const mascot of mascots) {
    const regex = new RegExp(`\\s+${mascot}$`, 'i');
    result = result.replace(regex, '');
  }

  return result.trim();
}

async function main() {
  console.log('========================================');
  console.log('  CBB Team Name Mapping Builder');
  console.log('  (Strict - No Fuzzy Matching)');
  console.log('========================================\n');

  // Load CBBD teams
  const cbbdTeams = await loadCBBDTeams();
  console.log(`Loaded ${cbbdTeams.length} CBBD teams\n`);

  // Build lookup maps
  const cbbdByName = new Map<string, CBBDTeam>();
  const cbbdByNameLower = new Map<string, CBBDTeam>();

  for (const team of cbbdTeams) {
    cbbdByName.set(team.name, team);
    cbbdByNameLower.set(team.name.toLowerCase(), team);
  }

  // Fetch Odds API team names
  const oddsApiNames = await fetchOddsApiTeamNames();

  // Process mappings
  const mappingsToCreate: Array<{ oddsApiName: string; team: CBBDTeam; method: string }> = [];
  const alreadyMapped: string[] = [];
  const unmatched: string[] = [];

  for (const oddsApiName of oddsApiNames) {
    // Check if already has odds_api_name set
    const existingDirect = cbbdTeams.find(t => t.odds_api_name === oddsApiName);
    if (existingDirect) {
      alreadyMapped.push(oddsApiName);
      continue;
    }

    // 1. Check hardcoded mappings
    const mappedName = KNOWN_MAPPINGS[oddsApiName];
    if (mappedName) {
      const team = cbbdByName.get(mappedName) || cbbdByNameLower.get(mappedName.toLowerCase());
      if (team) {
        mappingsToCreate.push({ oddsApiName, team, method: 'hardcoded' });
        continue;
      }
    }

    // 2. Exact match by name (case-insensitive)
    const exactMatch = cbbdByNameLower.get(oddsApiName.toLowerCase());
    if (exactMatch) {
      mappingsToCreate.push({ oddsApiName, team: exactMatch, method: 'exact' });
      continue;
    }

    // 3. Match by school name (stripped mascot)
    const schoolName = stripMascot(oddsApiName);
    const schoolMatch = cbbdByNameLower.get(schoolName.toLowerCase());
    if (schoolMatch) {
      mappingsToCreate.push({ oddsApiName, team: schoolMatch, method: 'school-name' });
      continue;
    }

    // Not found
    unmatched.push(oddsApiName);
  }

  // Report results
  console.log('========================================');
  console.log('  Results');
  console.log('========================================');
  console.log(`Already mapped: ${alreadyMapped.length}`);
  console.log(`New mappings found: ${mappingsToCreate.length}`);
  console.log(`Unmatched: ${unmatched.length}\n`);

  // Show mappings by method
  const byMethod: Record<string, number> = {};
  for (const m of mappingsToCreate) {
    byMethod[m.method] = (byMethod[m.method] || 0) + 1;
  }
  console.log('Mappings by method:');
  for (const [method, count] of Object.entries(byMethod)) {
    console.log(`  ${method}: ${count}`);
  }

  // Show sample mappings
  console.log('\n--- Sample New Mappings ---');
  for (const m of mappingsToCreate.slice(0, 15)) {
    console.log(`  "${m.oddsApiName}" → "${m.team.name}" [${m.method}]`);
  }
  if (mappingsToCreate.length > 15) {
    console.log(`  ... and ${mappingsToCreate.length - 15} more`);
  }

  // Show unmatched
  if (unmatched.length > 0) {
    console.log('\n--- Unmatched (Need Manual Mapping) ---');
    for (const name of unmatched.slice(0, 30)) {
      console.log(`  "${name}"`);
    }
    if (unmatched.length > 30) {
      console.log(`  ... and ${unmatched.length - 30} more`);
    }
  }

  // Save mappings
  console.log('\n--- Saving Mappings ---');

  // Update odds_api_name on teams
  let savedOddsApiName = 0;
  let savedExplicitMapping = 0;

  for (const m of mappingsToCreate) {
    // Set odds_api_name on the team
    const { error: updateError } = await supabase
      .from('cbb_teams')
      .update({ odds_api_name: m.oddsApiName })
      .eq('id', m.team.id);

    if (!updateError) {
      savedOddsApiName++;
    }

    // Also add to explicit mapping table for redundancy
    const { error: mappingError } = await supabase
      .from('cbb_team_name_mappings')
      .upsert({
        source_name: m.oddsApiName,
        source_type: 'odds_api',
        team_id: m.team.id,
      }, { onConflict: 'source_name,source_type' });

    if (!mappingError) {
      savedExplicitMapping++;
    }
  }

  console.log(`Saved odds_api_name: ${savedOddsApiName}`);
  console.log(`Saved explicit mappings: ${savedExplicitMapping}`);

  // Log unmatched to database
  let loggedUnmatched = 0;
  for (const name of unmatched) {
    const { error } = await supabase
      .from('cbb_unmatched_team_names')
      .upsert({
        team_name: name,
        source: 'odds_api',
        resolved: false,
      }, { onConflict: 'team_name,source' });

    if (!error) loggedUnmatched++;
  }

  console.log(`Logged unmatched: ${loggedUnmatched}`);

  // ALSO save ALL hardcoded mappings (regardless of API response)
  console.log('\n--- Saving ALL Hardcoded Mappings ---');
  let savedHardcoded = 0;
  let skippedHardcoded = 0;

  for (const [oddsApiName, cbbdName] of Object.entries(KNOWN_MAPPINGS)) {
    const team = cbbdByName.get(cbbdName) || cbbdByNameLower.get(cbbdName.toLowerCase());
    if (!team) {
      skippedHardcoded++;
      continue;
    }

    // Add to explicit mapping table
    const { error: mappingError } = await supabase
      .from('cbb_team_name_mappings')
      .upsert({
        source_name: oddsApiName,
        source_type: 'odds_api',
        team_id: team.id,
      }, { onConflict: 'source_name,source_type' });

    if (!mappingError) {
      savedHardcoded++;
    }
  }

  console.log(`Saved hardcoded mappings: ${savedHardcoded}`);
  console.log(`Skipped (team not found): ${skippedHardcoded}`);

  // Summary
  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');
  const totalMapped = alreadyMapped.length + mappingsToCreate.length;
  console.log(`Total Odds API teams: ${oddsApiNames.size}`);
  console.log(`Successfully mapped: ${totalMapped}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log(`Match rate: ${(totalMapped / oddsApiNames.size * 100).toFixed(1)}%`);
  console.log(`Hardcoded mappings saved: ${savedHardcoded}`);

  if (unmatched.length > 0) {
    console.log('\n⚠️  ACTION REQUIRED: Add unmatched teams to KNOWN_MAPPINGS or resolve manually');
  }
}

main().catch(console.error);
