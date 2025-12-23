/**
 * CBB CONFERENCE-AWARE RATING MODEL v2 - FROZEN CONFIGURATION
 * ============================================================
 *
 * VALIDATED: 2025-12-22
 * Strategy: Bet FAVORITES from elite/high tier conferences
 *           when spread is 7-14 points and model edge is 3+ points
 *
 * DO NOT MODIFY without full backtest validation.
 *
 * Historical Performance (2022-2025):
 *   390 bets, 55.9% win rate, +6.8% ROI, +26.4 units
 *
 * Year-by-Year:
 *   2022: 93 bets, 54.8% win, +4.7% ROI
 *   2023: 104 bets, 49.0% win, -6.3% ROI (one losing year)
 *   2024: 112 bets, 59.8% win, +14.3% ROI
 *   2025: 81 bets, 60.5% win, +15.5% ROI
 *
 * Chronological Holdout:
 *   Train (2022-2024): 309 bets, 54.7% win, +4.5% ROI
 *   Test (2025): 81 bets, 60.5% win, +15.5% ROI (test > train!)
 *
 * Key insight: Strong conference favorites in 7-14 pt spreads are undervalued
 */

// =============================================================================
// MODEL METADATA
// =============================================================================

export const CBB_MODEL_VERSION = 'cbb-conf-rating-v2';
export const CBB_MODEL_VALIDATED_DATE = '2025-12-22';
export const CBB_MODEL_FROZEN = true;

// =============================================================================
// RATING SYSTEM CONSTANTS (Validated from 9,600 games)
// =============================================================================

export const CBB_RATING_CONSTANTS = {
  HOME_ADVANTAGE: 7.4,      // Points added for home team
  LEARNING_RATE: 0.08,      // How fast ratings update after games
  SEASON_DECAY: 0.7,        // 70% carryover between seasons
} as const;

// =============================================================================
// CONFERENCE RATINGS (Derived from cross-conference game analysis)
// =============================================================================

export const CBB_CONFERENCE_RATINGS: Record<string, number> = {
  // Elite tier (rating >= 9)
  "Big 12": 12,
  "SEC": 11,
  "Big Ten": 9,

  // High tier (rating >= 5)
  "Big East": 7,
  "ACC": 5,
  "Mountain West": 5,

  // Mid tier (rating >= 0)
  "Atlantic 10": 4,
  "WCC": 3,
  "American Athletic": 3,
  "Missouri Valley": 2,
  "MAC": 1,
  "Sun Belt": 0,
  "Pac-12": 0,

  // Low tier (rating >= -6)
  "Conference USA": -1,
  "WAC": -2,
  "Big West": -3,
  "Ohio Valley": -4,
  "Horizon League": -4,
  "Southern": -5,
  "CAA": -5,
  "Patriot League": -6,
  "Ivy League": -6,

  // Bottom tier (rating < -6)
  "Big South": -7,
  "Summit League": -8,
  "ASUN": -8,
  "Northeast": -10,
  "NEC": -10,
  "Southland": -11,
  "MEAC": -14,
  "SWAC": -16,
} as const;

// =============================================================================
// BET CRITERIA (Validated from holdout testing)
// =============================================================================

export const CBB_BET_CRITERIA = {
  MIN_SPREAD: 7,            // Minimum spread size
  MAX_SPREAD: 14,           // Maximum spread size
  MIN_EDGE: 3.0,            // Minimum edge in points
  FAVORITE_ONLY: true,      // Only bet favorites
  ELITE_HIGH_TIER_ONLY: true, // Only bet elite/high tier teams
} as const;

// Elite and high tier conferences for bet qualification
export const CBB_ELITE_HIGH_CONFERENCES = new Set([
  "Big 12", "SEC", "Big Ten",  // Elite
  "Big East", "ACC", "Mountain West",  // High
]);

// =============================================================================
// CONFERENCE TIER HELPER
// =============================================================================

export function getConferenceTier(conference: string | null): 'elite' | 'high' | 'mid' | 'low' | 'bottom' {
  if (!conference) return 'mid';
  const rating = CBB_CONFERENCE_RATINGS[conference] ?? 0;
  if (rating >= 9) return 'elite';
  if (rating >= 5) return 'high';
  if (rating >= 0) return 'mid';
  if (rating >= -6) return 'low';
  return 'bottom';
}

export function getConferenceRating(conference: string | null): number {
  if (!conference) return 0;
  return CBB_CONFERENCE_RATINGS[conference] ?? 0;
}

// =============================================================================
// RATING SYSTEM CLASS
// =============================================================================

export class CbbRatingSystem {
  private teamRatings: Map<string, number> = new Map();
  private teamGames: Map<string, number> = new Map();
  private teamConferences: Map<string, string> = new Map();

  constructor(private config = CBB_RATING_CONSTANTS) {}

  /**
   * Set team conference (call this before processing games)
   */
  setTeamConference(teamId: string, conference: string) {
    this.teamConferences.set(teamId, conference);
  }

  /**
   * Get team's conference
   */
  getTeamConference(teamId: string): string | null {
    return this.teamConferences.get(teamId) || null;
  }

  /**
   * Get team's raw rating (without conference bonus)
   */
  getTeamRating(teamId: string): number {
    return this.teamRatings.get(teamId) ?? 0;
  }

  /**
   * Get team's total rating (team + conference)
   */
  getTotalRating(teamId: string): number {
    const teamRating = this.getTeamRating(teamId);
    const confRating = getConferenceRating(this.getTeamConference(teamId));
    return teamRating + confRating;
  }

  /**
   * Get games played this season
   */
  getGamesPlayed(teamId: string): number {
    return this.teamGames.get(teamId) ?? 0;
  }

  /**
   * Set team rating (used when loading from DB)
   */
  setRating(teamId: string, rating: number, gamesPlayed: number) {
    this.teamRatings.set(teamId, rating);
    this.teamGames.set(teamId, gamesPlayed);
  }

  /**
   * Calculate model spread (from home team perspective)
   * Negative = home favored, Positive = away favored
   */
  getSpread(homeTeamId: string, awayTeamId: string): number {
    const homeRating = this.getTotalRating(homeTeamId);
    const awayRating = this.getTotalRating(awayTeamId);
    // Spread = away rating - home rating - home advantage
    // If home is better, this is negative (home favored)
    return awayRating - homeRating - this.config.HOME_ADVANTAGE;
  }

  /**
   * Update ratings after a game
   */
  update(
    homeTeamId: string,
    awayTeamId: string,
    homeScore: number,
    awayScore: number
  ): { homeChange: number; awayChange: number } {
    const predicted = this.getSpread(homeTeamId, awayTeamId);
    const actual = awayScore - homeScore; // Positive = away won by more
    const error = actual - predicted;

    // Update home team rating
    const homeRating = this.getTeamRating(homeTeamId);
    const newHomeRating = homeRating - error * this.config.LEARNING_RATE;
    this.teamRatings.set(homeTeamId, newHomeRating);
    this.teamGames.set(homeTeamId, (this.teamGames.get(homeTeamId) ?? 0) + 1);

    // Update away team rating
    const awayRating = this.getTeamRating(awayTeamId);
    const newAwayRating = awayRating + error * this.config.LEARNING_RATE;
    this.teamRatings.set(awayTeamId, newAwayRating);
    this.teamGames.set(awayTeamId, (this.teamGames.get(awayTeamId) ?? 0) + 1);

    return {
      homeChange: newHomeRating - homeRating,
      awayChange: newAwayRating - awayRating,
    };
  }

  /**
   * Apply season decay (call at start of new season)
   */
  resetSeason() {
    for (const [teamId, rating] of this.teamRatings) {
      this.teamRatings.set(teamId, rating * this.config.SEASON_DECAY);
    }
    this.teamGames.clear();
  }

  /**
   * Get all ratings for saving to DB
   */
  getAllRatings(): Array<{ teamId: string; rating: number; gamesPlayed: number; conference: string | null }> {
    return Array.from(this.teamRatings.entries()).map(([teamId, rating]) => ({
      teamId,
      rating,
      gamesPlayed: this.teamGames.get(teamId) ?? 0,
      conference: this.teamConferences.get(teamId) ?? null,
    }));
  }
}

// =============================================================================
// BET ANALYSIS FUNCTIONS
// =============================================================================

export interface CbbBetAnalysis {
  qualifies: boolean;
  edge: number;
  absEdge: number;
  side: 'home' | 'away';
  isFavorite: boolean;
  isUnderdog: boolean;
  spreadSize: number;
  betTeamConference: string | null;
  betTeamTier: 'elite' | 'high' | 'mid' | 'low' | 'bottom';
  reason: string | null;
  qualificationReason: string | null;
}

/**
 * Analyze a game for bet qualification
 */
export function analyzeCbbBet(
  marketSpread: number,  // From home team perspective (negative = home favored)
  modelSpread: number,   // From model (negative = home favored)
  homeConference: string | null,
  awayConference: string | null,
  criteria = CBB_BET_CRITERIA
): CbbBetAnalysis {
  const edge = marketSpread - modelSpread;
  const absEdge = Math.abs(edge);
  const spreadSize = Math.abs(marketSpread);

  // Determine which side model recommends
  // edge > 0: market says away more favored than model → bet HOME
  // edge < 0: market says home more favored than model → bet AWAY
  const side: 'home' | 'away' = edge > 0 ? 'home' : 'away';

  // Determine if betting favorite or underdog
  // marketSpread < 0 means home is favored
  // marketSpread > 0 means away is favored
  const isFavorite = (side === 'home' && marketSpread < 0) ||
                     (side === 'away' && marketSpread > 0);
  const isUnderdog = !isFavorite;

  // Get bet team's conference info
  const betTeamConference = side === 'home' ? homeConference : awayConference;
  const betTeamTier = getConferenceTier(betTeamConference);
  const isEliteHighTier = betTeamConference ? CBB_ELITE_HIGH_CONFERENCES.has(betTeamConference) : false;

  // Check all criteria
  const meetsSpreadMin = spreadSize >= criteria.MIN_SPREAD;
  const meetsSpreadMax = spreadSize <= criteria.MAX_SPREAD;
  const meetsEdge = absEdge >= criteria.MIN_EDGE;
  const meetsFavoriteRule = !criteria.FAVORITE_ONLY || isFavorite;
  const meetsTierRule = !criteria.ELITE_HIGH_TIER_ONLY || isEliteHighTier;

  // Build disqualification reason
  let reason: string | null = null;
  if (!meetsSpreadMin) {
    reason = `Spread ${spreadSize.toFixed(1)} below ${criteria.MIN_SPREAD} pts`;
  } else if (!meetsSpreadMax) {
    reason = `Spread ${spreadSize.toFixed(1)} above ${criteria.MAX_SPREAD} pts`;
  } else if (!meetsEdge) {
    reason = `Edge ${absEdge.toFixed(1)} below ${criteria.MIN_EDGE} pts`;
  } else if (!meetsFavoriteRule) {
    reason = `Betting underdog (strategy requires favorite)`;
  } else if (!meetsTierRule) {
    reason = `${betTeamConference || 'Unknown'} not elite/high tier conference`;
  }

  const qualifies = meetsSpreadMin && meetsSpreadMax && meetsEdge && meetsFavoriteRule && meetsTierRule;

  // Build qualification reason for display
  let qualificationReason: string | null = null;
  if (qualifies) {
    const spreadDisplay = marketSpread < 0 ? marketSpread.toFixed(1) : `+${marketSpread.toFixed(1)}`;
    qualificationReason = `${betTeamConference} favorite ${spreadDisplay}, ${absEdge.toFixed(1)}pt edge`;
  }

  return {
    qualifies,
    edge,
    absEdge,
    side,
    isFavorite,
    isUnderdog,
    spreadSize,
    betTeamConference,
    betTeamTier,
    reason,
    qualificationReason,
  };
}

/**
 * Evaluate bet result
 */
export function evaluateCbbBet(
  side: 'home' | 'away',
  marketSpread: number,
  actualHomeMargin: number  // home_score - away_score
): {
  won: boolean;
  push: boolean;
  result: 'win' | 'loss' | 'push';
  profit: number;
} {
  let covers: boolean;
  let pushes: boolean;

  if (side === 'home') {
    // Betting home to cover: home_margin + spread > 0
    const adjustedMargin = actualHomeMargin + marketSpread;
    pushes = adjustedMargin === 0;
    covers = adjustedMargin > 0;
  } else {
    // Betting away to cover: -home_margin - spread > 0
    const adjustedMargin = -(actualHomeMargin + marketSpread);
    pushes = adjustedMargin === 0;
    covers = adjustedMargin > 0;
  }

  if (pushes) {
    return { won: false, push: true, result: 'push', profit: 0 };
  }

  return {
    won: covers,
    push: false,
    result: covers ? 'win' : 'loss',
    profit: covers ? 0.91 : -1.0,  // -110 juice
  };
}

// =============================================================================
// CALIBRATION DATA (From backtest)
// =============================================================================

export const CBB_CALIBRATION = {
  // Overall performance
  overall: {
    bets: 390,
    winRate: 0.559,
    roi: 0.068,
    units: 26.4,
  },

  // Year-by-year
  byYear: {
    2022: { bets: 93, winRate: 0.548, roi: 0.047 },
    2023: { bets: 104, winRate: 0.490, roi: -0.063 },
    2024: { bets: 112, winRate: 0.598, roi: 0.143 },
    2025: { bets: 81, winRate: 0.605, roi: 0.155 },
  },

  // Holdout validation
  holdout: {
    train: { bets: 309, winRate: 0.547, roi: 0.045 },
    test: { bets: 81, winRate: 0.605, roi: 0.155 },
  },
} as const;

// =============================================================================
// FROZEN CONFIG EXPORT
// =============================================================================

export const CBB_PRODUCTION_CONFIG = {
  version: CBB_MODEL_VERSION,
  validatedDate: CBB_MODEL_VALIDATED_DATE,
  frozen: CBB_MODEL_FROZEN,
  ratingConstants: CBB_RATING_CONSTANTS,
  conferenceRatings: CBB_CONFERENCE_RATINGS,
  betCriteria: CBB_BET_CRITERIA,
  eliteHighConferences: Array.from(CBB_ELITE_HIGH_CONFERENCES),
  calibration: CBB_CALIBRATION,
} as const;

Object.freeze(CBB_PRODUCTION_CONFIG);

// =============================================================================
// LEGACY EXPORTS (for backwards compatibility)
// =============================================================================

// Keep old class name working for existing code
export { CbbRatingSystem as CbbEloSystem };
export const CBB_ELO_CONSTANTS = CBB_RATING_CONSTANTS;
export const CBB_ELO_MODEL_VERSION = CBB_MODEL_VERSION;
