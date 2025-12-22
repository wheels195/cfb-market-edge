/**
 * Team Name Aliasing
 *
 * Maps various team name formats to canonical database names.
 * The Odds API, CFBD, and other sources use different name formats.
 */

export const TEAM_ALIASES: Record<string, string> = {
  // Standard aliases for Odds API → DB canonical names
  'Southern Mississippi': 'Southern Miss',
  'Hawaii': "Hawai'i",
  'FIU': 'Florida International',

  // Teams that use short names in DB (no alias needed, but include for clarity)
  'UTSA': 'UTSA',
  'UConn': 'UConn',
  'BYU': 'BYU',
  'SMU': 'SMU',
  'Ole Miss': 'Ole Miss',
  'UNLV': 'UNLV',
  'UCF': 'UCF',
  'LSU': 'LSU',
  'USC': 'USC',
  'UAB': 'UAB',

  // Alternative forms that might appear
  'UMass': 'Massachusetts',
  'UTEP': 'UTEP',
  'Miami (FL)': 'Miami',
  'Miami FL': 'Miami',
  'Miami (OH)': 'Miami (OH)',  // This one uses parentheses in both
  'Pitt': 'Pittsburgh',
  'App State': 'Appalachian State',

  // Some sources use full state names
  'North Carolina State': 'NC State',
  'Mississippi State': 'Mississippi State',  // Same
  'Florida State': 'Florida State',  // Same
  'Ohio State': 'Ohio State',  // Same
  'Penn State': 'Penn State',  // Same
  'Michigan State': 'Michigan State',  // Same
  'Washington State': 'Washington State',  // Same
  'Oregon State': 'Oregon State',  // Same
  'Arizona State': 'Arizona State',  // Same
  'San Diego State': 'San Diego State',  // Same
  'Fresno State': 'Fresno State',  // Same
  'Boise State': 'Boise State',  // Same
  'Utah State': 'Utah State',  // Same

  // Bowl-specific aliases (as encountered)
  'Southern Miss': 'Southern Miss',  // Already canonical
  "Hawai'i": "Hawai'i",  // Already canonical
};

/**
 * Get the canonical database team name from any alias.
 * If no alias found, returns the original name.
 */
export function getCanonicalTeamName(name: string): string {
  return TEAM_ALIASES[name] || name;
}

/**
 * Get a list of all possible aliases for a canonical name.
 * Useful for searching.
 */
export function getTeamAliases(canonicalName: string): string[] {
  const aliases: string[] = [canonicalName];

  for (const [alias, canonical] of Object.entries(TEAM_ALIASES)) {
    if (canonical === canonicalName && alias !== canonicalName) {
      aliases.push(alias);
    }
  }

  return aliases;
}

/**
 * Normalize team name for fuzzy matching.
 * Removes common suffixes, lowercases, trims.
 */
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ (university|state|college)$/, '')
    .replace(/^(the|university of) /, '');
}
