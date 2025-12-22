/**
 * CBB ELO MODEL v1 - FROZEN CONFIGURATION
 * ========================================
 *
 * VALIDATED: 2025-12-22
 * Strategy: Bet underdogs when spread ≥10 pts and model edge 2.5-5 pts
 * Population: All D1 basketball games with T-60 spreads
 *
 * DO NOT MODIFY without full backtest validation.
 *
 * Historical Performance (2022-2024):
 *   Underdog + Spread 10+: 138 bets, 59.4% win, +13.5% ROI
 *
 * Chronological Holdout:
 *   Train (2022-2023): 76 bets, 57.9% win, +8.8% ROI
 *   Test (2024): 62 bets, 62.7% win, +19.8% ROI (better than train!)
 *
 * Key insight: Model identifies when underdogs are mispriced
 */

// =============================================================================
// MODEL METADATA
// =============================================================================

export const CBB_ELO_MODEL_VERSION = 'cbb-elo-v1';
export const CBB_ELO_VALIDATED_DATE = '2025-12-22';
export const CBB_ELO_FROZEN = true;

// =============================================================================
// ELO SYSTEM CONSTANTS (Frozen)
// =============================================================================

export const CBB_ELO_CONSTANTS = {
  BASE_ELO: 1500,           // Starting Elo for new teams
  K_FACTOR: 20,             // Base K-factor for updates
  MARGIN_MULTIPLIER: 0.8,   // Margin of victory scaling
  SEASON_CARRYOVER: 0.6,    // 60% retention between seasons
  ELO_DIVISOR: 25,          // Elo points per spread point
  HOME_ADVANTAGE: 2.5,      // Points added for home team
} as const;

// =============================================================================
// BET CRITERIA (Frozen)
// =============================================================================

export const CBB_BET_CRITERIA = {
  MIN_GAMES: 5,         // Both teams must have played 5+ games
  MIN_EDGE: 2.5,        // Minimum edge in points
  MAX_EDGE: 5.0,        // Maximum edge in points
  MIN_SPREAD: 10,       // Minimum spread size (must be 10+ pt underdog)
  UNDERDOG_ONLY: true,  // Only bet underdogs
} as const;

// =============================================================================
// ELO CALCULATION CLASS
// =============================================================================

export class CbbEloSystem {
  private ratings: Map<string, number> = new Map();
  private seasonGames: Map<string, number> = new Map();

  constructor(
    private config = CBB_ELO_CONSTANTS
  ) {}

  /**
   * Reset ratings for new season (60% carryover)
   */
  resetSeason() {
    for (const [team, elo] of this.ratings) {
      const regressed = this.config.BASE_ELO +
        (elo - this.config.BASE_ELO) * this.config.SEASON_CARRYOVER;
      this.ratings.set(team, regressed);
    }
    this.seasonGames.clear();
  }

  /**
   * Get current Elo for a team (creates new if doesn't exist)
   */
  getElo(teamId: string): number {
    if (!this.ratings.has(teamId)) {
      this.ratings.set(teamId, this.config.BASE_ELO);
      this.seasonGames.set(teamId, 0);
    }
    return this.ratings.get(teamId)!;
  }

  /**
   * Set Elo for a team (used when loading from DB)
   */
  setElo(teamId: string, elo: number, gamesPlayed: number) {
    this.ratings.set(teamId, elo);
    this.seasonGames.set(teamId, gamesPlayed);
  }

  /**
   * Get number of games played by team in current season
   */
  getGamesPlayed(teamId: string): number {
    return this.seasonGames.get(teamId) || 0;
  }

  /**
   * Calculate model spread (from home team perspective)
   * Positive = away team favored
   * Negative = home team favored
   */
  getSpread(homeTeamId: string, awayTeamId: string): number {
    const homeElo = this.getElo(homeTeamId);
    const awayElo = this.getElo(awayTeamId);
    // Spread = (awayElo - homeElo) / divisor - home advantage
    // If away has higher Elo, spread is positive (away favored)
    return (awayElo - homeElo) / this.config.ELO_DIVISOR - this.config.HOME_ADVANTAGE;
  }

  /**
   * Update ratings after a game
   */
  update(
    homeTeamId: string,
    awayTeamId: string,
    homeScore: number,
    awayScore: number
  ): { homeEloChange: number; awayEloChange: number } {
    const homeElo = this.getElo(homeTeamId);
    const awayElo = this.getElo(awayTeamId);

    // Expected win probability for home team
    const homeAdvElo = this.config.HOME_ADVANTAGE * this.config.ELO_DIVISOR / 10;
    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - homeAdvElo) / 400));

    // Actual result
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;

    // Margin of victory multiplier
    const margin = Math.abs(homeScore - awayScore);
    const marginMult = Math.log(margin + 1) * this.config.MARGIN_MULTIPLIER;

    // Calculate rating change
    const change = this.config.K_FACTOR * marginMult * (actualHome - expectedHome);

    // Update ratings
    const newHomeElo = homeElo + change;
    const newAwayElo = awayElo - change;
    this.ratings.set(homeTeamId, newHomeElo);
    this.ratings.set(awayTeamId, newAwayElo);

    // Update games played
    this.seasonGames.set(homeTeamId, (this.seasonGames.get(homeTeamId) || 0) + 1);
    this.seasonGames.set(awayTeamId, (this.seasonGames.get(awayTeamId) || 0) + 1);

    return {
      homeEloChange: change,
      awayEloChange: -change,
    };
  }

  /**
   * Get all current ratings (for saving to DB)
   */
  getAllRatings(): Array<{ teamId: string; elo: number; gamesPlayed: number }> {
    return Array.from(this.ratings.entries()).map(([teamId, elo]) => ({
      teamId,
      elo,
      gamesPlayed: this.seasonGames.get(teamId) || 0,
    }));
  }
}

// =============================================================================
// BET QUALIFICATION FUNCTIONS
// =============================================================================

export interface CbbBetAnalysis {
  qualifies: boolean;
  edge: number;
  absEdge: number;
  side: 'home' | 'away'; // Always computed based on edge direction
  isUnderdog: boolean;
  spreadSize: number;
  homeGamesPlayed: number;
  awayGamesPlayed: number;
  reason: string | null;
  qualificationReason: string | null;
}

/**
 * Analyze a game for bet qualification
 */
export function analyzeCbbBet(
  marketSpread: number,  // From home team perspective (positive = away favored)
  modelSpread: number,   // From model (positive = away favored)
  homeGamesPlayed: number,
  awayGamesPlayed: number,
  criteria = CBB_BET_CRITERIA
): CbbBetAnalysis {
  const edge = marketSpread - modelSpread;
  const absEdge = Math.abs(edge);
  const spreadSize = Math.abs(marketSpread);

  // Determine which side model recommends
  // edge > 0: market says away more favored than model → bet HOME (underdog)
  // edge < 0: market says home more favored than model → bet AWAY (underdog)
  const side: 'home' | 'away' = edge > 0 ? 'home' : 'away';

  // Determine if betting the underdog
  // marketSpread > 0 means away is favored, home is underdog
  // marketSpread < 0 means home is favored, away is underdog
  const isUnderdog = (side === 'home' && marketSpread > 0) ||
                     (side === 'away' && marketSpread < 0);

  // Check all criteria
  const meetsMinGames = homeGamesPlayed >= criteria.MIN_GAMES &&
                        awayGamesPlayed >= criteria.MIN_GAMES;
  const meetsMinEdge = absEdge >= criteria.MIN_EDGE;
  const meetsMaxEdge = absEdge <= criteria.MAX_EDGE;
  const meetsMinSpread = spreadSize >= criteria.MIN_SPREAD;
  const meetsUnderdogRule = !criteria.UNDERDOG_ONLY || isUnderdog;

  // Build disqualification reason
  let reason: string | null = null;
  if (!meetsMinGames) {
    reason = `Need ${criteria.MIN_GAMES}+ games (home: ${homeGamesPlayed}, away: ${awayGamesPlayed})`;
  } else if (!meetsMinEdge) {
    reason = `Edge ${absEdge.toFixed(1)} below ${criteria.MIN_EDGE} pts`;
  } else if (!meetsMaxEdge) {
    reason = `Edge ${absEdge.toFixed(1)} above ${criteria.MAX_EDGE} pts`;
  } else if (!meetsMinSpread) {
    reason = `Spread ${spreadSize.toFixed(1)} below ${criteria.MIN_SPREAD} pts`;
  } else if (!meetsUnderdogRule) {
    reason = `Not betting underdog (model likes favorite)`;
  }

  const qualifies = meetsMinGames && meetsMinEdge && meetsMaxEdge &&
                    meetsMinSpread && meetsUnderdogRule;

  // Build qualification reason for display
  let qualificationReason: string | null = null;
  if (qualifies) {
    const sideTeam = side === 'home' ? 'home' : 'away';
    const spreadDisplay = marketSpread > 0 ? `+${marketSpread.toFixed(1)}` : marketSpread.toFixed(1);
    qualificationReason = `${sideTeam.charAt(0).toUpperCase() + sideTeam.slice(1)} ${spreadDisplay}, ${absEdge.toFixed(1)}pt edge`;
  }

  return {
    qualifies,
    edge,
    absEdge,
    side, // Always return computed side for display purposes
    isUnderdog,
    spreadSize,
    homeGamesPlayed,
    awayGamesPlayed,
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
  // From bettor's perspective:
  // If betting home: need home margin > -spread (home covers)
  // If betting away: need away margin > spread (away covers)
  let covers: boolean;
  let pushes: boolean;

  if (side === 'home') {
    // Betting home to cover spread
    // marketSpread > 0 means home is underdog (getting points)
    // Home covers if: home_margin > -marketSpread
    const adjustedMargin = actualHomeMargin + marketSpread;
    pushes = adjustedMargin === 0;
    covers = adjustedMargin > 0;
  } else {
    // Betting away to cover spread
    // marketSpread < 0 means away is underdog (getting points)
    // Away covers if: away_margin > -marketSpread → home_margin < marketSpread
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

export const CBB_ELO_CALIBRATION = {
  // Overall performance (underdog + 10+ spread, 2022-2024)
  overall: {
    bets: 138,
    winRate: 0.594,
    roi: 0.135,
  },

  // Year-by-year (for monitoring drift)
  byYear: {
    2022: { bets: 45, winRate: 0.556, roi: 0.049 },
    2023: { bets: 31, winRate: 0.581, roi: 0.087 },
    2024: { bets: 62, winRate: 0.627, roi: 0.198 },
  },

  // Chronological holdout
  holdout: {
    train: { bets: 76, winRate: 0.579, roi: 0.088 },
    test: { bets: 62, winRate: 0.627, roi: 0.198 },
  },
} as const;

// =============================================================================
// FROZEN CONFIG EXPORT
// =============================================================================

export const CBB_ELO_PRODUCTION_CONFIG = {
  version: CBB_ELO_MODEL_VERSION,
  validatedDate: CBB_ELO_VALIDATED_DATE,
  frozen: CBB_ELO_FROZEN,
  eloConstants: CBB_ELO_CONSTANTS,
  betCriteria: CBB_BET_CRITERIA,
  calibration: CBB_ELO_CALIBRATION,
} as const;

Object.freeze(CBB_ELO_PRODUCTION_CONFIG);
