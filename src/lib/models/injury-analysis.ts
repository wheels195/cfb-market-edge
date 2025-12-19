/**
 * Injury Analysis Module
 *
 * Tracks player injuries and calculates spread adjustments based on:
 * - Position importance (QB injuries matter most)
 * - Injury status (Out vs Questionable vs Probable)
 * - Depth chart impact (starter vs backup)
 *
 * Research-backed position impact weights:
 * - QB: 3-7 points (most impactful)
 * - RB1: 1-2 points
 * - WR1: 0.5-1 point
 * - OL starter: 0.5-1 point
 * - Top defensive player: 0.5-1.5 points
 */

export type InjuryStatus = 'out' | 'doubtful' | 'questionable' | 'probable' | 'unknown';

export interface PlayerInjury {
  team: string;
  playerName: string;
  position: string;
  injuryType: string;
  status: InjuryStatus;
  isStarter: boolean;
  lastUpdated: Date;
}

export interface TeamInjuryReport {
  team: string;
  injuries: PlayerInjury[];
  keyPlayersOut: string[];
  totalOut: number;
  totalQuestionable: number;
}

export interface InjuryImpact {
  spreadAdjustment: number;
  confidence: 'high' | 'medium' | 'low';
  keyInjuries: string[];
  warnings: string[];
}

// Position importance weights (points of spread impact when starter is OUT)
const POSITION_WEIGHTS: Record<string, number> = {
  // Offense - QB is king
  'QB': 5.0,      // Starting QB out = massive impact
  'RB': 1.5,      // Lead back
  'WR': 1.0,      // Top receiver
  'TE': 0.75,
  'OL': 0.5,      // Per lineman
  'OT': 0.6,
  'OG': 0.5,
  'C': 0.5,

  // Defense
  'EDGE': 1.0,
  'DE': 0.75,
  'DT': 0.5,
  'DL': 0.6,
  'LB': 0.6,
  'CB': 0.75,
  'S': 0.5,
  'DB': 0.5,

  // Special teams
  'K': 0.25,
  'P': 0.15,
};

// Status multipliers (how likely they are to actually miss)
const STATUS_MULTIPLIERS: Record<InjuryStatus, number> = {
  'out': 1.0,           // Definitely out
  'doubtful': 0.85,     // 85% chance they miss
  'questionable': 0.50, // 50/50
  'probable': 0.15,     // Likely to play
  'unknown': 0.5,       // Assume worst case
};

// Cache for injury data
let injuryCache: Map<string, TeamInjuryReport> = new Map();
let lastFetchTime: Date | null = null;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Parse position string to normalized position code
 */
function normalizePosition(pos: string): string {
  const normalized = pos.toUpperCase().trim();

  // Handle common variations
  if (normalized.includes('QUARTERBACK') || normalized === 'QB') return 'QB';
  if (normalized.includes('RUNNING') || normalized === 'RB' || normalized === 'HB') return 'RB';
  if (normalized.includes('WIDE') || normalized === 'WR') return 'WR';
  if (normalized.includes('TIGHT') || normalized === 'TE') return 'TE';
  if (normalized.includes('OFFENSIVE LINE') || normalized === 'OL') return 'OL';
  if (normalized.includes('TACKLE') && !normalized.includes('DEFENSIVE')) return 'OT';
  if (normalized.includes('GUARD')) return 'OG';
  if (normalized.includes('CENTER') || normalized === 'C') return 'C';
  if (normalized.includes('EDGE')) return 'EDGE';
  if (normalized.includes('DEFENSIVE END') || normalized === 'DE') return 'DE';
  if (normalized.includes('DEFENSIVE TACKLE') || normalized === 'DT') return 'DT';
  if (normalized.includes('DEFENSIVE LINE') || normalized === 'DL') return 'DL';
  if (normalized.includes('LINEBACKER') || normalized === 'LB' || normalized === 'ILB' || normalized === 'OLB') return 'LB';
  if (normalized.includes('CORNERBACK') || normalized === 'CB') return 'CB';
  if (normalized.includes('SAFETY') || normalized === 'S' || normalized === 'FS' || normalized === 'SS') return 'S';
  if (normalized.includes('DEFENSIVE BACK') || normalized === 'DB') return 'DB';
  if (normalized.includes('KICKER') || normalized === 'K' || normalized === 'PK') return 'K';
  if (normalized.includes('PUNTER') || normalized === 'P') return 'P';

  return normalized;
}

/**
 * Parse status string to InjuryStatus
 */
function parseStatus(status: string): InjuryStatus {
  const lower = status.toLowerCase().trim();
  if (lower.includes('out') || lower.includes('ir') || lower.includes('season')) return 'out';
  if (lower.includes('doubtful')) return 'doubtful';
  if (lower.includes('questionable') || lower.includes('day-to-day')) return 'questionable';
  if (lower.includes('probable') || lower.includes('likely')) return 'probable';
  return 'unknown';
}

/**
 * Get position weight for spread adjustment
 */
function getPositionWeight(position: string): number {
  const normalized = normalizePosition(position);
  return POSITION_WEIGHTS[normalized] || 0.3; // Default small weight for unknown positions
}

/**
 * Calculate spread adjustment for a team's injuries
 * Positive = team is weaker (add to opponent's favor)
 */
export function calculateInjuryAdjustment(injuries: PlayerInjury[]): number {
  let totalAdjustment = 0;

  for (const injury of injuries) {
    const positionWeight = getPositionWeight(injury.position);
    const statusMultiplier = STATUS_MULTIPLIERS[injury.status];
    const starterMultiplier = injury.isStarter ? 1.0 : 0.3; // Backups matter less

    totalAdjustment += positionWeight * statusMultiplier * starterMultiplier;
  }

  // Cap at reasonable maximum (even with many injuries, effect is limited)
  return Math.min(totalAdjustment, 10);
}

/**
 * Analyze injury impact for a game
 */
export function analyzeInjuryImpact(
  homeInjuries: PlayerInjury[],
  awayInjuries: PlayerInjury[]
): InjuryImpact {
  const homeAdjustment = calculateInjuryAdjustment(homeInjuries);
  const awayAdjustment = calculateInjuryAdjustment(awayInjuries);

  // Net adjustment from home team perspective
  // Positive = home team is hurt more, spread should move toward away
  const netAdjustment = homeAdjustment - awayAdjustment;

  const keyInjuries: string[] = [];
  const warnings: string[] = [];

  // Flag key injuries (QB or high-impact)
  for (const injury of homeInjuries) {
    const weight = getPositionWeight(injury.position);
    if (injury.status === 'out' && weight >= 1.5) {
      keyInjuries.push(`HOME ${injury.position} OUT: ${injury.playerName}`);
      if (normalizePosition(injury.position) === 'QB') {
        warnings.push(`CRITICAL: Home starting QB (${injury.playerName}) is OUT - expect 3-7 pt swing`);
      }
    }
  }

  for (const injury of awayInjuries) {
    const weight = getPositionWeight(injury.position);
    if (injury.status === 'out' && weight >= 1.5) {
      keyInjuries.push(`AWAY ${injury.position} OUT: ${injury.playerName}`);
      if (normalizePosition(injury.position) === 'QB') {
        warnings.push(`CRITICAL: Away starting QB (${injury.playerName}) is OUT - expect 3-7 pt swing`);
      }
    }
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (keyInjuries.length === 0) {
    confidence = 'low'; // No major injuries to track
  } else if (keyInjuries.some(k => k.includes('QB'))) {
    confidence = 'high'; // QB injuries are well-documented impact
  }

  // Add warnings for large adjustments
  if (Math.abs(netAdjustment) >= 3) {
    warnings.push(`INJURY EDGE: ${netAdjustment > 0 ? 'Away' : 'Home'} has significant injury advantage (${Math.abs(netAdjustment).toFixed(1)} pts)`);
  }

  return {
    spreadAdjustment: Math.round(netAdjustment * 10) / 10,
    confidence,
    keyInjuries,
    warnings,
  };
}

/**
 * Store injury data in cache
 */
export function updateInjuryCache(reports: TeamInjuryReport[]): void {
  injuryCache.clear();
  for (const report of reports) {
    injuryCache.set(report.team.toLowerCase(), report);
  }
  lastFetchTime = new Date();
}

/**
 * Get injury report for a team
 */
export function getTeamInjuries(team: string): TeamInjuryReport | null {
  return injuryCache.get(team.toLowerCase()) || null;
}

/**
 * Check if cache is stale
 */
export function isInjuryCacheStale(): boolean {
  if (!lastFetchTime) return true;
  return Date.now() - lastFetchTime.getTime() > CACHE_DURATION_MS;
}

/**
 * Get all cached injury reports
 */
export function getAllInjuryReports(): TeamInjuryReport[] {
  return Array.from(injuryCache.values());
}

/**
 * Parse raw injury data from external source
 */
export function parseInjuryData(rawData: Array<{
  team: string;
  player: string;
  position: string;
  injury: string;
  status: string;
}>): TeamInjuryReport[] {
  const byTeam = new Map<string, PlayerInjury[]>();

  for (const row of rawData) {
    const teamKey = row.team.toLowerCase();
    if (!byTeam.has(teamKey)) {
      byTeam.set(teamKey, []);
    }

    byTeam.get(teamKey)!.push({
      team: row.team,
      playerName: row.player,
      position: row.position,
      injuryType: row.injury,
      status: parseStatus(row.status),
      isStarter: true, // Assume starter unless we have depth chart data
      lastUpdated: new Date(),
    });
  }

  const reports: TeamInjuryReport[] = [];
  for (const [teamKey, injuries] of byTeam) {
    const outPlayers = injuries.filter(i => i.status === 'out');
    const questionablePlayers = injuries.filter(i => i.status === 'questionable');

    reports.push({
      team: injuries[0]?.team || teamKey,
      injuries,
      keyPlayersOut: outPlayers
        .filter(i => getPositionWeight(i.position) >= 1.5)
        .map(i => `${i.position}: ${i.playerName}`),
      totalOut: outPlayers.length,
      totalQuestionable: questionablePlayers.length,
    });
  }

  return reports;
}

// Manual injury data based on covers.com report (Dec 2024)
// This will be replaced with automated fetching
export const CURRENT_INJURIES: Array<{
  team: string;
  player: string;
  position: string;
  injury: string;
  status: string;
}> = [
  // Alabama
  { team: 'Alabama', player: 'K. Riley', position: 'RB', injury: 'Undisclosed', status: 'Out' },
  { team: 'Alabama', player: 'L. Overton', position: 'DL', injury: 'Undisclosed', status: 'Out' },
  { team: 'Alabama', player: 'D. Kirkpatrick Jr.', position: 'CB', injury: 'Undisclosed', status: 'Out' },

  // Nebraska - Critical QB injury
  { team: 'Nebraska', player: 'D. Raiola', position: 'QB', injury: 'Broken fibula', status: 'Out' },
  { team: 'Nebraska', player: 'E. Johnson', position: 'RB', injury: 'NFL opt-out', status: 'Out' },

  // Oregon
  { team: 'Oregon', player: 'S. Davis', position: 'CB', injury: 'Undisclosed', status: 'Out' },
  { team: 'Oregon', player: 'J. Lowe', position: 'WR', injury: 'Undisclosed', status: 'Out' },
  { team: 'Oregon', player: 'D. Riggs', position: 'RB', injury: 'Undisclosed', status: 'Out' },

  // Penn State - Critical QB injury
  { team: 'Penn State', player: 'D. Allar', position: 'QB', injury: 'Undisclosed', status: 'Out' },

  // LSU - Critical QB injury
  { team: 'LSU', player: 'G. Nussmeier', position: 'QB', injury: 'Undisclosed', status: 'Out' },

  // Clemson
  { team: 'Clemson', player: 'A. Terrell', position: 'CB', injury: 'Quad', status: 'Out' },
  { team: 'Clemson', player: 'A. Williams', position: 'WR', injury: 'Undisclosed', status: 'Out' },

  // Texas Tech - Critical QB injury
  { team: 'Texas Tech', player: 'W. Hammond', position: 'QB', injury: 'Torn ACL', status: 'Out' },

  // Georgia
  { team: 'Georgia', player: 'J. Hall', position: 'DL', injury: 'Knee', status: 'Out' },

  // San Diego State - Critical QB injury
  { team: 'San Diego State', player: 'J. Denegal', position: 'QB', injury: 'Shoulder surgery', status: 'Out' },
];

/**
 * Initialize injury cache with current data
 */
export function initializeInjuryData(): void {
  const reports = parseInjuryData(CURRENT_INJURIES);
  updateInjuryCache(reports);
  console.log(`Initialized injury cache with ${reports.length} teams, ${CURRENT_INJURIES.length} injuries`);
}
