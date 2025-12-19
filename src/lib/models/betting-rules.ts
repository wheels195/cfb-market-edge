/**
 * Betting Rules - Hard-Coded, No Discretion
 *
 * This is where models usually fail. These rules are absolute.
 *
 * ONLY BET:
 *   - Top 5% effective edges (default)
 *   - QB status known OR uncertainty below threshold
 *
 * NEVER BET:
 *   - High uncertainty games without QB confirmation
 *   - Games where effective edge < minimum floor
 *   - Games missing critical data
 *
 * SEPARATE RULES FOR:
 *   - Weeks 1-4 (stricter)
 *   - Weeks 5+ (slightly relaxed)
 *
 * QB DATA SOURCES (CRITICAL):
 *   - LIVE BETTING: Use qb_status (pre-kickoff) ONLY
 *   - POST-GAME ANALYTICS: Use qb_started (post-game truth) ONLY
 *
 * GUARD: This module MUST NOT import or use qb_started data.
 * All QB data here comes from QBStatus type (qb_status table).
 * qb_started is for validation and analytics AFTER games are complete.
 */

import {
  BETTING_RULES,
  EDGE_RULES,
  type EdgeResult,
  type QBStatus,
} from './production-v1';

// =============================================================================
// BET DECISION
// =============================================================================

export interface BetDecision {
  shouldBet: boolean;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface BetCandidate {
  edge: EdgeResult;
  homeQBStatus: QBStatus;
  awayQBStatus: QBStatus;
  percentile: number;  // 0.01 = top 1%, 0.05 = top 5%
  marketType?: 'spread' | 'total';
  hasWeatherData?: boolean;
}

// =============================================================================
// CORE BETTING LOGIC
// =============================================================================

/**
 * Main betting decision function - NO DISCRETION
 */
export function decideBet(candidate: BetCandidate): BetDecision {
  const { edge, homeQBStatus, awayQBStatus, percentile } = candidate;
  const warnings: string[] = [];

  // Get week-specific rules
  const rules = edge.week <= 4 ? BETTING_RULES.WEEKS_1_4 : BETTING_RULES.WEEKS_5_PLUS;
  const weekLabel = edge.week <= 4 ? 'Weeks 1-4' : 'Weeks 5+';

  // ==========================================================================
  // ABSOLUTE NO-BET CONDITIONS (checked first)
  // ==========================================================================

  // 1. Missing critical data
  if (edge.spreadOpen === null || edge.spreadOpen === undefined) {
    return {
      shouldBet: false,
      reason: 'NEVER BET: Missing spread data',
      confidence: 'high',
      warnings: ['Critical data missing'],
    };
  }

  // 2. Effective edge below market-specific floor (Fix B)
  const marketType = candidate.marketType || 'spread';
  const edgeFloor = marketType === 'spread'
    ? BETTING_RULES.EDGE_FLOORS.SPREAD
    : BETTING_RULES.EDGE_FLOORS.TOTAL;

  if (Math.abs(edge.effectiveEdge) < edgeFloor) {
    return {
      shouldBet: false,
      reason: `NEVER BET: Effective edge ${Math.abs(edge.effectiveEdge).toFixed(1)} below ${edgeFloor} pt floor (${marketType})`,
      confidence: 'high',
      warnings: [],
    };
  }

  // 3. Totals require weather data (Fix B)
  if (marketType === 'total' && BETTING_RULES.EDGE_FLOORS.TOTAL_REQUIRES_WEATHER) {
    if (!candidate.hasWeatherData) {
      return {
        shouldBet: false,
        reason: 'NEVER BET: Total bet requires weather data',
        confidence: 'high',
        warnings: [],
      };
    }
  }

  // 4. High uncertainty without QB confirmation (Weeks 1-4)
  if (edge.week <= 4 && edge.isHighUncertainty) {
    const homeUnknown = homeQBStatus.status === 'unknown';
    const awayUnknown = awayQBStatus.status === 'unknown';

    if (homeUnknown || awayUnknown) {
      return {
        shouldBet: false,
        reason: 'NEVER BET: High uncertainty + unknown QB in Weeks 1-4',
        confidence: 'high',
        warnings: [
          homeUnknown ? `Home QB (${edge.homeTeam}) status unknown` : '',
          awayUnknown ? `Away QB (${edge.awayTeam}) status unknown` : '',
        ].filter(Boolean),
      };
    }
  }

  // NOTE (Fix A): QB OUT is NOT an auto-reject.
  // The uncertainty should have been recomputed with QB_OUT_UNCERTAINTY_INCREASE.
  // If it still clears thresholds, we bet. This avoids missing best edges.
  // We add warnings for QB out/questionable but don't hard block.

  // ==========================================================================
  // PERCENTILE CHECK
  // ==========================================================================

  if (percentile > rules.EDGE_PERCENTILE) {
    return {
      shouldBet: false,
      reason: `NO BET: Percentile ${(percentile * 100).toFixed(0)}% exceeds Top ${(rules.EDGE_PERCENTILE * 100).toFixed(0)}% threshold (${weekLabel})`,
      confidence: 'high',
      warnings: [],
    };
  }

  // ==========================================================================
  // UNCERTAINTY CHECK
  // ==========================================================================

  if (edge.uncertainty.total > rules.MAX_UNCERTAINTY) {
    return {
      shouldBet: false,
      reason: `NO BET: Uncertainty ${edge.uncertainty.total.toFixed(2)} exceeds ${rules.MAX_UNCERTAINTY} limit (${weekLabel})`,
      confidence: 'high',
      warnings: [],
    };
  }

  // ==========================================================================
  // QB STATUS CHECK
  // ==========================================================================

  if (rules.REQUIRE_QB_STATUS) {
    const homeUnknown = homeQBStatus.status === 'unknown';
    const awayUnknown = awayQBStatus.status === 'unknown';

    if (homeUnknown || awayUnknown) {
      return {
        shouldBet: false,
        reason: `NO BET: QB status required in ${weekLabel} but unknown`,
        confidence: 'high',
        warnings: [
          homeUnknown ? `${edge.homeTeam} QB unknown` : '',
          awayUnknown ? `${edge.awayTeam} QB unknown` : '',
        ].filter(Boolean),
      };
    }
  }

  // ==========================================================================
  // WARNINGS (non-blocking but tracked)
  // ==========================================================================

  if (homeQBStatus.status === 'questionable') {
    warnings.push(`${edge.homeTeam} QB questionable`);
  }
  if (awayQBStatus.status === 'questionable') {
    warnings.push(`${edge.awayTeam} QB questionable`);
  }
  if (edge.week <= 2) {
    warnings.push('Very early season (Week 1-2)');
  }
  if (edge.uncertainty.total > 0.40) {
    warnings.push(`Elevated uncertainty: ${edge.uncertainty.total.toFixed(2)}`);
  }

  // ==========================================================================
  // BET APPROVED
  // ==========================================================================

  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (warnings.length > 0) confidence = 'medium';
  if (warnings.length > 2 || edge.uncertainty.total > 0.45) confidence = 'low';

  return {
    shouldBet: true,
    reason: `BET: Top ${(percentile * 100).toFixed(0)}% effective edge (${weekLabel}), eff=${edge.effectiveEdge.toFixed(1)}, unc=${edge.uncertainty.total.toFixed(2)}`,
    confidence,
    warnings,
  };
}

// =============================================================================
// BATCH BETTING DECISIONS
// =============================================================================

export interface BettingSlate {
  week: number;
  season: number;
  totalGames: number;
  bettableGames: BetCandidate[];
  passedGames: BetCandidate[];
  decisions: Map<string, BetDecision>;
}

/**
 * Process a full slate of games and return betting decisions
 */
export function processBettingSlate(
  edges: EdgeResult[],
  qbStatusMap: Map<string, QBStatus>,
  season: number,
  week: number
): BettingSlate {
  // Sort by effective edge to determine percentiles
  const sorted = [...edges].sort((a, b) =>
    Math.abs(b.effectiveEdge) - Math.abs(a.effectiveEdge)
  );

  const decisions = new Map<string, BetDecision>();
  const bettableGames: BetCandidate[] = [];
  const passedGames: BetCandidate[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const edge = sorted[i];
    const percentile = (i + 1) / sorted.length;

    // Get QB status
    const homeKey = `${edge.homeTeam.toLowerCase()}-${season}-${week}`;
    const awayKey = `${edge.awayTeam.toLowerCase()}-${season}-${week}`;

    const homeQBStatus: QBStatus = qbStatusMap.get(homeKey) || {
      team: edge.homeTeam,
      season,
      week,
      status: 'unknown',
      asOfTimestamp: new Date(),
    };

    const awayQBStatus: QBStatus = qbStatusMap.get(awayKey) || {
      team: edge.awayTeam,
      season,
      week,
      status: 'unknown',
      asOfTimestamp: new Date(),
    };

    const candidate: BetCandidate = {
      edge,
      homeQBStatus,
      awayQBStatus,
      percentile,
    };

    const decision = decideBet(candidate);
    const gameKey = `${edge.awayTeam}@${edge.homeTeam}`;
    decisions.set(gameKey, decision);

    if (decision.shouldBet) {
      bettableGames.push(candidate);
    } else {
      passedGames.push(candidate);
    }
  }

  return {
    week,
    season,
    totalGames: edges.length,
    bettableGames,
    passedGames,
    decisions,
  };
}

// =============================================================================
// BET SLIP GENERATION
// =============================================================================

export interface BetSlip {
  gameKey: string;
  side: 'home' | 'away';
  team: string;
  spreadAtBet: number;
  effectiveEdge: number;
  rawEdge: number;
  uncertainty: number;
  percentile: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  model: string;
  timestamp: Date;
}

export function generateBetSlips(slate: BettingSlate): BetSlip[] {
  const slips: BetSlip[] = [];

  for (const candidate of slate.bettableGames) {
    const { edge, percentile } = candidate;
    const decision = slate.decisions.get(`${edge.awayTeam}@${edge.homeTeam}`);

    if (!decision || !decision.shouldBet) continue;

    const slip: BetSlip = {
      gameKey: `${edge.awayTeam}@${edge.homeTeam}`,
      side: edge.side,
      team: edge.side === 'home' ? edge.homeTeam : edge.awayTeam,
      spreadAtBet: edge.spreadOpen,
      effectiveEdge: edge.effectiveEdge,
      rawEdge: edge.rawEdge,
      uncertainty: edge.uncertainty.total,
      percentile,
      confidence: decision.confidence,
      warnings: decision.warnings,
      model: 'production-v1',
      timestamp: new Date(),
    };

    slips.push(slip);
  }

  return slips;
}

// =============================================================================
// FORMATTED OUTPUT
// =============================================================================

export function formatBetSlip(slip: BetSlip): string {
  const spreadStr = slip.spreadAtBet >= 0 ? `+${slip.spreadAtBet}` : `${slip.spreadAtBet}`;
  const edgeStr = slip.effectiveEdge >= 0 ? `+${slip.effectiveEdge.toFixed(1)}` : slip.effectiveEdge.toFixed(1);

  let output = `BET: ${slip.team} ${spreadStr}`;
  output += `\n  Edge: ${edgeStr} pts (Top ${(slip.percentile * 100).toFixed(0)}%)`;
  output += `\n  Uncertainty: ${slip.uncertainty.toFixed(2)}`;
  output += `\n  Confidence: ${slip.confidence.toUpperCase()}`;

  if (slip.warnings.length > 0) {
    output += `\n  Warnings: ${slip.warnings.join(', ')}`;
  }

  return output;
}

export function formatSlateReport(slate: BettingSlate): string {
  let report = `\n=== BETTING SLATE: Week ${slate.week}, ${slate.season} ===\n`;
  report += `Total games: ${slate.totalGames}\n`;
  report += `Bettable: ${slate.bettableGames.length}\n`;
  report += `Passed: ${slate.passedGames.length}\n\n`;

  if (slate.bettableGames.length > 0) {
    report += '--- BETS ---\n';
    const slips = generateBetSlips(slate);
    for (const slip of slips) {
      report += formatBetSlip(slip) + '\n\n';
    }
  } else {
    report += 'No bets this week.\n';
  }

  // Show top passed games with reasons
  report += '\n--- TOP PASSED GAMES ---\n';
  const topPassed = slate.passedGames.slice(0, 5);
  for (const candidate of topPassed) {
    const decision = slate.decisions.get(`${candidate.edge.awayTeam}@${candidate.edge.homeTeam}`);
    report += `${candidate.edge.awayTeam} @ ${candidate.edge.homeTeam}`;
    report += ` (eff: ${candidate.edge.effectiveEdge.toFixed(1)})`;
    report += `\n  ${decision?.reason || 'Unknown'}\n`;
  }

  return report;
}
