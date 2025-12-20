/**
 * V2 Model: Elo + Offensive PPA
 *
 * Guardrails (LOCKED):
 * - Train: 2022-2023 (no 2024 data used in training)
 * - Test: 2024 (out-of-sample evaluation only)
 * - Exclusions: Any game with missing Elo (FCS teams)
 * - Features: Elo difference + HFA + offensive PPA difference
 * - V1 baseline preserved for comparison
 *
 * New Feature: Offensive PPA (EPA/play equivalent)
 * - Higher off_ppa = more efficient offense
 * - off_ppa_diff = home_off_ppa - away_off_ppa
 * - Positive diff → home has offensive advantage
 */

import {
  V1ModelConfig,
  DEFAULT_V1_CONFIG,
  projectSpread as v1ProjectSpread,
  calculateEdge,
  didCover,
  calculateProfit,
  calculateCLV,
  brierScore,
  impliedProbability,
} from './v1-elo-model';

export interface V2ModelConfig extends V1ModelConfig {
  // Weight for offensive PPA difference
  // Converts off_ppa_diff to expected points
  offPPAWeight: number;
}

export const DEFAULT_V2_CONFIG: V2ModelConfig = {
  ...DEFAULT_V1_CONFIG,
  offPPAWeight: 10, // Initial guess: 10 pts per 1.0 off_ppa difference
};

export interface V2Projection {
  eventId: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  homeOffPPA: number | null;
  awayOffPPA: number | null;
  eloDiff: number;
  offPPADiff: number;
  projectedHomeMargin: number;
  modelSpreadHome: number;
  // Components for analysis
  eloComponent: number;
  hfaComponent: number;
  offPPAComponent: number;
}

/**
 * Project spread using Elo + off_ppa model
 *
 * Formula:
 *   elo_component = (home_elo - away_elo) / elo_points_factor
 *   ppa_component = (home_off_ppa - away_off_ppa) * off_ppa_weight
 *   projected_home_margin = elo_component + home_field_advantage + ppa_component
 *   model_spread_home = -projected_home_margin
 */
export function projectSpreadV2(
  homeElo: number,
  awayElo: number,
  homeOffPPA: number | null,
  awayOffPPA: number | null,
  config: V2ModelConfig = DEFAULT_V2_CONFIG
): {
  projectedHomeMargin: number;
  modelSpreadHome: number;
  eloComponent: number;
  hfaComponent: number;
  offPPAComponent: number;
} {
  const eloDiff = homeElo - awayElo;
  const eloComponent = eloDiff / config.eloPointsFactor;
  const hfaComponent = config.homeFieldAdvantage;

  // Handle missing PPA - default to 0 (neutral)
  const offPPADiff =
    homeOffPPA !== null && awayOffPPA !== null
      ? homeOffPPA - awayOffPPA
      : 0;
  const offPPAComponent = offPPADiff * config.offPPAWeight;

  const projectedHomeMargin = eloComponent + hfaComponent + offPPAComponent;
  const modelSpreadHome = -projectedHomeMargin;

  return {
    projectedHomeMargin,
    modelSpreadHome,
    eloComponent,
    hfaComponent,
    offPPAComponent,
  };
}

// Re-export V1 functions for convenience
export {
  calculateEdge,
  didCover,
  calculateProfit,
  calculateCLV,
  brierScore,
  impliedProbability,
};
