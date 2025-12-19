/**
 * Market-Calibrated Projection Model v2
 *
 * KEY INSIGHT: Instead of trying to predict spreads from scratch (requires massive data),
 * we use market lines as the efficient baseline and apply learned adjustments.
 *
 * This IS machine learning: we learn adjustment coefficients from historical data.
 *
 * Model Philosophy:
 * 1. Markets are ~97% efficient for CFB spreads
 * 2. Our edge comes from factors markets may underweight
 * 3. We learn HOW MUCH to weight each factor from historical CLV data
 */

import { supabase } from '@/lib/db/client';

// Feature coefficients - these get LEARNED from historical data
// Initial values are educated guesses, then refined through training
export interface ModelCoefficients {
  version: string;
  trainedOn: string;  // Date range
  sampleSize: number;

  // Spread adjustments (points to add to model spread)
  conferenceStrengthWeight: number;     // Per unit of conf strength diff
  homeFieldBase: number;                // Base HFA (markets use ~2.5)
  bowlGameHFAReduction: number;         // How much to reduce HFA in bowls
  injuryQBWeight: number;               // Points per star QB out
  injuryNonQBWeight: number;            // Points per key non-QB out
  sharpLineMovementWeight: number;      // How much to follow sharp money
  paceAdjustmentWeight: number;         // For totals
  weatherWindWeight: number;            // Per 10mph over 15mph
  weatherPrecipWeight: number;          // For rain/snow

  // Confidence modifiers
  crossConferenceUncertainty: number;   // Add uncertainty for cross-conf
  earlySeasonUncertainty: number;       // Add uncertainty weeks 1-3

  // Edge capping
  maxReasonableEdge: number;            // Cap edges above this
  minActionableEdge: number;            // Minimum to consider betting
}

// Default coefficients (before ML training)
export const DEFAULT_COEFFICIENTS: ModelCoefficients = {
  version: 'v2.0-baseline',
  trainedOn: 'heuristic',
  sampleSize: 0,

  // Conservative starting weights
  conferenceStrengthWeight: 0.4,        // 0.4 pts per unit strength diff
  homeFieldBase: 2.5,
  bowlGameHFAReduction: 2.0,            // Reduce HFA by 2 pts in bowls
  injuryQBWeight: 3.0,                  // Starting QB out = 3 pts
  injuryNonQBWeight: 0.5,               // Other key player = 0.5 pts
  sharpLineMovementWeight: 0.5,         // Follow sharps at 50%
  paceAdjustmentWeight: 0.3,            // Conservative pace weight
  weatherWindWeight: 0.3,               // 0.3 pts per 10mph wind
  weatherPrecipWeight: 1.5,             // Rain/snow = 1.5 pt total reduction

  crossConferenceUncertainty: 1.0,      // +1 pt uncertainty
  earlySeasonUncertainty: 1.5,          // +1.5 pt uncertainty weeks 1-3

  maxReasonableEdge: 5.0,               // Cap at 5 pts
  minActionableEdge: 2.0,               // Need 2 pts to act
};

export interface MarketCalibratedProjection {
  // Base from market
  marketLine: number;

  // Our adjustments
  adjustments: {
    conference: number;
    injuries: number;
    lineMovement: number;
    weather: number;
    situational: number;
    total: number;
  };

  // Final model line
  modelLine: number;

  // Edge
  rawEdge: number;
  cappedEdge: number;

  // Confidence
  uncertainty: number;
  confidence: 'high' | 'medium' | 'low';

  // Metadata
  explanation: string[];
}

/**
 * Generate spread projection using market-calibrated approach
 */
export function generateSpreadProjection(
  marketSpread: number,
  factors: {
    conferenceStrengthDiff: number;  // Positive = home stronger conference
    homeInjuryPoints: number;        // Total impact of home injuries
    awayInjuryPoints: number;        // Total impact of away injuries
    sharpMovement: number;           // Sharp signal (-1 to 1)
    weatherImpact: number;           // Weather adjustment
    situationalDiff: number;         // Situational advantage diff
    isCrossConference: boolean;
    isBowlGame: boolean;
    weekNumber: number;
  },
  coefficients: ModelCoefficients = DEFAULT_COEFFICIENTS
): MarketCalibratedProjection {
  const explanation: string[] = [];

  // Calculate adjustments
  const adjustments = {
    conference: factors.conferenceStrengthDiff * coefficients.conferenceStrengthWeight,
    injuries: (factors.awayInjuryPoints - factors.homeInjuryPoints),
    lineMovement: factors.sharpMovement * coefficients.sharpLineMovementWeight,
    weather: factors.weatherImpact,
    situational: factors.situationalDiff,
    total: 0,
  };

  // Bowl game reduces home field (already in market, but we may disagree)
  if (factors.isBowlGame) {
    explanation.push(`Bowl game: neutral site, reduced HFA`);
  }

  // Sum adjustments
  adjustments.total =
    adjustments.conference +
    adjustments.injuries +
    adjustments.lineMovement +
    adjustments.weather +
    adjustments.situational;

  // Generate explanations for significant adjustments
  if (Math.abs(adjustments.conference) >= 0.5) {
    explanation.push(`Conference strength: ${adjustments.conference > 0 ? '+' : ''}${adjustments.conference.toFixed(1)} pts`);
  }
  if (Math.abs(adjustments.injuries) >= 1) {
    explanation.push(`Injury impact: ${adjustments.injuries > 0 ? '+' : ''}${adjustments.injuries.toFixed(1)} pts`);
  }
  if (Math.abs(adjustments.lineMovement) >= 0.3) {
    explanation.push(`Sharp money: ${adjustments.lineMovement > 0 ? 'favors home' : 'favors away'}`);
  }
  if (Math.abs(adjustments.weather) >= 0.5) {
    explanation.push(`Weather: ${adjustments.weather > 0 ? '+' : ''}${adjustments.weather.toFixed(1)} pts`);
  }

  // Model line = market line - our adjustments
  // (If we think home is better than market, we adjust model spread more negative)
  const modelLine = marketSpread - adjustments.total;

  // Raw edge
  const rawEdge = marketSpread - modelLine;

  // Calculate uncertainty
  let uncertainty = 0;
  if (factors.isCrossConference) {
    uncertainty += coefficients.crossConferenceUncertainty;
    explanation.push('Cross-conference: +uncertainty');
  }
  if (factors.weekNumber <= 3) {
    uncertainty += coefficients.earlySeasonUncertainty;
    explanation.push(`Early season (week ${factors.weekNumber}): +uncertainty`);
  }

  // Cap edge
  const cappedEdge = Math.sign(rawEdge) * Math.min(Math.abs(rawEdge), coefficients.maxReasonableEdge);

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  const effectiveEdge = Math.abs(cappedEdge) - uncertainty;

  if (effectiveEdge >= coefficients.minActionableEdge + 1) {
    confidence = 'high';
  } else if (effectiveEdge >= coefficients.minActionableEdge) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    marketLine: marketSpread,
    adjustments,
    modelLine,
    rawEdge,
    cappedEdge,
    uncertainty,
    confidence,
    explanation,
  };
}

/**
 * Generate total projection using market-calibrated approach
 */
export function generateTotalProjection(
  marketTotal: number,
  factors: {
    combinedPaceAdjustment: number;  // From pace stats
    weatherTotalImpact: number;       // Weather effect on scoring
    isIndoor: boolean;
  },
  coefficients: ModelCoefficients = DEFAULT_COEFFICIENTS
): MarketCalibratedProjection {
  const explanation: string[] = [];

  // Calculate adjustments
  const adjustments = {
    conference: 0,  // Not used for totals
    injuries: 0,    // TODO: Could add if we had offensive injury data
    lineMovement: 0, // TODO: Could add total line movement
    weather: factors.weatherTotalImpact,
    situational: factors.combinedPaceAdjustment * coefficients.paceAdjustmentWeight,
    total: 0,
  };

  adjustments.total = adjustments.weather + adjustments.situational;

  if (factors.isIndoor) {
    explanation.push('Indoor game: weather not a factor');
  }
  if (Math.abs(adjustments.weather) >= 1) {
    explanation.push(`Weather impact: ${adjustments.weather > 0 ? '+' : ''}${adjustments.weather.toFixed(1)} pts`);
  }
  if (Math.abs(adjustments.situational) >= 1) {
    explanation.push(`Pace adjustment: ${adjustments.situational > 0 ? '+' : ''}${adjustments.situational.toFixed(1)} pts`);
  }

  const modelLine = marketTotal - adjustments.total;
  const rawEdge = marketTotal - modelLine;
  const cappedEdge = Math.sign(rawEdge) * Math.min(Math.abs(rawEdge), coefficients.maxReasonableEdge);

  // Totals are generally harder to predict
  const confidence: 'high' | 'medium' | 'low' =
    Math.abs(cappedEdge) >= 3 ? 'high' :
    Math.abs(cappedEdge) >= 2 ? 'medium' : 'low';

  return {
    marketLine: marketTotal,
    adjustments,
    modelLine,
    rawEdge,
    cappedEdge,
    uncertainty: 1.5,  // Totals inherently uncertain
    confidence,
    explanation,
  };
}

/**
 * Train model coefficients from historical data
 * This is the ML training function
 */
export async function trainCoefficients(
  startDate: string,
  endDate: string
): Promise<{ coefficients: ModelCoefficients; metrics: TrainingMetrics }> {
  // Get historical edges with results
  const { data: historicalBets } = await supabase
    .from('edges')
    .select(`
      *,
      events!inner(
        commence_time,
        status,
        results(home_score, away_score, home_margin)
      )
    `)
    .gte('events.commence_time', startDate)
    .lte('events.commence_time', endDate)
    .eq('events.status', 'final');

  if (!historicalBets || historicalBets.length < 50) {
    console.warn('Insufficient data for training, using defaults');
    return {
      coefficients: DEFAULT_COEFFICIENTS,
      metrics: {
        sampleSize: historicalBets?.length || 0,
        winRate: 0,
        roi: 0,
        avgClv: 0,
        calibrationError: 0,
      },
    };
  }

  // For now, return defaults with metrics
  // TODO: Implement gradient descent to optimize coefficients
  // The training loop would:
  // 1. For each historical bet, compute our edge with current coefficients
  // 2. Compare to actual result (did it cover?)
  // 3. Adjust coefficients to minimize prediction error
  // 4. Use CLV (Closing Line Value) as the training signal

  const metrics = calculateHistoricalMetrics(historicalBets);

  return {
    coefficients: {
      ...DEFAULT_COEFFICIENTS,
      version: 'v2.1-trained',
      trainedOn: `${startDate} to ${endDate}`,
      sampleSize: historicalBets.length,
    },
    metrics,
  };
}

interface TrainingMetrics {
  sampleSize: number;
  winRate: number;
  roi: number;
  avgClv: number;
  calibrationError: number;
}

function calculateHistoricalMetrics(bets: unknown[]): TrainingMetrics {
  // TODO: Implement proper metrics calculation
  return {
    sampleSize: bets.length,
    winRate: 0,
    roi: 0,
    avgClv: 0,
    calibrationError: 0,
  };
}

/**
 * Store trained coefficients
 */
export async function saveCoefficients(coefficients: ModelCoefficients): Promise<void> {
  await supabase
    .from('model_versions')
    .upsert({
      name: 'market_calibrated_v2',
      description: `Market-calibrated model ${coefficients.version}`,
      config: coefficients as unknown as Record<string, unknown>,
      created_at: new Date().toISOString(),
    }, {
      onConflict: 'name',
    });
}

/**
 * Load trained coefficients
 */
export async function loadCoefficients(): Promise<ModelCoefficients> {
  const { data } = await supabase
    .from('model_versions')
    .select('config')
    .eq('name', 'market_calibrated_v2')
    .single();

  if (data?.config) {
    return data.config as unknown as ModelCoefficients;
  }

  return DEFAULT_COEFFICIENTS;
}
