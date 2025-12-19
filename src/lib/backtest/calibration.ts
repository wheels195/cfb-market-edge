/**
 * Calibration system: Maps edge size to win probability
 * Based on historical backtest results
 */

export interface CalibrationPoint {
  edgeMin: number;
  edgeMax: number;
  sampleSize: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;        // Wins / (Wins + Losses)
  roi: number;            // ROI at -110 odds
  expectedValue: number;  // EV per $100 bet
}

export interface CalibrationCurve {
  points: CalibrationPoint[];
  overallWinRate: number;
  overallROI: number;
  totalGames: number;
  confidenceByEdge: Map<number, number>; // Edge threshold -> Win probability
}

/**
 * Build calibration curve from backtest results
 */
export function buildCalibrationCurve(
  results: Array<{
    edge: number;
    actualResult: 'win' | 'loss' | 'push';
  }>,
  edgeBuckets: number[] = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10]
): CalibrationCurve {
  const points: CalibrationPoint[] = [];

  // Calculate stats for each edge bucket
  for (let i = 0; i < edgeBuckets.length; i++) {
    const edgeMin = edgeBuckets[i];
    const edgeMax = i < edgeBuckets.length - 1 ? edgeBuckets[i + 1] : Infinity;

    const bucketResults = results.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= edgeMin && absEdge < edgeMax;
    });

    const wins = bucketResults.filter(r => r.actualResult === 'win').length;
    const losses = bucketResults.filter(r => r.actualResult === 'loss').length;
    const pushes = bucketResults.filter(r => r.actualResult === 'push').length;
    const decided = wins + losses;

    const winRate = decided > 0 ? wins / decided : 0;
    // ROI at -110: (wins * 100 - losses * 110) / (decided * 110) * 100
    const roi = decided > 0 ? ((wins * 100 - losses * 110) / (decided * 110)) * 100 : 0;
    // EV per $100 bet at -110
    const expectedValue = decided > 0 ? (wins * 100 - losses * 110) / decided : 0;

    points.push({
      edgeMin,
      edgeMax: edgeMax === Infinity ? 99 : edgeMax,
      sampleSize: bucketResults.length,
      wins,
      losses,
      pushes,
      winRate,
      roi,
      expectedValue,
    });
  }

  // Calculate overall stats
  const allDecided = results.filter(r => r.actualResult !== 'push');
  const totalWins = allDecided.filter(r => r.actualResult === 'win').length;
  const totalLosses = allDecided.filter(r => r.actualResult === 'loss').length;

  const overallWinRate = allDecided.length > 0 ? totalWins / allDecided.length : 0;
  const overallROI = allDecided.length > 0
    ? ((totalWins * 100 - totalLosses * 110) / (allDecided.length * 110)) * 100
    : 0;

  // Build confidence map (cumulative win rate at edge threshold or higher)
  const confidenceByEdge = new Map<number, number>();
  for (const threshold of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10]) {
    const filtered = results.filter(r => Math.abs(r.edge) >= threshold && r.actualResult !== 'push');
    const wins = filtered.filter(r => r.actualResult === 'win').length;
    const winRate = filtered.length > 0 ? wins / filtered.length : 0;
    confidenceByEdge.set(threshold, winRate);
  }

  return {
    points,
    overallWinRate,
    overallROI,
    totalGames: results.length,
    confidenceByEdge,
  };
}

/**
 * Get win probability for a given edge size based on calibration
 */
export function getWinProbability(edge: number, calibration: CalibrationCurve): number {
  const absEdge = Math.abs(edge);

  // Find the appropriate bucket
  for (const point of calibration.points) {
    if (absEdge >= point.edgeMin && absEdge < point.edgeMax) {
      // If sample size is too small, use cumulative rate
      if (point.sampleSize < 30) {
        // Use the cumulative win rate at this threshold
        const cumulative = calibration.confidenceByEdge.get(point.edgeMin);
        if (cumulative !== undefined) return cumulative;
      }
      return point.winRate;
    }
  }

  // Default to overall win rate
  return calibration.overallWinRate;
}

/**
 * Calculate expected value for a bet
 * @param winProbability - Probability of winning (0-1)
 * @param odds - American odds (typically -110)
 * @returns EV per $100 wagered
 */
export function calculateExpectedValue(winProbability: number, odds: number = -110): number {
  // Convert American odds to decimal payout
  let payout: number;
  if (odds < 0) {
    payout = 100 / Math.abs(odds); // -110 -> 0.909
  } else {
    payout = odds / 100; // +150 -> 1.5
  }

  // EV = (win_prob * payout) - (lose_prob * 1)
  // Scaled to $100 bet
  const ev = (winProbability * payout * 100) - ((1 - winProbability) * 100);
  return Math.round(ev * 100) / 100;
}

/**
 * Get confidence tier based on edge and win probability
 */
export function getConfidenceTier(
  edge: number,
  winProbability: number
): 'very-high' | 'high' | 'medium' | 'low' | 'skip' {
  const absEdge = Math.abs(edge);

  // Very high: Large edge AND high win rate
  if (absEdge >= 3 && winProbability >= 0.58) return 'very-high';

  // High: Good edge AND decent win rate
  if (absEdge >= 2 && winProbability >= 0.55) return 'high';

  // Medium: Some edge OR decent win rate
  if (absEdge >= 1 && winProbability >= 0.53) return 'medium';

  // Low: Small edge
  if (absEdge >= 0.5 && winProbability >= 0.51) return 'low';

  // Skip: Not worth betting
  return 'skip';
}

/**
 * Format calibration results for display
 */
export function formatCalibrationReport(calibration: CalibrationCurve): string {
  let report = '## Calibration Report\n\n';
  report += `Total games analyzed: ${calibration.totalGames}\n`;
  report += `Overall win rate: ${(calibration.overallWinRate * 100).toFixed(1)}%\n`;
  report += `Overall ROI: ${calibration.overallROI.toFixed(2)}%\n\n`;

  report += '### Win Rate by Edge Size\n\n';
  report += '| Edge Range | Games | W-L-P | Win Rate | ROI | EV/bet |\n';
  report += '|------------|-------|-------|----------|-----|--------|\n';

  for (const point of calibration.points) {
    if (point.sampleSize === 0) continue;
    const edgeLabel = point.edgeMax === 99
      ? `${point.edgeMin}+`
      : `${point.edgeMin}-${point.edgeMax}`;
    report += `| ${edgeLabel} pts | ${point.sampleSize} | ${point.wins}-${point.losses}-${point.pushes} | ${(point.winRate * 100).toFixed(1)}% | ${point.roi.toFixed(1)}% | $${point.expectedValue.toFixed(2)} |\n`;
  }

  report += '\n### Cumulative Win Rate (edge ≥ threshold)\n\n';
  for (const [threshold, winRate] of calibration.confidenceByEdge) {
    if (threshold > 0) {
      report += `- Edge ≥ ${threshold} pts: ${(winRate * 100).toFixed(1)}%\n`;
    }
  }

  return report;
}
