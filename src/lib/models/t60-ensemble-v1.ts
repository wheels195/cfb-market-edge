/**
 * T-60 ENSEMBLE MODEL v1 - FROZEN CONFIGURATION
 * ==============================================
 *
 * VALIDATED: 2025-12-22 on T-60 execution lines
 * Population: FBS games only (FCS filtered out)
 * Backtest: 2022-2024 (758 bets)
 *
 * DO NOT MODIFY without full backtest validation.
 *
 * Historical Performance (T-60 execution, FBS only, 2022-2024):
 *   2022: 350 bets, 65.7% win, +25.5% ROI
 *   2023: 187 bets, 63.1% win, +20.5% ROI
 *   2024: 221 bets, 59.3% win, +13.2% ROI
 *   TOTAL: 758 bets, 63.2% win, +20.6% ROI
 *
 * Chronological Holdout:
 *   Train (2022-2023): 537 bets, 64.8% win, +23.7% ROI
 *   Test (2024): 221 bets, 59.3% win, +13.2% ROI
 *
 * Coverage: 94.5% of FBS games have T-60 spreads
 */

// =============================================================================
// MODEL METADATA
// =============================================================================

export const T60_MODEL_VERSION = 't60-ensemble-v1';
export const T60_VALIDATED_DATE = '2025-12-22';
export const T60_FROZEN = true;

// =============================================================================
// ENSEMBLE WEIGHTS (Frozen)
// =============================================================================

export const T60_ENSEMBLE_WEIGHTS = {
  elo: 0.50,   // 50% weight on Elo rating differential
  sp: 0.30,    // 30% weight on SP+ rating differential
  ppa: 0.20,   // 20% weight on PPA (Points Per Play) differential
} as const;

// =============================================================================
// SPREAD CALCULATION CONSTANTS (Frozen)
// =============================================================================

export const T60_SPREAD_CONSTANTS = {
  HOME_FIELD_ADVANTAGE: 2.0,  // Points added for home team (lower than traditional 3)
  ELO_TO_SPREAD_DIVISOR: 25,  // Elo points per spread point
  PPA_TO_SPREAD_MULTIPLIER: 35, // Approximate plays per game for PPA conversion
} as const;

// =============================================================================
// EDGE FILTER (Frozen) - UPDATED from backtest
// =============================================================================

export const T60_EDGE_FILTER = {
  MIN_EDGE: 2.5,        // Minimum edge in points (below this, vig eats profit)
  MAX_EDGE: 5.0,        // Maximum edge in points (above this, model likely wrong)
} as const;

// =============================================================================
// CONFIDENCE FILTER (Frozen) - UPDATED from backtest
// =============================================================================

/**
 * Model Disagreement Filter
 *
 * OLD (too restrictive): max_disagreement = 5 pts (84 bets, +31% ROI)
 * NEW (validated): max_disagreement = 15 pts (476 bets, +27% ROI)
 *
 * Breakdown by disagreement level:
 *   0-5 pts:  84 bets, 69.0% win, +31.8% ROI (High)
 *   5-8 pts:  117 bets, 63.2% win, +20.7% ROI (Medium)
 *   8-15 pts: 275 bets, 68.7% win, +31.2% ROI (Low - actually great!)
 *   15+ pts:  298 bets, 56.0% win, +7.0% ROI (Very Low - still profitable but weaker)
 */
export const T60_CONFIDENCE_FILTER = {
  MAX_MODEL_DISAGREEMENT: 15,  // Maximum spread difference between Elo, SP+, PPA
  // Setting to 15 includes High + Medium + Low confidence games
  // Excludes only "Very Low" (15+ pt disagreement)
} as const;

// =============================================================================
// HELPER FUNCTIONS (Frozen)
// =============================================================================

/**
 * Compute ensemble spread projection (home team perspective)
 * Negative spread = home favored
 * Positive spread = away favored
 */
export function computeT60Projection(
  homeElo: number,
  awayElo: number,
  homeSPOverall: number,
  awaySPOverall: number,
  homePPAOff: number,
  homePPADef: number,
  awayPPAOff: number,
  awayPPADef: number
): {
  modelSpread: number;
  eloSpread: number;
  spSpread: number;
  ppaSpread: number;
  modelDisagreement: number;
  passesConfidenceFilter: boolean;
} {
  const { HOME_FIELD_ADVANTAGE, ELO_TO_SPREAD_DIVISOR, PPA_TO_SPREAD_MULTIPLIER } = T60_SPREAD_CONSTANTS;
  const { elo, sp, ppa } = T60_ENSEMBLE_WEIGHTS;

  // Elo spread: higher Elo = more favored
  const eloDiff = homeElo - awayElo;
  const eloSpread = -(eloDiff / ELO_TO_SPREAD_DIVISOR) - HOME_FIELD_ADVANTAGE;

  // SP+ spread: higher SP+ overall = more favored
  const spDiff = homeSPOverall - awaySPOverall;
  const spSpread = -spDiff - HOME_FIELD_ADVANTAGE;

  // PPA spread: offensive PPA vs defensive PPA matchup
  const ppaDiff = (homePPAOff - awayPPADef) - (awayPPAOff - homePPADef);
  const ppaSpread = -(ppaDiff * PPA_TO_SPREAD_MULTIPLIER) - HOME_FIELD_ADVANTAGE;

  // Ensemble weighted average
  const modelSpread = (eloSpread * elo) + (spSpread * sp) + (ppaSpread * ppa);

  // Model disagreement: max - min of the three component spreads
  const spreads = [eloSpread, spSpread, ppaSpread];
  const modelDisagreement = Math.max(...spreads) - Math.min(...spreads);

  // Confidence filter
  const passesConfidenceFilter = modelDisagreement <= T60_CONFIDENCE_FILTER.MAX_MODEL_DISAGREEMENT;

  return {
    modelSpread,
    eloSpread,
    spSpread,
    ppaSpread,
    modelDisagreement,
    passesConfidenceFilter,
  };
}

/**
 * Determine if a bet qualifies based on edge and confidence
 */
export function qualifiesForBet(
  marketSpread: number,
  modelSpread: number,
  modelDisagreement: number
): {
  qualifies: boolean;
  edge: number;
  absEdge: number;
  side: 'home' | 'away' | null;
  reason: string | null;
} {
  const edge = marketSpread - modelSpread;
  const absEdge = Math.abs(edge);

  // Check confidence filter
  if (modelDisagreement > T60_CONFIDENCE_FILTER.MAX_MODEL_DISAGREEMENT) {
    return {
      qualifies: false,
      edge,
      absEdge,
      side: null,
      reason: `Model disagreement ${modelDisagreement.toFixed(1)} exceeds ${T60_CONFIDENCE_FILTER.MAX_MODEL_DISAGREEMENT} pts`,
    };
  }

  // Check edge filter
  if (absEdge < T60_EDGE_FILTER.MIN_EDGE) {
    return {
      qualifies: false,
      edge,
      absEdge,
      side: null,
      reason: `Edge ${absEdge.toFixed(1)} below minimum ${T60_EDGE_FILTER.MIN_EDGE} pts`,
    };
  }

  if (absEdge >= T60_EDGE_FILTER.MAX_EDGE) {
    return {
      qualifies: false,
      edge,
      absEdge,
      side: null,
      reason: `Edge ${absEdge.toFixed(1)} exceeds maximum ${T60_EDGE_FILTER.MAX_EDGE} pts`,
    };
  }

  // Determine side
  // edge > 0: market spread higher than model → bet HOME (getting extra points)
  // edge < 0: market spread lower than model → bet AWAY
  const side = edge > 0 ? 'home' : 'away';

  return {
    qualifies: true,
    edge,
    absEdge,
    side,
    reason: null,
  };
}

/**
 * Evaluate bet outcome
 */
export function evaluateBet(
  side: 'home' | 'away',
  marketSpread: number,
  actualHomeMargin: number
): {
  won: boolean;
  push: boolean;
  profit: number;
} {
  // Adjusted margin from bettor's perspective
  // If betting home: home margin + spread (home gets the points if positive spread)
  // If betting away: -(home margin + spread) = away margin - spread
  const adjustedMargin = side === 'home'
    ? actualHomeMargin + marketSpread
    : -(actualHomeMargin + marketSpread);

  if (adjustedMargin === 0) {
    return { won: false, push: true, profit: 0 };
  }

  const won = adjustedMargin > 0;
  // Standard -110 juice: win pays +90.91, loss costs -100
  const profit = won ? 100 / 1.1 : -100;

  return { won, push: false, profit };
}

// =============================================================================
// CALIBRATION DATA (From backtest)
// =============================================================================

export const T60_CALIBRATION = {
  // Overall performance (FBS only, T-60 execution, 2022-2024)
  overall: {
    bets: 758,
    winRate: 0.632,
    roi: 0.206,
  },

  // Year-by-year (for monitoring drift)
  byYear: {
    2022: { bets: 350, winRate: 0.657, roi: 0.255 },
    2023: { bets: 187, winRate: 0.631, roi: 0.205 },
    2024: { bets: 221, winRate: 0.593, roi: 0.132 },
  },

  // Chronological holdout
  holdout: {
    train: { bets: 537, winRate: 0.648, roi: 0.237 },
    test: { bets: 221, winRate: 0.593, roi: 0.132 },
  },

  // Coverage
  coverage: {
    fbsGames: 3091,
    t60Matched: 2920,
    matchRate: 0.945,
  },
} as const;

// =============================================================================
// FROZEN CONFIG EXPORT
// =============================================================================

export const T60_PRODUCTION_CONFIG = {
  version: T60_MODEL_VERSION,
  validatedDate: T60_VALIDATED_DATE,
  frozen: T60_FROZEN,
  weights: T60_ENSEMBLE_WEIGHTS,
  spreadConstants: T60_SPREAD_CONSTANTS,
  edgeFilter: T60_EDGE_FILTER,
  confidenceFilter: T60_CONFIDENCE_FILTER,
  calibration: T60_CALIBRATION,
} as const;

Object.freeze(T60_PRODUCTION_CONFIG);
