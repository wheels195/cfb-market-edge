/**
 * Model Performance Analysis
 *
 * Systematic analysis of model predictions vs actual outcomes.
 * Answers: Is the model performing as expected? Where is it weak?
 *
 * Usage: SUPABASE_URL="..." SUPABASE_ANON_KEY="..." npx tsx scripts/model-performance-analysis.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Backtest expectations (from historical analysis)
const CFB_BACKTEST = {
  '2022': { bets: 350, winRate: 0.657, roi: 0.255 },
  '2023': { bets: 187, winRate: 0.631, roi: 0.205 },
  '2024': { bets: 221, winRate: 0.593, roi: 0.132 },
  overall: { bets: 758, winRate: 0.632, roi: 0.206 },
};

const CBB_BACKTEST = {
  favorites: { bets: 857, winRate: 0.545, roi: 0.040 },
  underdogs: { bets: 86, winRate: 0.779, roi: 0.487 },
  overall: { bets: 943, winRate: 0.559, roi: 0.068 },
};

// Statistical functions
function binomialTest(successes: number, trials: number, expectedRate: number): {
  pValue: number;
  significant: boolean;
  direction: 'above' | 'below' | 'equal';
} {
  // Two-tailed binomial test approximation using normal distribution
  if (trials === 0) return { pValue: 1, significant: false, direction: 'equal' };

  const observed = successes / trials;
  const se = Math.sqrt(expectedRate * (1 - expectedRate) / trials);
  const z = (observed - expectedRate) / se;

  // Approximate p-value from z-score
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  return {
    pValue,
    significant: pValue < 0.05,
    direction: observed > expectedRate ? 'above' : observed < expectedRate ? 'below' : 'equal',
  };
}

function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

function confidenceInterval(wins: number, total: number, confidence = 0.95): [number, number] {
  if (total === 0) return [0, 0];
  const p = wins / total;
  const z = confidence === 0.95 ? 1.96 : 1.645;
  const se = Math.sqrt(p * (1 - p) / total);
  return [Math.max(0, p - z * se), Math.min(1, p + z * se)];
}

function calculateROI(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  const profit = (wins * 0.91) - losses; // -110 juice
  return profit / total;
}

interface BucketStats {
  range: string;
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  ci95: [number, number];
  expectedWinRate: number;
  vsExpected: string;
  significant: boolean;
}

async function analyzeCFB() {
  console.log('\n' + '='.repeat(80));
  console.log('CFB MODEL PERFORMANCE ANALYSIS');
  console.log('='.repeat(80));

  // Get all CFB predictions - bet_result is already stored
  const { data: predictions, error } = await supabase
    .from('game_predictions')
    .select('*')
    .not('edge_points', 'is', null);

  if (error) {
    console.error('Error fetching CFB predictions:', error);
    return;
  }

  console.log(`\nTotal predictions stored: ${predictions?.length || 0}`);

  // Filter to graded only
  const graded = (predictions || []).filter(p => p.bet_result !== null);
  console.log(`Graded predictions: ${graded.length}`);

  if (graded.length === 0) {
    console.log('\nNo graded CFB predictions yet. Bowl season just starting.');
    console.log('Check back after bowl games complete.');
    return;
  }

  // 1. Overall Performance
  console.log('\n--- OVERALL PERFORMANCE ---');
  const wins = graded.filter(g => g.bet_result === 'win').length;
  const losses = graded.length - wins;
  const winRate = wins / graded.length;
  const roi = calculateROI(wins, losses);
  const ci = confidenceInterval(wins, graded.length);

  console.log(`Record: ${wins}-${losses} (${(winRate * 100).toFixed(1)}%)`);
  console.log(`ROI: ${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}%`);
  console.log(`95% CI: [${(ci[0] * 100).toFixed(1)}%, ${(ci[1] * 100).toFixed(1)}%]`);

  const vsBacktest = binomialTest(wins, graded.length, CFB_BACKTEST.overall.winRate);
  console.log(`vs Backtest (${(CFB_BACKTEST.overall.winRate * 100).toFixed(1)}%): ${vsBacktest.direction} ${vsBacktest.significant ? '(SIGNIFICANT)' : '(not significant)'}`);

  // 2. Edge Bucket Analysis
  console.log('\n--- EDGE BUCKET ANALYSIS ---');
  console.log('(Testing: Are we right to bet 2.5-5 and skip <2.5 and >5?)');

  const edgeRanges = [
    { range: '2.5-3.5', min: 2.5, max: 3.5, expected: 0.58 },
    { range: '3.5-4.5', min: 3.5, max: 4.5, expected: 0.56 },
    { range: '4.5-5.5', min: 4.5, max: 5.5, expected: 0.54 },
  ];

  console.log('Edge Range | Bets | Win% | ROI');
  console.log('-'.repeat(40));

  for (const { range, min, max } of edgeRanges) {
    const bucket = graded.filter(g => {
      const absEdge = Math.abs(g.edge_points || 0);
      return absEdge >= min && absEdge < max;
    });
    if (bucket.length === 0) {
      console.log(`${range.padEnd(10)} |    0 | N/A  | N/A`);
      continue;
    }

    const bWins = bucket.filter(g => g.bet_result === 'win').length;
    const bLosses = bucket.length - bWins;
    const bWinRate = bWins / bucket.length;
    const bRoi = calculateROI(bWins, bLosses);

    console.log(`${range.padEnd(10)} | ${String(bucket.length).padStart(4)} | ${(bWinRate * 100).toFixed(1).padStart(4)}% | ${(bRoi >= 0 ? '+' : '') + (bRoi * 100).toFixed(1)}%`);
  }

  // 3. Actionable Insights
  console.log('\n--- ACTIONABLE INSIGHTS ---');

  const breakevenTest = binomialTest(wins, graded.length, 0.524);
  console.log(`\nVs Breakeven (52.4%): p=${breakevenTest.pValue.toFixed(4)} ${breakevenTest.significant ? '✓ SIGNIFICANT EDGE' : '⚠️ Not yet significant'}`);

  if (graded.length < 50) {
    console.log(`\nSample size: ${graded.length} bets (need 50+ for any conclusions)`);
    console.log('Recommendation: Continue collecting data, too early to evaluate');
  }
}

async function analyzeCBB() {
  console.log('\n' + '='.repeat(80));
  console.log('CBB MODEL PERFORMANCE ANALYSIS');
  console.log('='.repeat(80));

  // Get all CBB predictions with results
  const { data: predictions, error } = await supabase
    .from('cbb_game_predictions')
    .select('*')
    .not('bet_result', 'is', null);

  if (error) {
    console.error('Error fetching CBB predictions:', error);
    return;
  }

  console.log(`\nTotal graded predictions: ${predictions?.length || 0}`);

  if (!predictions || predictions.length === 0) {
    console.log('No graded CBB predictions found.');
    return;
  }

  // Separate by strategy
  const favorites = predictions.filter(p => !p.is_underdog_bet && p.qualifies_for_bet);
  const underdogs = predictions.filter(p => p.is_underdog_bet && p.qualifies_for_bet);
  const tracked = predictions.filter(p => !p.qualifies_for_bet);

  // Overall qualifying bets
  const qualifying = predictions.filter(p => p.qualifies_for_bet);
  const qWins = qualifying.filter(p => p.bet_result === 'win').length;
  const qLosses = qualifying.filter(p => p.bet_result === 'loss').length;

  console.log('\n--- QUALIFYING BETS ---');
  console.log(`Record: ${qWins}-${qLosses} (${((qWins / (qWins + qLosses)) * 100).toFixed(1)}%)`);
  console.log(`ROI: ${calculateROI(qWins, qLosses) >= 0 ? '+' : ''}${(calculateROI(qWins, qLosses) * 100).toFixed(1)}%`);

  // Favorites strategy
  if (favorites.length > 0) {
    const fWins = favorites.filter(p => p.bet_result === 'win').length;
    const fLosses = favorites.filter(p => p.bet_result === 'loss').length;
    const fWinRate = fWins / favorites.length;
    const fRoi = calculateROI(fWins, fLosses);
    const fTest = binomialTest(fWins, favorites.length, CBB_BACKTEST.favorites.winRate);

    console.log('\n--- FAVORITES STRATEGY ---');
    console.log(`Record: ${fWins}-${fLosses} (${(fWinRate * 100).toFixed(1)}%)`);
    console.log(`ROI: ${fRoi >= 0 ? '+' : ''}${(fRoi * 100).toFixed(1)}%`);
    console.log(`vs Backtest (${(CBB_BACKTEST.favorites.winRate * 100).toFixed(1)}%): ${fTest.direction}${fTest.significant ? ' (SIGNIFICANT)' : ''}`);
  }

  // Underdogs strategy
  if (underdogs.length > 0) {
    const uWins = underdogs.filter(p => p.bet_result === 'win').length;
    const uLosses = underdogs.filter(p => p.bet_result === 'loss').length;
    const uWinRate = uWins / underdogs.length;
    const uRoi = calculateROI(uWins, uLosses);
    const uTest = binomialTest(uWins, underdogs.length, CBB_BACKTEST.underdogs.winRate);

    console.log('\n--- UNDERDOGS STRATEGY ---');
    console.log(`Record: ${uWins}-${uLosses} (${(uWinRate * 100).toFixed(1)}%)`);
    console.log(`ROI: ${uRoi >= 0 ? '+' : ''}${(uRoi * 100).toFixed(1)}%`);
    console.log(`vs Backtest (${(CBB_BACKTEST.underdogs.winRate * 100).toFixed(1)}%): ${uTest.direction}${uTest.significant ? ' (SIGNIFICANT)' : ''}`);
  }

  // Edge bucket analysis for CBB
  console.log('\n--- EDGE BUCKET ANALYSIS (ALL PREDICTIONS) ---');

  const edgeRanges = [
    { range: '2.5-3.5', min: 2.5, max: 3.5 },
    { range: '3.5-4.5', min: 3.5, max: 4.5 },
    { range: '4.5-5.5', min: 4.5, max: 5.5 },
    { range: '5.5-7', min: 5.5, max: 7 },
    { range: '7+', min: 7, max: 100 },
  ];

  console.log('Edge Range | Bets | Win% | ROI    | Qualifies?');
  console.log('-'.repeat(55));

  for (const { range, min, max } of edgeRanges) {
    const bucket = predictions.filter(p => {
      const edge = Math.abs(p.edge_points || 0);
      return edge >= min && edge < max;
    });

    if (bucket.length === 0) continue;

    const bWins = bucket.filter(p => p.bet_result === 'win').length;
    const bLosses = bucket.filter(p => p.bet_result === 'loss').length;
    const bWinRate = bWins / bucket.length;
    const bRoi = calculateROI(bWins, bLosses);
    const qualCount = bucket.filter(p => p.qualifies_for_bet).length;

    console.log(`${range.padEnd(10)} | ${String(bucket.length).padStart(4)} | ${(bWinRate * 100).toFixed(1).padStart(5)}% | ${(bRoi >= 0 ? '+' : '') + (bRoi * 100).toFixed(1).padStart(5)}% | ${qualCount}/${bucket.length}`);
  }

  // Tracked (non-qualifying) analysis
  if (tracked.length > 0) {
    console.log('\n--- NON-QUALIFYING (TRACKED) ANALYSIS ---');
    console.log('Purpose: Should we adjust qualifying criteria?');

    const tWins = tracked.filter(p => p.bet_result === 'win').length;
    const tLosses = tracked.filter(p => p.bet_result === 'loss').length;
    const tWinRate = tWins / tracked.length;
    const tRoi = calculateROI(tWins, tLosses);

    console.log(`\nNon-qualifying: ${tWins}-${tLosses} (${(tWinRate * 100).toFixed(1)}%) | ROI: ${tRoi >= 0 ? '+' : ''}${(tRoi * 100).toFixed(1)}%`);

    if (tRoi > 0) {
      console.log('⚠️  Non-qualifying bets are profitable - consider relaxing criteria');
    } else {
      console.log('✓ Qualification criteria correctly filtering unprofitable bets');
    }
  }

  // Actionable insights
  console.log('\n--- ACTIONABLE INSIGHTS ---');

  const totalQual = qualifying.length;
  const breakevenTest = binomialTest(qWins, totalQual, 0.524);

  console.log(`\nVs Breakeven (52.4%): p=${breakevenTest.pValue.toFixed(4)} ${breakevenTest.significant ? '✓ SIGNIFICANT EDGE' : '⚠️ Not yet significant'}`);

  if (totalQual < 100) {
    console.log(`\nSample size: ${totalQual} bets (need ~100+ for reliable conclusions)`);
    console.log('Recommendation: Continue collecting data before making model changes');
  }
}

async function main() {
  console.log('MODEL PERFORMANCE ANALYSIS');
  console.log('Generated:', new Date().toISOString());
  console.log('\nThis analysis compares live performance to backtest expectations');
  console.log('and identifies potential model improvements.\n');

  await analyzeCFB();
  await analyzeCBB();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('\nKey questions answered:');
  console.log('1. Is live performance matching backtest? (Check "vs Backtest" lines)');
  console.log('2. Are edge thresholds correct? (Check edge bucket analysis)');
  console.log('3. Should we adjust criteria? (Check "Actionable Insights")');
  console.log('\n* = Statistically significant difference (p < 0.05)');
}

main().catch(console.error);
