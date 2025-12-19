/**
 * Model Engine - Production v1
 *
 * Implements the frozen v3_ppadiff_regime2 model.
 * All parameters come from production-v1.ts - DO NOT hardcode values here.
 */

import {
  PRODUCTION_CONFIG,
  HFA,
  ELO_TO_SPREAD,
  UPDATE_CONSTANTS,
  UPDATE_WEIGHTS,
  UNCERTAINTY_CAP,
  UNCERTAINTY_ROSTER,
  UNCERTAINTY_QB,
  UNCERTAINTY_COACH,
  getWeekUncertainty,
  calculateEffectiveEdge,
  isHighUncertainty,
  isBettable,
  type Week0Rating,
  type UncertaintyBreakdown,
  type EdgeResult,
  type QBStatus,
} from './production-v1';

// =============================================================================
// TYPES
// =============================================================================

export interface GamePPA {
  gameId: number;
  season: number;
  week: number;
  team: string;
  opponent: string;
  offensePPA: number;
  defensePPA: number;
}

export interface BettingLine {
  cfbdGameId: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  spreadOpen: number;
  spreadClose?: number;
  homeScore?: number;
  awayScore?: number;
}

export interface TeamRating {
  team: string;
  season: number;
  week: number;
  rating: number;
  priorRating: number;
  uncertainty: number;
}

// =============================================================================
// SPREAD CALCULATION
// =============================================================================

export function calculateModelSpread(
  homeRating: number,
  awayRating: number
): number {
  const diff = homeRating - awayRating + HFA * ELO_TO_SPREAD;
  return -diff / ELO_TO_SPREAD;
}

export function calculateRawEdge(
  modelSpread: number,
  marketSpread: number
): number {
  return modelSpread - marketSpread;
}

// =============================================================================
// OPPONENT-ADJUSTED PPA
// =============================================================================

export function calculateOpponentAdjustedPPA(
  teamPPA: GamePPA,
  opponentPPA: GamePPA,
  teamPriorRating: number,
  opponentPriorRating: number,
  avgRating: number
): number {
  // Team's offensive PPA adjusted for opponent defensive strength
  const opponentDefenseStrength = (opponentPriorRating - avgRating) / 100;
  const adjustedOffensePPA = teamPPA.offensePPA + opponentDefenseStrength * 0.1;

  // Team's defensive PPA adjusted for opponent offensive strength
  const opponentOffenseStrength = (opponentPriorRating - avgRating) / 100;
  const adjustedDefensePPA = teamPPA.defensePPA - opponentOffenseStrength * 0.1;

  // Net PPA: offense - defense (positive = good)
  return adjustedOffensePPA - adjustedDefensePPA;
}

// =============================================================================
// WEEKLY RATING UPDATE
// =============================================================================

export function calculateRatingUpdate(
  homeAdjPPA: number,
  awayAdjPPA: number,
  margin: number,
  homeExpectedWin: number
): { homeUpdate: number; awayUpdate: number } {
  const { K_FACTOR, MARGIN_CAP, PPA_SCALE, PPA_DIFF_CAP, MAX_UPDATE } = UPDATE_CONSTANTS;
  const { PPA_WEIGHT, MARGIN_WEIGHT } = UPDATE_WEIGHTS;

  // Cap margin
  const cappedMargin = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, margin));

  // Margin-based update (Elo-style)
  const actualResult = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const marginUpdate = K_FACTOR * (actualResult - homeExpectedWin);

  // PPA-based update
  const ppaDiff = homeAdjPPA - awayAdjPPA;
  const cappedPPADiff = Math.max(-PPA_DIFF_CAP, Math.min(PPA_DIFF_CAP, ppaDiff));
  const ppaUpdate = cappedPPADiff * PPA_SCALE;

  // Blend: 75% PPA, 25% margin
  const totalUpdate = PPA_WEIGHT * ppaUpdate + MARGIN_WEIGHT * marginUpdate;

  // Cap total update
  const finalUpdate = Math.max(-MAX_UPDATE, Math.min(MAX_UPDATE, totalUpdate));

  return {
    homeUpdate: finalUpdate,
    awayUpdate: -finalUpdate,
  };
}

// =============================================================================
// UNCERTAINTY CALCULATION
// =============================================================================

export interface ReturningPPAQuartiles {
  q25: number;
  q50: number;
}

export function calculateTeamUncertainty(
  week0: Week0Rating | undefined,
  quartiles: ReturningPPAQuartiles
): { total: number; roster: number; qb: number; coach: number } {
  if (!week0) {
    return { total: 0.30, roster: 0.10, qb: 0.10, coach: 0.10 };
  }

  // Explicitly type as number to allow reassignment from as const values
  let rosterUnc: number = UNCERTAINTY_ROSTER.TOP_HALF;
  let qbUnc: number = UNCERTAINTY_QB.RETURNING;
  let coachUnc: number = UNCERTAINTY_COACH.RETURNING;

  // Roster churn proxy
  const pctReturning = week0.percentReturningPPA || 0.5;
  if (pctReturning < quartiles.q25) {
    rosterUnc = UNCERTAINTY_ROSTER.BOTTOM_QUARTILE;
  } else if (pctReturning < quartiles.q50) {
    rosterUnc = UNCERTAINTY_ROSTER.SECOND_QUARTILE;
  }

  // QB continuity
  if (week0.qbTransfersOut > 0) {
    qbUnc = UNCERTAINTY_QB.TRANSFER_OUT;
  }

  // Coaching change
  if (week0.coachingChange) {
    coachUnc = UNCERTAINTY_COACH.NEW_COACH;
  }

  return {
    total: rosterUnc + qbUnc + coachUnc,
    roster: rosterUnc,
    qb: qbUnc,
    coach: coachUnc,
  };
}

export function calculateGameUncertainty(
  homeWeek0: Week0Rating | undefined,
  awayWeek0: Week0Rating | undefined,
  week: number,
  quartiles: ReturningPPAQuartiles,
  homeQBStatus?: QBStatus,
  awayQBStatus?: QBStatus
): UncertaintyBreakdown {
  const weekUncertainty = getWeekUncertainty(week);

  const homeTeamUnc = calculateTeamUncertainty(homeWeek0, quartiles);
  const awayTeamUnc = calculateTeamUncertainty(awayWeek0, quartiles);

  // Adjust for QB status if provided
  let homeQBUnc = homeTeamUnc.qb;
  let awayQBUnc = awayTeamUnc.qb;

  if (homeQBStatus) {
    if (homeQBStatus.status === 'confirmed') {
      homeQBUnc = Math.max(0, homeQBUnc - 0.10);  // Reduce uncertainty
    } else if (homeQBStatus.status === 'unknown') {
      homeQBUnc += PRODUCTION_CONFIG.betting.QB_UNKNOWN_UNCERTAINTY_INCREASE;
    } else if (homeQBStatus.status === 'out' || homeQBStatus.status === 'questionable') {
      homeQBUnc += 0.20;  // Significant increase
    }
  }

  if (awayQBStatus) {
    if (awayQBStatus.status === 'confirmed') {
      awayQBUnc = Math.max(0, awayQBUnc - 0.10);
    } else if (awayQBStatus.status === 'unknown') {
      awayQBUnc += PRODUCTION_CONFIG.betting.QB_UNKNOWN_UNCERTAINTY_INCREASE;
    } else if (awayQBStatus.status === 'out' || awayQBStatus.status === 'questionable') {
      awayQBUnc += 0.20;
    }
  }

  // Average team uncertainties (with QB adjustments)
  const avgTeamUncertainty = (
    (homeTeamUnc.roster + homeQBUnc + homeTeamUnc.coach) +
    (awayTeamUnc.roster + awayQBUnc + awayTeamUnc.coach)
  ) / 2;

  const totalUncertainty = Math.min(UNCERTAINTY_CAP, weekUncertainty + avgTeamUncertainty);

  return {
    total: totalUncertainty,
    week: weekUncertainty,
    homeRoster: homeTeamUnc.roster,
    homeQB: homeQBUnc,
    homeCoach: homeTeamUnc.coach,
    awayRoster: awayTeamUnc.roster,
    awayQB: awayQBUnc,
    awayCoach: awayTeamUnc.coach,
  };
}

// =============================================================================
// EDGE GENERATION
// =============================================================================

export function generateEdge(
  game: BettingLine,
  homeRating: number,
  awayRating: number,
  homeWeek0: Week0Rating | undefined,
  awayWeek0: Week0Rating | undefined,
  quartiles: ReturningPPAQuartiles,
  homeQBStatus?: QBStatus,
  awayQBStatus?: QBStatus,
  edgePercentile?: number
): EdgeResult {
  // Calculate model spread
  const modelSpread = calculateModelSpread(homeRating, awayRating);
  const rawEdge = calculateRawEdge(modelSpread, game.spreadOpen);

  // Calculate uncertainty
  const uncertainty = calculateGameUncertainty(
    homeWeek0,
    awayWeek0,
    game.week,
    quartiles,
    homeQBStatus,
    awayQBStatus
  );

  // Calculate effective edge
  const effectiveEdge = calculateEffectiveEdge(rawEdge, uncertainty.total);

  // Determine side
  const side: 'home' | 'away' = rawEdge < 0 ? 'home' : 'away';

  // Check if high uncertainty
  const highUncertainty = isHighUncertainty(rawEdge, uncertainty.total);

  // Check if requires QB check
  const requiresQBCheck = highUncertainty && (uncertainty.homeQB > 0.10 || uncertainty.awayQB > 0.10);

  // Determine QB status for betting check
  const qbStatus = homeQBStatus?.status === 'unknown' || awayQBStatus?.status === 'unknown'
    ? 'unknown'
    : homeQBStatus?.status === 'out' || awayQBStatus?.status === 'out'
    ? 'out'
    : 'confirmed';

  // Check if bettable (only if percentile provided)
  let bettable = false;
  let reason: string | undefined;

  if (edgePercentile !== undefined) {
    const result = isBettable(
      effectiveEdge,
      uncertainty.total,
      game.week,
      qbStatus,
      edgePercentile
    );
    bettable = result.bettable;
    reason = result.reason;
  }

  return {
    season: game.season,
    week: game.week,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    spreadOpen: game.spreadOpen,
    modelSpread,
    rawEdge,
    effectiveEdge,
    uncertainty,
    side,
    isHighUncertainty: highUncertainty,
    requiresQBCheck,
    bettable,
    reason,
  };
}

// =============================================================================
// BATCH EDGE RANKING
// =============================================================================

export function rankEdgesByEffective(edges: EdgeResult[]): EdgeResult[] {
  // Sort by absolute effective edge descending
  const sorted = [...edges].sort((a, b) =>
    Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge)
  );

  // Assign percentiles and update bettability
  return sorted.map((edge, index) => {
    const percentile = (index + 1) / sorted.length;

    // Re-check bettability with actual percentile
    const qbStatus = edge.uncertainty.homeQB > 0.15 || edge.uncertainty.awayQB > 0.15
      ? 'unknown'
      : 'confirmed';

    const result = isBettable(
      edge.effectiveEdge,
      edge.uncertainty.total,
      edge.week,
      qbStatus,
      percentile
    );

    return {
      ...edge,
      bettable: result.bettable,
      reason: result.reason,
    };
  });
}

// =============================================================================
// EXPORT CONFIG FOR VALIDATION
// =============================================================================

export function getModelConfig() {
  return PRODUCTION_CONFIG;
}

export function validateConfigFrozen(): boolean {
  return PRODUCTION_CONFIG.frozen === true;
}
