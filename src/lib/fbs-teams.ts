/**
 * FBS Teams Filter
 *
 * Teams are considered FBS if they appear in The Odds API data.
 * This list is derived from T-60 matched games (2022-2024).
 */

// FBS teams extracted from Odds API matches
// A game is FBS if BOTH home and away teams are in this set
export const FBS_TEAMS = new Set([
  // ACC
  'Boston College', 'California', 'Clemson', 'Duke', 'Florida State',
  'Georgia Tech', 'Louisville', 'Miami', 'NC State', 'North Carolina',
  'Pittsburgh', 'SMU', 'Stanford', 'Syracuse', 'Virginia', 'Virginia Tech',
  'Wake Forest',

  // American
  'Army', 'Charlotte', 'East Carolina', 'FAU', 'Memphis', 'Navy',
  'North Texas', 'Rice', 'South Florida', 'Temple', 'Tulane', 'Tulsa',
  'UAB', 'UTSA',

  // Big 12
  'Arizona', 'Arizona State', 'Baylor', 'BYU', 'UCF', 'Cincinnati',
  'Colorado', 'Houston', 'Iowa State', 'Kansas', 'Kansas State',
  'Oklahoma State', 'TCU', 'Texas Tech', 'Utah', 'West Virginia',

  // Big Ten
  'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State',
  'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Oregon',
  'Penn State', 'Purdue', 'Rutgers', 'UCLA', 'USC', 'Washington', 'Wisconsin',

  // Conference USA
  'FIU', 'Florida International', 'Jacksonville State', 'Kennesaw State',
  'Liberty', 'Louisiana Tech', 'Middle Tennessee', 'New Mexico State',
  'Sam Houston', 'Sam Houston State', 'UTEP', 'Western Kentucky',

  // Independent
  'Notre Dame', 'UConn', 'UMass', 'Massachusetts',

  // MAC
  'Akron', 'Ball State', 'Bowling Green', 'Buffalo', 'Central Michigan',
  'Eastern Michigan', 'Kent State', 'Miami (OH)', 'Northern Illinois',
  'Ohio', 'Toledo', 'Western Michigan',

  // Mountain West
  'Air Force', 'Boise State', 'Colorado State', 'Fresno State', "Hawai'i",
  'Hawaii', 'Nevada', 'New Mexico', 'San Diego State', 'San José State',
  'San Jose State', 'UNLV', 'Utah State', 'Wyoming',

  // Pac-12 (remaining)
  'Oregon State', 'Washington State',

  // SEC
  'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky',
  'LSU', 'Mississippi State', 'Missouri', 'Oklahoma', 'Ole Miss',
  'South Carolina', 'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt',

  // Sun Belt
  'Appalachian State', 'App State', 'Arkansas State', 'Coastal Carolina',
  'Georgia Southern', 'Georgia State', 'James Madison', 'Louisiana',
  'Louisiana-Lafayette', 'Louisiana-Monroe', 'UL Monroe', 'Marshall',
  'Old Dominion', 'South Alabama', 'Southern Miss', 'Southern Mississippi',
  'Texas State', 'Troy',
]);

/**
 * Check if a game is FBS (both teams are FBS)
 */
export function isFBSGame(homeTeam: string, awayTeam: string): boolean {
  return FBS_TEAMS.has(homeTeam) && FBS_TEAMS.has(awayTeam);
}

/**
 * Check if a team is FBS
 */
export function isFBSTeam(teamName: string): boolean {
  return FBS_TEAMS.has(teamName);
}
