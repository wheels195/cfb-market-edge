/**
 * Team logos utility using ESPN CDN
 * ESPN logo URL pattern: https://a.espncdn.com/i/teamlogos/ncaa/500/{espn_id}.png
 *
 * We map team names to ESPN IDs for reliable logo URLs
 */

// ESPN team ID mapping for FBS teams
// ESPN IDs can be found at https://www.espn.com/college-football/teams
// Includes both short names (CFBD) and full names with mascots (Odds API)
const ESPN_TEAM_IDS: Record<string, number> = {
  // SEC
  'Alabama': 333,
  'Alabama Crimson Tide': 333,
  'Arkansas': 8,
  'Auburn': 2,
  'Florida': 57,
  'Georgia': 61,
  'Georgia Bulldogs': 61,
  'Kentucky': 96,
  'LSU': 99,
  'LSU Tigers': 99,
  'Mississippi State': 344,
  'Mississippi State Bulldogs': 344,
  'Missouri': 142,
  'Missouri Tigers': 142,
  'Ole Miss': 145,
  'Ole Miss Rebels': 145,
  'Mississippi': 145,
  'South Carolina': 2579,
  'Tennessee': 2633,
  'Tennessee Volunteers': 2633,
  'Texas A&M': 245,
  'Texas A&M Aggies': 245,
  'Texas': 251,
  'Texas Longhorns': 251,
  'Oklahoma': 201,
  'Vanderbilt': 238,
  'Vanderbilt Commodores': 238,

  // Big Ten
  'Illinois': 356,
  'Illinois Fighting Illini': 356,
  'Indiana': 84,
  'Indiana Hoosiers': 84,
  'Iowa': 2294,
  'Iowa Hawkeyes': 2294,
  'Maryland': 120,
  'Michigan State': 127,
  'Michigan': 130,
  'Michigan Wolverines': 130,
  'Minnesota': 135,
  'Minnesota Golden Gophers': 135,
  'Nebraska': 158,
  'Nebraska Cornhuskers': 158,
  'Northwestern': 77,
  'Northwestern Wildcats': 77,
  'Ohio State': 194,
  'Ohio State Buckeyes': 194,
  'Oregon': 2483,
  'Oregon Ducks': 2483,
  'Penn State': 213,
  'Penn State Nittany Lions': 213,
  'Purdue': 2509,
  'Rutgers': 164,
  'UCLA': 26,
  'USC': 30,
  'USC Trojans': 30,
  'Washington': 264,
  'Washington State': 265,
  'Washington State Cougars': 265,
  'Wisconsin': 275,

  // Big 12
  'Arizona': 12,
  'Arizona Wildcats': 12,
  'Arizona State': 9,
  'Arizona State Sun Devils': 9,
  'Baylor': 239,
  'BYU': 252,
  'BYU Cougars': 252,
  'Brigham Young': 252,
  'Central Florida': 2116,
  'UCF': 2116,
  'Cincinnati': 2132,
  'Cincinnati Bearcats': 2132,
  'Colorado': 38,
  'Houston': 248,
  'Houston Cougars': 248,
  'Iowa State': 66,
  'Kansas': 2305,
  'Kansas State': 2306,
  'Oklahoma State': 197,
  'TCU': 2628,
  'TCU Horned Frogs': 2628,
  'Texas Christian': 2628,
  'Texas Tech': 2641,
  'Texas Tech Red Raiders': 2641,
  'Utah': 254,
  'Utah Utes': 254,
  'West Virginia': 277,

  // ACC
  'Boston College': 103,
  'California': 25,
  'California Golden Bears': 25,
  'Clemson': 228,
  'Clemson Tigers': 228,
  'Duke': 150,
  'Duke Blue Devils': 150,
  'Florida State': 52,
  'Georgia Tech': 59,
  'Georgia Tech Yellow Jackets': 59,
  'Louisville': 97,
  'Louisville Cardinals': 97,
  'Miami': 2390,
  'Miami Hurricanes': 2390,
  'NC State': 152,
  'North Carolina State': 152,
  'North Carolina': 153,
  'Pittsburgh': 221,
  'Pittsburgh Panthers': 221,
  'SMU': 2567,
  'SMU Mustangs': 2567,
  'Southern Methodist': 2567,
  'Stanford': 24,
  'Syracuse': 183,
  'Virginia': 258,
  'Virginia Cavaliers': 258,
  'Virginia Tech': 259,
  'Wake Forest': 154,
  'Wake Forest Demon Deacons': 154,

  // Mountain West
  'Air Force': 2005,
  'Boise State': 68,
  'Colorado State': 36,
  'Fresno State': 278,
  'Fresno State Bulldogs': 278,
  'Hawaii': 62,
  "Hawai'i": 62,
  'Hawaii Rainbow Warriors': 62,
  'Nevada': 2440,
  'New Mexico': 167,
  'New Mexico Lobos': 167,
  'San Diego State': 21,
  'San Diego State Aztecs': 21,
  'San Jose State': 23,
  'UNLV': 2439,
  'UNLV Rebels': 2439,
  'Utah State': 328,
  'Utah State Aggies': 328,
  'Wyoming': 2751,

  // MAC
  'Akron': 2006,
  'Ball State': 2050,
  'Bowling Green': 189,
  'Buffalo': 2084,
  'Central Michigan': 2117,
  'Central Michigan Chippewas': 2117,
  'Eastern Michigan': 2199,
  'Kent State': 2309,
  'Miami (OH)': 193,
  'Miami (OH) RedHawks': 193,
  'Miami OH': 193,
  'Northern Illinois': 2459,
  'Ohio': 195,
  'Ohio Bobcats': 195,
  'Toledo': 2649,
  'Toledo Rockets': 2649,
  'Western Michigan': 2711,

  // Sun Belt
  'App State': 2026,
  'Appalachian State': 2026,
  'Appalachian State Mountaineers': 2026,
  'Arkansas State': 2032,
  'Coastal Carolina': 324,
  'Coastal Carolina Chanticleers': 324,
  'Georgia Southern': 290,
  'Georgia Southern Eagles': 290,
  'Georgia State': 2247,
  'James Madison': 256,
  'James Madison Dukes': 256,
  'Louisiana': 309,
  'Louisiana Lafayette': 309,
  'Louisiana-Lafayette': 309,
  'Louisiana Monroe': 2433,
  'Louisiana-Monroe': 2433,
  'ULM': 2433,
  'Marshall': 276,
  'Old Dominion': 295,
  'South Alabama': 6,
  'Southern Miss': 2572,
  'Southern Mississippi': 2572,
  'Southern Mississippi Golden Eagles': 2572,
  'Texas State': 326,
  'Texas State Bobcats': 326,
  'Troy': 2653,

  // C-USA
  'Charlotte': 2429,
  'Florida Atlantic': 2226,
  'FIU': 2229,
  'Florida International': 2229,
  'Florida International Panthers': 2229,
  'Jacksonville State': 55,
  'Kennesaw State': 338,
  'Liberty': 2335,
  'Louisiana Tech': 2348,
  'Louisiana Tech Bulldogs': 2348,
  'Middle Tennessee': 2393,
  'New Mexico State': 166,
  'Sam Houston': 2534,
  'Sam Houston State': 2534,
  'UTEP': 2638,
  'Texas El Paso': 2638,
  'Western Kentucky': 98,
  'Western Kentucky Hilltoppers': 98,

  // American (AAC)
  'Army': 349,
  'Army Black Knights': 349,
  'East Carolina': 151,
  'East Carolina Pirates': 151,
  'Memphis': 235,
  'Navy': 2426,
  'Navy Midshipmen': 2426,
  'North Texas': 249,
  'North Texas Mean Green': 249,
  'Rice': 242,
  'Rice Owls': 242,
  'South Florida': 58,
  'USF': 58,
  'Temple': 218,
  'Tulane': 2655,
  'Tulane Green Wave': 2655,
  'Tulsa': 202,
  'UAB': 5,
  'UTSA': 2636,
  'UTSA Roadrunners': 2636,
  'Texas San Antonio': 2636,

  // Independents
  'Notre Dame': 87,
  'UConn': 41,
  'UConn Huskies': 41,
  'Connecticut': 41,
  'UMass': 113,
  'Massachusetts': 113,
};

// Default fallback - returns a generic football icon
const DEFAULT_LOGO = 'https://a.espncdn.com/i/teamlogos/ncaa/500/default-team-logo-500.png';

/**
 * Get ESPN logo URL for a team
 * @param teamName - The team name to look up
 * @returns ESPN CDN logo URL or default
 */
export function getTeamLogo(teamName: string): string {
  // Direct lookup
  const espnId = ESPN_TEAM_IDS[teamName];
  if (espnId) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
  }

  // Try normalizing the name
  const normalized = normalizeName(teamName);
  for (const [name, id] of Object.entries(ESPN_TEAM_IDS)) {
    if (normalizeName(name) === normalized) {
      return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
    }
  }

  // Fallback to generic
  return DEFAULT_LOGO;
}

/**
 * Get a smaller logo (for inline use)
 */
export function getTeamLogoSmall(teamName: string): string {
  const url = getTeamLogo(teamName);
  // ESPN also has 500 size, we'll use the same but could use different sizes
  return url.replace('/500/', '/500/');
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace('state', 'st')
    .replace('university', '');
}

/**
 * Check if we have a logo for this team
 */
export function hasTeamLogo(teamName: string): boolean {
  const logo = getTeamLogo(teamName);
  return logo !== DEFAULT_LOGO;
}
