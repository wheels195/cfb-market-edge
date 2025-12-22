/**
 * CBB Team Logos utility using ESPN CDN
 * ESPN logo URL pattern: https://a.espncdn.com/i/teamlogos/ncaa/500/{espn_id}.png
 *
 * ESPN IDs are the same for schools that have both football and basketball
 */

// ESPN team ID mapping for D1 basketball teams
// These IDs match both football and basketball logos
const ESPN_CBB_TEAM_IDS: Record<string, number> = {
  // Top 25 programs + major conferences
  'Duke': 150,
  'Duke Blue Devils': 150,
  'North Carolina': 153,
  'North Carolina Tar Heels': 153,
  'UNC': 153,
  'Kentucky': 96,
  'Kentucky Wildcats': 96,
  'Kansas': 2305,
  'Kansas Jayhawks': 2305,
  'UCLA': 26,
  'UCLA Bruins': 26,
  'Gonzaga': 2250,
  'Gonzaga Bulldogs': 2250,
  'Villanova': 222,
  'UConn': 41,
  'Connecticut': 41,
  'Connecticut Huskies': 41,
  'Michigan State': 127,
  'Michigan State Spartans': 127,
  'Indiana': 84,
  'Indiana Hoosiers': 84,
  'Arizona': 12,
  'Arizona Wildcats': 12,
  'Louisville': 97,
  'Louisville Cardinals': 97,
  'Syracuse': 183,
  'Syracuse Orange': 183,

  // SEC
  'Alabama': 333,
  'Auburn': 2,
  'Auburn Tigers': 2,
  'Arkansas': 8,
  'Florida': 57,
  'Florida Gators': 57,
  'Georgia': 61,
  'LSU': 99,
  'Mississippi State': 344,
  'Missouri': 142,
  'Ole Miss': 145,
  'South Carolina': 2579,
  'Tennessee': 2633,
  'Tennessee Volunteers': 2633,
  'Texas': 251,
  'Texas Longhorns': 251,
  'Texas A&M': 245,
  'Oklahoma': 201,
  'Vanderbilt': 238,

  // Big Ten
  'Illinois': 356,
  'Illinois Fighting Illini': 356,
  'Iowa': 2294,
  'Iowa Hawkeyes': 2294,
  'Maryland': 120,
  'Michigan': 130,
  'Minnesota': 135,
  'Nebraska': 158,
  'Northwestern': 77,
  'Ohio State': 194,
  'Ohio State Buckeyes': 194,
  'Oregon': 2483,
  'Penn State': 213,
  'Purdue': 2509,
  'Purdue Boilermakers': 2509,
  'Rutgers': 164,
  'USC': 30,
  'Washington': 264,
  'Wisconsin': 275,

  // Big 12
  'Arizona State': 9,
  'Baylor': 239,
  'Baylor Bears': 239,
  'BYU': 252,
  'Brigham Young': 252,
  'Cincinnati': 2132,
  'Colorado': 38,
  'Houston': 248,
  'Houston Cougars': 248,
  'Iowa State': 66,
  'Iowa State Cyclones': 66,
  'Kansas State': 2306,
  'Oklahoma State': 197,
  'TCU': 2628,
  'Texas Tech': 2641,
  'Texas Tech Red Raiders': 2641,
  'UCF': 2116,
  'Utah': 254,
  'West Virginia': 277,

  // ACC
  'Boston College': 103,
  'California': 25,
  'Cal': 25,
  'Clemson': 228,
  'Florida State': 52,
  'Georgia Tech': 59,
  'Miami': 2390,
  'NC State': 152,
  'North Carolina State': 152,
  'Notre Dame': 87,
  'Pittsburgh': 221,
  'SMU': 2567,
  'Stanford': 24,
  'Virginia': 258,
  'Virginia Tech': 259,
  'Wake Forest': 154,

  // Big East
  'Butler': 2086,
  'Creighton': 156,
  'Creighton Bluejays': 156,
  'DePaul': 305,
  'Georgetown': 46,
  'Marquette': 269,
  'Marquette Golden Eagles': 269,
  'Providence': 2507,
  'Seton Hall': 2550,
  "St. John's": 2599,
  'St. Johns': 2599,
  'Xavier': 2752,

  // AAC
  'Charlotte': 2429,
  'East Carolina': 151,
  'FAU': 2226,
  'Florida Atlantic': 2226,
  'Memphis': 235,
  'Memphis Tigers': 235,
  'North Texas': 249,
  'Rice': 242,
  'South Florida': 58,
  'USF': 58,
  'Temple': 218,
  'Tulane': 2655,
  'Tulsa': 202,
  'UAB': 5,
  'UTSA': 2636,
  'Wichita State': 2724,
  'Wichita State Shockers': 2724,

  // Mountain West
  'Air Force': 2005,
  'Boise State': 68,
  'Colorado State': 36,
  'Fresno State': 278,
  'Nevada': 2440,
  'New Mexico': 167,
  'San Diego State': 21,
  'San Jose State': 23,
  'UNLV': 2439,
  'Utah State': 328,
  'Wyoming': 2751,

  // WCC (non-duplicates only)
  'Pepperdine': 2492,
  'Portland': 2504,
  "Saint Mary's": 2608,
  'San Diego': 2545,
  'San Francisco': 2539,
  'Santa Clara': 2541,
  'Pacific': 279,

  // A-10
  'Dayton': 2168,
  'Dayton Flyers': 2168,
  'Davidson': 2166,
  'Fordham': 2230,
  'George Mason': 2244,
  'George Washington': 45,
  'La Salle': 2325,
  'Massachusetts': 113,
  'UMass': 113,
  'Rhode Island': 227,
  'Richmond': 257,
  "Saint Joseph's": 2603,
  'Saint Louis': 139,
  'St. Bonaventure': 2066,
  'VCU': 2670,

  // Ivy League
  'Brown': 225,
  'Columbia': 171,
  'Cornell': 172,
  'Dartmouth': 159,
  'Harvard': 108,
  'Penn': 219,
  'Pennsylvania': 219,
  'Princeton': 163,
  'Yale': 43,

  // Additional D1 teams (partial list)
  'Akron': 2006,
  'Appalachian State': 2026,
  'Ball State': 2050,
  'Bowling Green': 189,
  'Buffalo': 2084,
  'Central Michigan': 2117,
  'Eastern Michigan': 2199,
  'Kent State': 2309,
  'Miami (OH)': 193,
  'Northern Illinois': 2459,
  'Ohio': 195,
  'Toledo': 2649,
  'Western Michigan': 2711,

  // Sun Belt
  'Arkansas State': 2032,
  'Coastal Carolina': 324,
  'Georgia Southern': 290,
  'Georgia State': 2247,
  'James Madison': 256,
  'Louisiana': 309,
  'Louisiana Monroe': 2433,
  'Marshall': 276,
  'Old Dominion': 295,
  'South Alabama': 6,
  'Southern Miss': 2572,
  'Texas State': 326,
  'Troy': 2653,

  // More programs
  'Belmont': 2057,
  'Drake': 2181,
  'Iona': 314,
  'Lipscomb': 288,
  'Loyola Chicago': 2350,
  'Murray State': 2413,
  'Northern Iowa': 2460,
  'Oral Roberts': 198,
  'UC Irvine': 300,
  'UC San Diego': 28,
  'UC Santa Barbara': 2540,
  'Vermont': 261,

  // C-USA
  'FIU': 2229,
  'Florida International': 2229,
  'Jacksonville State': 55,
  'Kennesaw State': 338,
  'Liberty': 2335,
  'Louisiana Tech': 2348,
  'Middle Tennessee': 2393,
  'New Mexico State': 166,
  'Sam Houston': 2534,
  'UTEP': 2638,
  'Western Kentucky': 98,

  // MVC (non-duplicates)
  'Bradley': 71,
  'Evansville': 339,
  'Illinois State': 2287,
  'Indiana State': 282,
  'Missouri State': 2623,
  'Southern Illinois': 79,
  'UIC': 82,
  'Valparaiso': 2674,

  // Horizon League
  'Cleveland State': 325,
  'Detroit Mercy': 2174,
  'Green Bay': 2739,
  'IUPUI': 85,
  'Milwaukee': 270,
  'Northern Kentucky': 94,
  'Oakland': 2473,
  'Wright State': 2750,
  'Youngstown State': 2754,

  // CAA
  'Campbell': 2097,
  'Charleston': 232,
  'Delaware': 48,
  'Drexel': 2182,
  'Elon': 2210,
  'Hampton': 2261,
  'Hofstra': 2275,
  'Monmouth': 2405,
  'NC A&T': 2448,
  'Northeastern': 111,
  'Stony Brook': 2619,
  'Towson': 119,
  'UNC Wilmington': 350,
  'William & Mary': 2729,

  // Army/Navy
  'Army': 349,
  'Navy': 2426,

  // MEAC/SWAC and others
  'Howard': 47,
  'Morgan State': 2410,
  'Norfolk State': 2450,

  // Northeast Conference
  'Central Connecticut': 2115,
  'Fairleigh Dickinson': 161,
  'LIU': 2344,
  'Merrimack': 2382,
  "Mount St. Mary's": 116,
  'Sacred Heart': 2529,
  'St. Francis (PA)': 2598,
  'Wagner': 2681,
};

const DEFAULT_LOGO = 'https://a.espncdn.com/i/teamlogos/ncaa/500/default-team-logo-500.png';

/**
 * Get ESPN logo URL for a CBB team
 */
export function getCbbTeamLogo(teamName: string): string {
  // Direct lookup
  const espnId = ESPN_CBB_TEAM_IDS[teamName];
  if (espnId) {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png`;
  }

  // Try normalizing
  const normalized = normalizeName(teamName);
  for (const [name, id] of Object.entries(ESPN_CBB_TEAM_IDS)) {
    if (normalizeName(name) === normalized) {
      return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
    }
  }

  return DEFAULT_LOGO;
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
export function hasCbbTeamLogo(teamName: string): boolean {
  return getCbbTeamLogo(teamName) !== DEFAULT_LOGO;
}
