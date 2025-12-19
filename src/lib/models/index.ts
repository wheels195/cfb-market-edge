/**
 * CFB Market Edge - Model Exports
 *
 * Production Model: v3_ppadiff_regime2
 * Promoted: 2025-12-19
 */

// Production configuration (FROZEN)
export {
  MODEL_VERSION,
  MODEL_ID,
  PROMOTED_DATE,
  FROZEN,
  PRODUCTION_CONFIG,
  // Constants
  HFA,
  ELO_TO_SPREAD,
  MEAN_RATING,
  // Weights
  WEEK0_PRIOR_WEIGHTS,
  REGIME_WEIGHTS,
  UPDATE_WEIGHTS,
  UPDATE_CONSTANTS,
  // Uncertainty
  UNCERTAINTY_WEEK,
  UNCERTAINTY_ROSTER,
  UNCERTAINTY_QB,
  UNCERTAINTY_COACH,
  UNCERTAINTY_CAP,
  // Rules
  EDGE_RULES,
  BETTING_RULES,
  MONITORING_THRESHOLDS,
  // Helper functions
  getRegimeWeights,
  getWeekUncertainty,
  calculateEffectiveEdge,
  isHighUncertainty,
  isBettable,
  // Types
  type Week0Rating,
  type UncertaintyBreakdown,
  type EdgeResult,
  type QBStatus,
} from './production-v1';

// Model engine
export {
  calculateModelSpread,
  calculateRawEdge,
  calculateOpponentAdjustedPPA,
  calculateRatingUpdate,
  calculateTeamUncertainty,
  calculateGameUncertainty,
  generateEdge,
  rankEdgesByEffective,
  getModelConfig,
  validateConfigFrozen,
  type GamePPA,
  type BettingLine,
  type TeamRating,
  type ReturningPPAQuartiles,
} from './model-engine';

// QB Status (pre-kickoff predictions)
export {
  QBStatusStore,
  getQBUncertaintyAdjustment,
  getMaxQBProjectionAdjustment,
  validatePreKickoff,
  isQBStatusStale,
  type QBStatusRecord,
  type QBStatusInput,
} from './qb-status';

// QB Starter (post-game truth)
export {
  QBStarterStore,
  identifyStartingQBs,
  extractStartingQB,
  type QBStarted,
  type QBStarterSyncResult,
} from './qb-starter';

// Betting rules
export {
  decideBet,
  processBettingSlate,
  generateBetSlips,
  formatBetSlip,
  formatSlateReport,
  type BetDecision,
  type BetCandidate,
  type BettingSlate,
  type BetSlip,
} from './betting-rules';

// Monitoring
export {
  MonitoringStore,
  type BetRecord,
  type CLVMetrics,
  type PerformanceMetrics,
  type Alert,
} from './monitoring';

// Operations
export {
  assertNoLeakage,
  assertPriorRatings,
  assertPreKickoffSpread,
  OperationsStore,
  runLeakageTests,
  type HealthStatus,
  type OddsTickHash,
  type DataIntegrityReport,
} from './operations';
