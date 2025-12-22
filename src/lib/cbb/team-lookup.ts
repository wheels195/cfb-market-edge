/**
 * CBB Team Lookup - Strict Matching
 *
 * Matching order (NO fuzzy matching):
 * 1. Exact match on odds_api_name
 * 2. Exact match on cbb_team_aliases
 * 3. Exact match on cbb_team_name_mappings
 * 4. Normalized match (deterministic normalization, no fuzzy)
 *
 * If no match found:
 * - Log to cbb_unmatched_team_names
 * - Return null (caller decides whether to fail or skip)
 */

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deterministic normalization for team names
 * - Lowercase
 * - Strip punctuation (apostrophes, periods, hyphens)
 * - Normalize St/Saint, Intl/International
 * - Remove common suffixes (Wildcats, Tigers, etc.)
 * - Collapse whitespace
 */
export function normalizeTeamName(name: string): string {
  let normalized = name.toLowerCase();

  // Remove apostrophes and special chars
  normalized = normalized.replace(/[''`]/g, '');

  // Normalize St./St to Saint
  normalized = normalized.replace(/\bst\.\s*/g, 'saint ');
  normalized = normalized.replace(/\bst\s+/g, 'saint ');

  // Normalize Int'l/Intl to International
  normalized = normalized.replace(/\bint['']?l\b/g, 'international');

  // Remove common mascots/suffixes
  const mascots = [
    'wildcats', 'tigers', 'bulldogs', 'eagles', 'bears', 'lions', 'panthers',
    'hawks', 'owls', 'cardinals', 'cougars', 'huskies', 'warriors', 'knights',
    'spartans', 'trojans', 'rebels', 'wolverines', 'gators', 'aggies', 'longhorns',
    'mountaineers', 'volunteers', 'commodores', 'hurricanes', 'cavaliers', 'hokies',
    'demon deacons', 'blue devils', 'tar heels', 'seminoles', 'orange', 'wolfpack',
    'crimson tide', 'razorbacks', 'jayhawks', 'sooners', 'cyclones', 'horned frogs',
    'red raiders', 'golden eagles', 'fighting irish', 'golden gophers', 'buckeyes',
    'nittany lions', 'badgers', 'hawkeyes', 'cornhuskers', 'boilermakers', 'hoosiers',
    'illini', 'terrapins', 'scarlet knights', 'rainbow warriors', 'redhawks', 'mavericks',
    'jaguars', 'tommies', 'royals', 'dolphins', 'grizzlies', 'fighting camels',
    'great danes', 'broncs', '49ers', 'golden panthers'
  ];

  for (const mascot of mascots) {
    normalized = normalized.replace(new RegExp(`\\s+${mascot}$`, 'i'), '');
  }

  // Remove state qualifiers in parens
  normalized = normalized.replace(/\s*\([^)]+\)\s*/g, ' ');

  // Remove periods and hyphens
  normalized = normalized.replace(/[.\-]/g, ' ');

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

export interface TeamLookupResult {
  teamId: string;
  teamName: string;
  matchSource: 'odds_api_name' | 'alias' | 'mapping' | 'normalized';
}

export interface TeamLookupCache {
  byOddsApiName: Map<string, TeamLookupResult>;
  byAlias: Map<string, TeamLookupResult>;
  byMapping: Map<string, TeamLookupResult>;
  byNormalized: Map<string, TeamLookupResult>;
  unmatched: Set<string>;
}

/**
 * Build a lookup cache from the database
 * Call once at start of sync job for efficiency
 */
export async function buildTeamLookupCache(
  supabase: SupabaseClient
): Promise<TeamLookupCache> {
  const cache: TeamLookupCache = {
    byOddsApiName: new Map(),
    byAlias: new Map(),
    byMapping: new Map(),
    byNormalized: new Map(),
    unmatched: new Set(),
  };

  // Load teams with odds_api_name
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name, odds_api_name')
    .not('odds_api_name', 'is', null);

  for (const team of teams || []) {
    cache.byOddsApiName.set(team.odds_api_name, {
      teamId: team.id,
      teamName: team.name,
      matchSource: 'odds_api_name',
    });
  }

  // Load aliases
  const { data: aliases } = await supabase
    .from('cbb_team_aliases')
    .select('alias, team_id, cbb_teams(name)')
    .eq('source', 'odds_api');

  for (const alias of aliases || []) {
    cache.byAlias.set(alias.alias, {
      teamId: alias.team_id,
      teamName: (alias as any).cbb_teams?.name || 'Unknown',
      matchSource: 'alias',
    });
  }

  // Load explicit mappings
  const { data: mappings } = await supabase
    .from('cbb_team_name_mappings')
    .select('source_name, team_id, cbb_teams(name)')
    .eq('source_type', 'odds_api');

  for (const mapping of mappings || []) {
    cache.byMapping.set(mapping.source_name, {
      teamId: mapping.team_id,
      teamName: (mapping as any).cbb_teams?.name || 'Unknown',
      matchSource: 'mapping',
    });
  }

  // Build normalized lookup from all teams
  const { data: allTeams } = await supabase
    .from('cbb_teams')
    .select('id, name');

  for (const team of allTeams || []) {
    const normalized = normalizeTeamName(team.name);
    // Only set if not already present (first match wins)
    if (!cache.byNormalized.has(normalized)) {
      cache.byNormalized.set(normalized, {
        teamId: team.id,
        teamName: team.name,
        matchSource: 'normalized',
      });
    }
  }

  // Load known unmatched names
  const { data: unmatched } = await supabase
    .from('cbb_unmatched_team_names')
    .select('team_name')
    .eq('source', 'odds_api')
    .eq('resolved', false);

  for (const u of unmatched || []) {
    cache.unmatched.add(u.team_name);
  }

  return cache;
}

/**
 * Look up a team by Odds API name
 * Returns null if not found (does NOT create new team)
 */
export function lookupTeam(
  oddsApiName: string,
  cache: TeamLookupCache
): TeamLookupResult | null {
  // 1. Exact match on odds_api_name
  const byName = cache.byOddsApiName.get(oddsApiName);
  if (byName) return byName;

  // 2. Exact match on alias
  const byAlias = cache.byAlias.get(oddsApiName);
  if (byAlias) return byAlias;

  // 3. Exact match on explicit mapping
  const byMapping = cache.byMapping.get(oddsApiName);
  if (byMapping) return byMapping;

  // 4. Normalized match (deterministic, not fuzzy)
  const normalized = normalizeTeamName(oddsApiName);
  const byNormalized = cache.byNormalized.get(normalized);
  if (byNormalized) return byNormalized;

  // Not found
  return null;
}

/**
 * Log an unmatched team name to the database
 * Returns false if already logged, true if newly logged
 */
export async function logUnmatchedTeam(
  supabase: SupabaseClient,
  teamName: string,
  context?: string,
  cache?: TeamLookupCache
): Promise<boolean> {
  // Check cache first
  if (cache?.unmatched.has(teamName)) {
    return false;
  }

  const { error } = await supabase
    .from('cbb_unmatched_team_names')
    .upsert({
      team_name: teamName,
      source: 'odds_api',
      context,
      resolved: false,
    }, { onConflict: 'team_name,source' });

  if (!error && cache) {
    cache.unmatched.add(teamName);
  }

  return !error;
}

/**
 * Get statistics about the lookup cache
 */
export function getCacheStats(cache: TeamLookupCache): {
  byOddsApiName: number;
  byAlias: number;
  byMapping: number;
  byNormalized: number;
  unmatched: number;
  total: number;
} {
  return {
    byOddsApiName: cache.byOddsApiName.size,
    byAlias: cache.byAlias.size,
    byMapping: cache.byMapping.size,
    byNormalized: cache.byNormalized.size,
    unmatched: cache.unmatched.size,
    total: cache.byOddsApiName.size + cache.byAlias.size + cache.byMapping.size + cache.byNormalized.size,
  };
}
