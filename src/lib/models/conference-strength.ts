/**
 * Conference Strength Adjustment
 *
 * CFB has significant talent gaps between conferences that Elo doesn't capture
 * because teams mostly play within their conference. When cross-conference games
 * happen (especially bowl games), we need to adjust for this.
 *
 * Data source: Historical cross-conference performance, recruiting rankings,
 * and NFL draft picks by conference.
 */

// Conference tiers and strength ratings
// Higher = stronger conference
export const CONFERENCE_STRENGTH: Record<string, number> = {
  // Power 4 (top tier)
  'SEC': 8,
  'Big Ten': 7.5,
  'Big 12': 6.5,
  'ACC': 6,

  // Group of 5
  'Mountain West': 3.5,
  'AAC': 3,      // American Athletic Conference
  'Sun Belt': 2.5,
  'MAC': 2,      // Mid-American Conference
  'Conference USA': 1.5,

  // Independent
  'Independent': 4, // Varies widely (Notre Dame vs UMass)

  // FCS (if we ever have them)
  'FCS': -3,
};

// Team -> Conference mapping for 2024 season
// This should be kept updated as teams change conferences
export const TEAM_CONFERENCE: Record<string, string> = {
  // SEC (16 teams)
  'Alabama Crimson Tide': 'SEC',
  'Arkansas Razorbacks': 'SEC',
  'Auburn Tigers': 'SEC',
  'Florida Gators': 'SEC',
  'Georgia Bulldogs': 'SEC',
  'Kentucky Wildcats': 'SEC',
  'LSU Tigers': 'SEC',
  'Mississippi State Bulldogs': 'SEC',
  'Missouri Tigers': 'SEC',
  'Oklahoma Sooners': 'SEC',
  'Ole Miss Rebels': 'SEC',
  'South Carolina Gamecocks': 'SEC',
  'Tennessee Volunteers': 'SEC',
  'Texas A&M Aggies': 'SEC',
  'Texas Longhorns': 'SEC',
  'Vanderbilt Commodores': 'SEC',

  // Big Ten (18 teams)
  'Illinois Fighting Illini': 'Big Ten',
  'Indiana Hoosiers': 'Big Ten',
  'Iowa Hawkeyes': 'Big Ten',
  'Maryland Terrapins': 'Big Ten',
  'Michigan Wolverines': 'Big Ten',
  'Michigan State Spartans': 'Big Ten',
  'Minnesota Golden Gophers': 'Big Ten',
  'Nebraska Cornhuskers': 'Big Ten',
  'Northwestern Wildcats': 'Big Ten',
  'Ohio State Buckeyes': 'Big Ten',
  'Oregon Ducks': 'Big Ten',
  'Penn State Nittany Lions': 'Big Ten',
  'Purdue Boilermakers': 'Big Ten',
  'Rutgers Scarlet Knights': 'Big Ten',
  'UCLA Bruins': 'Big Ten',
  'USC Trojans': 'Big Ten',
  'Washington Huskies': 'Big Ten',
  'Wisconsin Badgers': 'Big Ten',

  // Big 12 (16 teams)
  'Arizona Wildcats': 'Big 12',
  'Arizona State Sun Devils': 'Big 12',
  'Baylor Bears': 'Big 12',
  'BYU Cougars': 'Big 12',
  'UCF Knights': 'Big 12',
  'Cincinnati Bearcats': 'Big 12',
  'Colorado Buffaloes': 'Big 12',
  'Houston Cougars': 'Big 12',
  'Iowa State Cyclones': 'Big 12',
  'Kansas Jayhawks': 'Big 12',
  'Kansas State Wildcats': 'Big 12',
  'Oklahoma State Cowboys': 'Big 12',
  'TCU Horned Frogs': 'Big 12',
  'Texas Tech Red Raiders': 'Big 12',
  'Utah Utes': 'Big 12',
  'West Virginia Mountaineers': 'Big 12',

  // ACC (17 teams)
  'Boston College Eagles': 'ACC',
  'California Golden Bears': 'ACC',
  'Clemson Tigers': 'ACC',
  'Duke Blue Devils': 'ACC',
  'Florida State Seminoles': 'ACC',
  'Georgia Tech Yellow Jackets': 'ACC',
  'Louisville Cardinals': 'ACC',
  'Miami Hurricanes': 'ACC',
  'NC State Wolfpack': 'ACC',
  'North Carolina Tar Heels': 'ACC',
  'Pittsburgh Panthers': 'ACC',
  'SMU Mustangs': 'ACC',
  'Stanford Cardinal': 'ACC',
  'Syracuse Orange': 'ACC',
  'Virginia Cavaliers': 'ACC',
  'Virginia Tech Hokies': 'ACC',
  'Wake Forest Demon Deacons': 'ACC',

  // AAC (14 teams)
  'Army Black Knights': 'AAC',
  'Charlotte 49ers': 'AAC',
  'East Carolina Pirates': 'AAC',
  'FAU Owls': 'AAC',
  'Memphis Tigers': 'AAC',
  'Navy Midshipmen': 'AAC',
  'North Texas Mean Green': 'AAC',
  'Rice Owls': 'AAC',
  'South Florida Bulls': 'AAC',
  'Temple Owls': 'AAC',
  'Tulane Green Wave': 'AAC',
  'Tulsa Golden Hurricane': 'AAC',
  'UAB Blazers': 'AAC',
  'UTSA Roadrunners': 'AAC',

  // Mountain West (12 teams)
  'Air Force Falcons': 'Mountain West',
  'Boise State Broncos': 'Mountain West',
  'Colorado State Rams': 'Mountain West',
  'Fresno State Bulldogs': 'Mountain West',
  'Hawai\'i Rainbow Warriors': 'Mountain West',
  'Nevada Wolf Pack': 'Mountain West',
  'New Mexico Lobos': 'Mountain West',
  'San Diego State Aztecs': 'Mountain West',
  'San José State Spartans': 'Mountain West',
  'UNLV Rebels': 'Mountain West',
  'Utah State Aggies': 'Mountain West',
  'Wyoming Cowboys': 'Mountain West',

  // Sun Belt (14 teams)
  'Appalachian State Mountaineers': 'Sun Belt',
  'Arkansas State Red Wolves': 'Sun Belt',
  'Coastal Carolina Chanticleers': 'Sun Belt',
  'Georgia Southern Eagles': 'Sun Belt',
  'Georgia State Panthers': 'Sun Belt',
  'James Madison Dukes': 'Sun Belt',
  'Louisiana Ragin\' Cajuns': 'Sun Belt',
  'Louisiana-Monroe Warhawks': 'Sun Belt',
  'Marshall Thundering Herd': 'Sun Belt',
  'Old Dominion Monarchs': 'Sun Belt',
  'South Alabama Jaguars': 'Sun Belt',
  'Southern Miss Golden Eagles': 'Sun Belt',
  'Texas State Bobcats': 'Sun Belt',
  'Troy Trojans': 'Sun Belt',

  // MAC (12 teams)
  'Akron Zips': 'MAC',
  'Ball State Cardinals': 'MAC',
  'Bowling Green Falcons': 'MAC',
  'Buffalo Bulls': 'MAC',
  'Central Michigan Chippewas': 'MAC',
  'Eastern Michigan Eagles': 'MAC',
  'Kent State Golden Flashes': 'MAC',
  'Miami (OH) RedHawks': 'MAC',
  'Northern Illinois Huskies': 'MAC',
  'Ohio Bobcats': 'MAC',
  'Toledo Rockets': 'MAC',
  'Western Michigan Broncos': 'MAC',

  // Conference USA (10 teams)
  'FIU Panthers': 'Conference USA',
  'Jacksonville State Gamecocks': 'Conference USA',
  'Kennesaw State Owls': 'Conference USA',
  'Liberty Flames': 'Conference USA',
  'Louisiana Tech Bulldogs': 'Conference USA',
  'Middle Tennessee Blue Raiders': 'Conference USA',
  'New Mexico State Aggies': 'Conference USA',
  'Sam Houston Bearkats': 'Conference USA',
  'UTEP Miners': 'Conference USA',
  'Western Kentucky Hilltoppers': 'Conference USA',

  // Independents
  'Notre Dame Fighting Irish': 'Independent',
  'UConn Huskies': 'Independent',
  'UMass Minutemen': 'Independent',
};

/**
 * Get conference for a team name
 */
export function getTeamConference(teamName: string): string | null {
  // Exact match
  if (TEAM_CONFERENCE[teamName]) {
    return TEAM_CONFERENCE[teamName];
  }

  // Partial match (for slight name variations)
  for (const [name, conf] of Object.entries(TEAM_CONFERENCE)) {
    if (teamName.includes(name.split(' ')[0]) ||
        name.includes(teamName.split(' ')[0])) {
      return conf;
    }
  }

  return null;
}

/**
 * Get conference strength rating
 */
export function getConferenceStrength(conference: string): number {
  return CONFERENCE_STRENGTH[conference] ?? 3; // Default to mid-G5 if unknown
}

/**
 * Calculate conference strength adjustment for a game
 *
 * Returns adjustment to add to the HOME team's spread
 * Positive = home team gets boost, Negative = away team gets boost
 *
 * Example: SEC team (strength 8) at AAC team (strength 3)
 * Away boost = (8 - 3) * 0.7 = 3.5 pts for the SEC team
 * Since SEC is away, return -3.5 (away gets boost)
 */
export function calculateConferenceAdjustment(
  homeTeamName: string,
  awayTeamName: string
): {
  adjustment: number;
  homeConference: string | null;
  awayConference: string | null;
  strengthDiff: number;
  isCrossConference: boolean;
} {
  const homeConf = getTeamConference(homeTeamName);
  const awayConf = getTeamConference(awayTeamName);

  // If we can't identify conferences, return no adjustment
  if (!homeConf || !awayConf) {
    return {
      adjustment: 0,
      homeConference: homeConf,
      awayConference: awayConf,
      strengthDiff: 0,
      isCrossConference: false,
    };
  }

  // Same conference = no adjustment needed (Elo handles within-conference)
  if (homeConf === awayConf) {
    return {
      adjustment: 0,
      homeConference: homeConf,
      awayConference: awayConf,
      strengthDiff: 0,
      isCrossConference: false,
    };
  }

  // Different conferences - calculate adjustment
  const homeStrength = getConferenceStrength(homeConf);
  const awayStrength = getConferenceStrength(awayConf);
  const strengthDiff = homeStrength - awayStrength;

  // Convert strength difference to spread adjustment
  // Factor of ~0.7 pts per strength point (calibrated from historical data)
  // This means P5 vs G5 (strength diff ~4) = ~2.8 pts
  // SEC vs MAC (strength diff ~6) = ~4.2 pts
  const STRENGTH_TO_SPREAD = 0.7;
  const adjustment = strengthDiff * STRENGTH_TO_SPREAD;

  return {
    adjustment: Math.round(adjustment * 2) / 2, // Round to 0.5
    homeConference: homeConf,
    awayConference: awayConf,
    strengthDiff,
    isCrossConference: true,
  };
}

/**
 * Check if a game is likely a bowl game
 * Bowl games are typically in December-January, not part of regular season
 */
export function isBowlGame(gameDate: Date): boolean {
  const month = gameDate.getMonth(); // 0-indexed (0 = January, 11 = December)
  const day = gameDate.getDate();

  // December 14+ through January 10
  if (month === 11 && day >= 14) return true; // December 14+
  if (month === 0 && day <= 10) return true;  // January 1-10

  return false;
}

/**
 * Get bowl game adjustment
 * Bowl games have different dynamics:
 * - Neutral site (no home field)
 * - Opt-outs (star players sitting)
 * - Extended prep time
 * - Motivation varies
 */
export function getBowlGameAdjustment(gameDate: Date): {
  isBowl: boolean;
  homeFieldReduction: number;
  uncertaintyBoost: number;
} {
  if (!isBowlGame(gameDate)) {
    return {
      isBowl: false,
      homeFieldReduction: 0,
      uncertaintyBoost: 0,
    };
  }

  return {
    isBowl: true,
    homeFieldReduction: 2.5, // Eliminate home field advantage (neutral site)
    uncertaintyBoost: 1.5,   // Add uncertainty due to opt-outs and motivation
  };
}
