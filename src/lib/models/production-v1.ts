/**
 * PRODUCTION MODEL v1 - FROZEN CONFIGURATION
 * ==========================================
 *
 * Model ID: v3_ppadiff_regime2
 * Promoted: 2025-12-19
 *
 * DO NOT MODIFY THIS FILE without full backtest + holdout validation.
 * All experiments should be done in a separate shadow model.
 *
 * Historical Performance (2022-2024):
 *   Top 5%:  58.0% win, +10.8% ROI
 *   Top 10%: 52.8% win, +0.7% ROI
 *   Weeks 5+ Top 20%: 57.1% win, +9.1% ROI
 */

// =============================================================================
// MODEL METADATA
// =============================================================================

export const MODEL_VERSION = 'production-v1';
export const MODEL_ID = 'v3_ppadiff_regime2';
export const PROMOTED_DATE = '2025-12-19';
export const FROZEN = true;

// =============================================================================
// WEEK DEFINITION (CRITICAL - Must be consistent across all pipelines)
// =============================================================================
// Source: CFBD API provides official week numbers with game data.
// We ALWAYS use CFBD's week number when available (from cfbd_games.week column).
//
// For live edge calculations where we need to compute week from date:
// - Week 0: Games before Labor Day (rare, usually FCS)
// - Week 1: Labor Day weekend games (usually first Saturday in September)
// - Weeks 2-15: Regular season
// - Bowls: Week 15+ or special handling
//
// RULE: Always prefer CFBD week from game data over computed week.
// The getWeekFromDate function is a FALLBACK only when CFBD week unavailable.

/**
 * Get CFBD week number from a game date (FALLBACK ONLY)
 * Always prefer cfbd_games.week when available
 */
export function getWeekFromDate(gameDate: Date, season: number): number {
  // CFB season starts around August 24 (Week 0 games)
  // Week 1 is traditionally Labor Day weekend
  const seasonStart = new Date(season, 7, 24); // August 24
  const diffDays = Math.floor((gameDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7);
  return Math.max(0, Math.min(week, 15)); // Clamp between 0-15
}

/**
 * Check if a game is in the early-season regime (higher uncertainty)
 */
export function isEarlySeasonWeek(week: number): boolean {
  return week <= 4;
}

// =============================================================================
// CRON SCHEDULE (Reference - actual config in vercel.json)
// =============================================================================
// All times UTC
//
// Daily:
//   - sync-events:        0 6 * * *     (6 AM daily - fetch upcoming games)
//
// Game Days (Thu/Fri/Sat = days 4,5,6):
//   - poll-odds:          */10 * * * 4,5,6  (every 10 min on game days)
//   - run-model:          0 8 * * 4,5,6     (8 AM on game days)
//   - materialize-edges:  0 */2 * * 4,5,6   (every 2 hours on game days)
//
// Post-Game (Sunday = day 0):
//   - set-closing-lines:  0 4 * * 0     (4 AM Sunday - capture closing lines)
//   - sync-results:       0 6 * * 0     (6 AM Sunday - fetch final scores)
//   - grade-bets:         0 7 * * 0     (7 AM Sunday - grade bet records)

// =============================================================================
// SHADOW DEPLOY PLAN (2-Week Parallel Run)
// =============================================================================
// Before going live, run in shadow mode for 2 weeks:
//
// WEEK 1 CHECKLIST:
//   [ ] Enable all cron jobs in vercel.json
//   [ ] Verify sync-events populates events table
//   [ ] Verify poll-odds captures odds ticks
//   [ ] Verify run-model creates model_run_snapshots
//   [ ] Verify materialize-edges generates edges
//   [ ] Check monitoring_alerts for any warnings
//
// WEEK 1 END (Sunday):
//   [ ] Verify set-closing-lines captures closing lines
//   [ ] Verify sync-results fetches final scores
//   [ ] Verify grade-bets grades bet_records correctly
//   [ ] Review v_weekly_bet_summary view
//   [ ] Compare CLV to historical baseline
//
// WEEK 2 CHECKLIST:
//   [ ] Repeat Week 1 validation
//   [ ] Verify idempotency (re-run jobs produce no duplicates)
//   [ ] Check for any drift in ratings vs CFBD SP+
//   [ ] Verify weather enforcement blocking totals correctly
//   [ ] Verify QB status affecting uncertainty as expected
//
// GO-LIVE CRITERIA:
//   [ ] Zero critical alerts in monitoring_alerts
//   [ ] CLV capture rate > 50%
//   [ ] Data freshness: no stale odds (< 4h before kickoff)
//   [ ] All unique constraints holding (no duplicate errors)
//   [ ] Model predictions within 3pts of closing line on average

export const SHADOW_DEPLOY = {
  status: 'ready_for_shadow',  // Change to 'live' after 2-week validation
  startDate: null as string | null,
  weekOneComplete: false,
  weekTwoComplete: false,
  goLiveApproved: false,
};

// =============================================================================
// SPREAD CALCULATION CONSTANTS
// =============================================================================

export const HFA = 3.0;                    // Home field advantage in points
export const ELO_TO_SPREAD = 25;           // Elo points per spread point
export const MEAN_RATING = 1500;           // Base Elo rating

// =============================================================================
// WEEK 0 PRIOR WEIGHTS
// =============================================================================

export const WEEK0_PRIOR_WEIGHTS = {
  PRIOR_ELO: 0.35,                         // Prior season final Elo
  ROSTER_CONTINUITY: 0.35,                 // Returning production PPA
  RECRUITING: 0.20,                        // Recruiting ranking (normalized)
  CONFERENCE_BASE: 0.10,                   // Conference strength
} as const;

// Roster continuity conversion: PPA percentage → Elo-like scale
export const ROSTER_CONTINUITY_BASE = 1500;
export const ROSTER_CONTINUITY_SCALE = 400;  // (pct - 0.5) * 400

// Recruiting conversion: normalized [0,1] → Elo-like scale
export const RECRUITING_BASE = 1300;
export const RECRUITING_SCALE = 400;

// =============================================================================
// TWO-REGIME WEIGHTING
// =============================================================================

export const REGIME_WEIGHTS = {
  // Regime 1: Weeks 1-4 (priors-heavy, declining)
  WEEK_1: { prior: 0.70, inSeason: 0.30 },
  WEEK_2: { prior: 0.60, inSeason: 0.40 },
  WEEK_3: { prior: 0.50, inSeason: 0.50 },
  WEEK_4: { prior: 0.40, inSeason: 0.60 },

  // Regime 2: Weeks 5+ (performance-heavy)
  WEEKS_5_PLUS: { prior: 0.30, inSeason: 0.70 },
} as const;

// =============================================================================
// WEEKLY UPDATE WEIGHTS
// =============================================================================

export const UPDATE_WEIGHTS = {
  PPA_WEIGHT: 0.75,                        // Opponent-adjusted PPA differential
  MARGIN_WEIGHT: 0.25,                     // Capped margin (Elo-style)
} as const;

export const UPDATE_CONSTANTS = {
  K_FACTOR: 20,                            // Base Elo K-factor
  MARGIN_CAP: 21,                          // Cap margin at ±3 TDs
  PPA_SCALE: 250,                          // Converts PPA diff to Elo-like update
  PPA_DIFF_CAP: 0.5,                       // Cap PPA differential at ±0.5
  MAX_UPDATE: 40,                          // K_FACTOR * 2
} as const;

// =============================================================================
// UNCERTAINTY SHRINKAGE
// =============================================================================

export const UNCERTAINTY_WEEK = {
  WEEKS_0_1: 0.45,
  WEEKS_2_4: 0.25,
  WEEKS_5_PLUS: 0.10,
} as const;

export const UNCERTAINTY_ROSTER = {
  BOTTOM_QUARTILE: 0.15,                   // < Q25 returning PPA
  SECOND_QUARTILE: 0.08,                   // Q25-Q50 returning PPA
  TOP_HALF: 0.00,                          // > Q50 returning PPA
} as const;

export const UNCERTAINTY_QB = {
  TRANSFER_OUT: 0.20,                      // QB transferred out (new/unknown QB)
  RETURNING: 0.00,                         // Returning QB
} as const;

export const UNCERTAINTY_COACH = {
  NEW_COACH: 0.10,                         // Head coaching change
  RETURNING: 0.00,                         // Returning coach
} as const;

export const UNCERTAINTY_CAP = 0.75;       // Maximum uncertainty score

// =============================================================================
// BET-TIME RULE
// =============================================================================

export const BET_TIME = {
  USE_SPREAD_OPEN: true,                   // Compare model to opening line
  // Future: Could add spread_close comparison for CLV
} as const;

// =============================================================================
// EDGE DEFINITION
// =============================================================================

export const EDGE_RULES = {
  // Edge calculation
  EFFECTIVE_EDGE_FORMULA: 'raw_edge * (1 - uncertainty)',

  // High uncertainty threshold
  HIGH_UNCERTAINTY_THRESHOLD: 0.40,
  HIGH_EDGE_THRESHOLD: 10,                 // |raw_edge| >= 10

  // Percentile definitions for edge buckets
  TOP_5_PERCENT: 0.05,
  TOP_10_PERCENT: 0.10,
  TOP_20_PERCENT: 0.20,
} as const;

// =============================================================================
// BETTING RULES (HARD-CODED, NO DISCRETION)
// =============================================================================

export const BETTING_RULES = {
  // Default: Only bet Top 5% effective edges
  DEFAULT_EDGE_PERCENTILE: 0.05,

  // Market-specific edge floors (Fix B)
  EDGE_FLOORS: {
    SPREAD: 3.0,                           // Spread edge floor
    TOTAL: 2.5,                            // Total edge floor (lower)
    TOTAL_REQUIRES_WEATHER: true,          // Totals require weather data
  },

  // QB status handling (Fix A)
  // Note: QB OUT does NOT auto-reject. Instead, recompute uncertainty and
  // only bet if it still clears thresholds. This avoids missing best edges.
  QB_OUT_UNCERTAINTY_INCREASE: 0.20,       // Add to uncertainty when QB is out
  QB_UNKNOWN_UNCERTAINTY_INCREASE: 0.15,   // Add when QB status unknown
  QB_QUESTIONABLE_UNCERTAINTY_INCREASE: 0.10,

  // Week-specific rules
  WEEKS_1_4: {
    EDGE_PERCENTILE: 0.05,                 // Top 5% only
    MAX_UNCERTAINTY: 0.50,                 // Stricter uncertainty cap
    REQUIRE_QB_STATUS: true,               // Must have QB status (not necessarily confirmed)
  },

  WEEKS_5_PLUS: {
    EDGE_PERCENTILE: 0.05,                 // Top 5% only
    MAX_UNCERTAINTY: 0.60,                 // Slightly relaxed
    REQUIRE_QB_STATUS: false,              // Can bet with unknown if low base unc
  },

  // Never bet conditions (updated - removed QB_OUT hard block)
  NEVER_BET: {
    HIGH_UNCERTAINTY_WITHOUT_QB: true,     // High unc + unknown QB in weeks 1-4
    EFFECTIVE_EDGE_BELOW_FLOOR: true,      // Market-specific floor
    MISSING_CRITICAL_DATA: true,           // No spread, no scores, etc.
    TOTAL_WITHOUT_WEATHER: true,           // Totals require weather
  },
} as const;

export type MarketType = 'spread' | 'total';

// =============================================================================
// PERFORMANCE THRESHOLDS (FOR MONITORING)
// =============================================================================

export const MONITORING_THRESHOLDS = {
  // Minimum sample before evaluating (prevents early false alarms)
  MIN_BETS_BEFORE_EVAL: 30,                // Need 30 bets minimum
  MIN_WEEKS_BEFORE_EVAL: 4,                // OR 4 weeks, whichever is later

  // Alert if Top 5% drops below this for N consecutive weeks
  TOP_5_MIN_WIN_RATE: 0.52,
  CONSECUTIVE_WEEKS_BEFORE_ALERT: 3,

  // CLV persistence (also requires MIN_BETS_BEFORE_EVAL)
  MIN_CLV_CAPTURE_RATE: 0.45,

  // Edge persistence (effective edge should survive to close)
  MIN_EDGE_PERSISTENCE: 0.40,
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export interface Week0Rating {
  season: number;
  team: string;
  priorElo: number;
  rosterContinuity: number;
  recruitingElo: number;
  week0Rating: number;
  percentReturningPPA: number;
  coachingChange: boolean;
  qbTransfersOut: number;
  uncertaintyScore: number;
}

export interface UncertaintyBreakdown {
  total: number;
  week: number;
  homeRoster: number;
  homeQB: number;
  homeCoach: number;
  awayRoster: number;
  awayQB: number;
  awayCoach: number;
}

export interface EdgeResult {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  spreadOpen: number;
  modelSpread: number;
  rawEdge: number;
  effectiveEdge: number;
  uncertainty: UncertaintyBreakdown;
  side: 'home' | 'away';
  isHighUncertainty: boolean;
  requiresQBCheck: boolean;
  bettable: boolean;
  reason?: string;
}

export interface QBStatus {
  team: string;
  season: number;
  week: number;
  status: 'confirmed' | 'questionable' | 'out' | 'unknown';
  asOfTimestamp: Date;
  playerName?: string;
}

// =============================================================================
// HELPER FUNCTIONS (FROZEN - DO NOT MODIFY)
// =============================================================================

export function getRegimeWeights(week: number): { prior: number; inSeason: number } {
  if (week === 1) return REGIME_WEIGHTS.WEEK_1;
  if (week === 2) return REGIME_WEIGHTS.WEEK_2;
  if (week === 3) return REGIME_WEIGHTS.WEEK_3;
  if (week === 4) return REGIME_WEIGHTS.WEEK_4;
  return REGIME_WEIGHTS.WEEKS_5_PLUS;
}

export function getWeekUncertainty(week: number): number {
  if (week <= 1) return UNCERTAINTY_WEEK.WEEKS_0_1;
  if (week <= 4) return UNCERTAINTY_WEEK.WEEKS_2_4;
  return UNCERTAINTY_WEEK.WEEKS_5_PLUS;
}

export function calculateEffectiveEdge(rawEdge: number, uncertainty: number): number {
  return rawEdge * (1 - uncertainty);
}

export function isHighUncertainty(rawEdge: number, uncertainty: number): boolean {
  return Math.abs(rawEdge) >= EDGE_RULES.HIGH_EDGE_THRESHOLD &&
         uncertainty >= EDGE_RULES.HIGH_UNCERTAINTY_THRESHOLD;
}

/**
 * Determine if a bet is allowed based on rules.
 *
 * Fix A: QB OUT does NOT auto-reject. The uncertainty should already be
 * recomputed with QB_OUT_UNCERTAINTY_INCREASE. We just check thresholds.
 *
 * Fix B: Edge floor is market-specific. Totals also require weather.
 */
export function isBettable(
  effectiveEdge: number,
  uncertainty: number,
  week: number,
  qbStatus: 'confirmed' | 'questionable' | 'out' | 'unknown',
  edgePercentile: number,
  marketType: MarketType = 'spread',
  hasWeatherData: boolean = true
): { bettable: boolean; reason?: string } {
  const rules = week <= 4 ? BETTING_RULES.WEEKS_1_4 : BETTING_RULES.WEEKS_5_PLUS;

  // Check percentile threshold
  if (edgePercentile > rules.EDGE_PERCENTILE) {
    return { bettable: false, reason: `Below Top ${rules.EDGE_PERCENTILE * 100}% threshold` };
  }

  // Market-specific edge floor (Fix B)
  const edgeFloor = marketType === 'spread'
    ? BETTING_RULES.EDGE_FLOORS.SPREAD
    : BETTING_RULES.EDGE_FLOORS.TOTAL;

  if (Math.abs(effectiveEdge) < edgeFloor) {
    return { bettable: false, reason: `Effective edge below ${edgeFloor} pts (${marketType})` };
  }

  // Totals require weather data (Fix B)
  if (marketType === 'total' && BETTING_RULES.EDGE_FLOORS.TOTAL_REQUIRES_WEATHER && !hasWeatherData) {
    return { bettable: false, reason: 'Total bet requires weather data' };
  }

  // Check uncertainty cap (uncertainty should already include QB adjustments)
  if (uncertainty > rules.MAX_UNCERTAINTY) {
    return { bettable: false, reason: `Uncertainty ${uncertainty.toFixed(2)} exceeds ${rules.MAX_UNCERTAINTY}` };
  }

  // Check QB status requirement (Fix A - no hard block for 'out')
  // QB out/questionable/unknown should have ALREADY increased uncertainty via recomputation.
  // We only block 'unknown' in weeks 1-4 if REQUIRE_QB_STATUS is true.
  if (rules.REQUIRE_QB_STATUS && qbStatus === 'unknown') {
    return { bettable: false, reason: 'QB status unknown (required in weeks 1-4)' };
  }

  // Note: QB 'out' or 'questionable' is NOT a hard block.
  // The uncertainty was already increased, and if it still clears thresholds, we bet.
  // This avoids missing some of the best edges (per user requirement).

  return { bettable: true };
}

// =============================================================================
// FROZEN CONFIGURATION EXPORT
// =============================================================================

export const PRODUCTION_CONFIG = {
  version: MODEL_VERSION,
  id: MODEL_ID,
  promoted: PROMOTED_DATE,
  frozen: FROZEN,

  spread: { HFA, ELO_TO_SPREAD, MEAN_RATING },
  week0: WEEK0_PRIOR_WEIGHTS,
  regime: REGIME_WEIGHTS,
  update: { ...UPDATE_WEIGHTS, ...UPDATE_CONSTANTS },
  uncertainty: {
    week: UNCERTAINTY_WEEK,
    roster: UNCERTAINTY_ROSTER,
    qb: UNCERTAINTY_QB,
    coach: UNCERTAINTY_COACH,
    cap: UNCERTAINTY_CAP,
  },
  edge: EDGE_RULES,
  betting: BETTING_RULES,
  monitoring: MONITORING_THRESHOLDS,
} as const;

// Freeze the config object
Object.freeze(PRODUCTION_CONFIG);
