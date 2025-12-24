/**
 * Model Reports API
 *
 * Computes real-time model performance stats from game_predictions
 * and cbb_game_predictions tables. Updates after every graded result.
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// Backtest expectations
const CFB_BACKTEST = { winRate: 0.632, roi: 0.206, totalBets: 758 };
const CBB_BACKTEST = {
  favorites: { winRate: 0.545, roi: 0.040 },
  underdogs: { winRate: 0.779, roi: 0.487 },
  overall: { winRate: 0.559, roi: 0.068, totalBets: 390 },
};

function calculateROI(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return ((wins * 0.91) - losses) / total;
}

function binomialPValue(successes: number, trials: number, expectedRate: number): number {
  if (trials === 0) return 1;
  const observed = successes / trials;
  const se = Math.sqrt(expectedRate * (1 - expectedRate) / trials);
  const z = (observed - expectedRate) / se;
  const absZ = Math.abs(z);
  const p = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI);
  return Math.min(1, 2 * p * (1 + absZ * 0.3));
}

interface EdgeBucket {
  range: string;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
}

async function getCFBStats() {
  // Get ALL graded predictions (not just qualifying - track everything)
  const { data: predictions, error } = await supabase
    .from('game_predictions')
    .select('*')
    .not('bet_result', 'is', null);

  if (error) {
    console.error('Error fetching CFB predictions:', error);
    return null;
  }

  const graded = predictions || [];

  // Split into qualifying (2.5-5 edge) and all predictions
  const qualifying = graded.filter(g => {
    const absEdge = Math.abs(g.edge_points || 0);
    return absEdge >= 2.5 && absEdge <= 5;
  });

  const allPredictions = graded;

  // Calculate qualifying stats
  const qWins = qualifying.filter(g => g.bet_result === 'win').length;
  const qLosses = qualifying.filter(g => g.bet_result === 'loss').length;
  const qPushes = qualifying.filter(g => g.bet_result === 'push').length;
  const qTotal = qWins + qLosses;
  const qWinRate = qTotal > 0 ? qWins / qTotal : 0;
  const qRoi = calculateROI(qWins, qLosses);
  const qProfit = (qWins * 0.91) - qLosses;

  // Calculate all predictions stats
  const aWins = allPredictions.filter(g => g.bet_result === 'win').length;
  const aLosses = allPredictions.filter(g => g.bet_result === 'loss').length;
  const aPushes = allPredictions.filter(g => g.bet_result === 'push').length;
  const aTotal = aWins + aLosses;
  const aWinRate = aTotal > 0 ? aWins / aTotal : 0;
  const aRoi = calculateROI(aWins, aLosses);
  const aProfit = (aWins * 0.91) - aLosses;

  // Edge buckets for qualifying bets
  const buckets: EdgeBucket[] = [];
  const bucketRanges = [
    { range: '2.5-3', min: 2.5, max: 3 },
    { range: '3-4', min: 3, max: 4 },
    { range: '4-5', min: 4, max: 5 },
  ];

  for (const bucket of bucketRanges) {
    const inBucket = qualifying.filter(g => {
      const absEdge = Math.abs(g.edge_points || 0);
      return absEdge >= bucket.min && absEdge < bucket.max;
    });
    const bWins = inBucket.filter(g => g.bet_result === 'win').length;
    const bLosses = inBucket.filter(g => g.bet_result === 'loss').length;
    const bPushes = inBucket.filter(g => g.bet_result === 'push').length;
    const bTotal = bWins + bLosses;
    buckets.push({
      range: bucket.range,
      wins: bWins,
      losses: bLosses,
      pushes: bPushes,
      winRate: bTotal > 0 ? bWins / bTotal : 0,
      roi: calculateROI(bWins, bLosses),
    });
  }

  // Edge buckets for ALL predictions (to analyze the full model)
  const allBuckets: EdgeBucket[] = [];
  const allBucketRanges = [
    { range: '0-1', min: 0, max: 1 },
    { range: '1-2', min: 1, max: 2 },
    { range: '2-2.5', min: 2, max: 2.5 },
    { range: '2.5-3', min: 2.5, max: 3 },
    { range: '3-4', min: 3, max: 4 },
    { range: '4-5', min: 4, max: 5 },
    { range: '5+', min: 5, max: 100 },
  ];

  for (const bucket of allBucketRanges) {
    const inBucket = allPredictions.filter(g => {
      const absEdge = Math.abs(g.edge_points || 0);
      return absEdge >= bucket.min && absEdge < bucket.max;
    });
    const bWins = inBucket.filter(g => g.bet_result === 'win').length;
    const bLosses = inBucket.filter(g => g.bet_result === 'loss').length;
    const bPushes = inBucket.filter(g => g.bet_result === 'push').length;
    const bTotal = bWins + bLosses;
    allBuckets.push({
      range: bucket.range,
      wins: bWins,
      losses: bLosses,
      pushes: bPushes,
      winRate: bTotal > 0 ? bWins / bTotal : 0,
      roi: calculateROI(bWins, bLosses),
    });
  }

  const pValue = binomialPValue(qWins, qTotal, 0.524);
  const vsBacktestP = binomialPValue(qWins, qTotal, CFB_BACKTEST.winRate);

  return {
    sport: 'cfb',
    // Qualifying bets (what we actually bet on)
    qualifying: {
      total: qTotal,
      wins: qWins,
      losses: qLosses,
      pushes: qPushes,
      winRate: qWinRate,
      roi: qRoi,
      profitUnits: qProfit,
      edgeBuckets: buckets,
    },
    // All predictions (for analysis)
    all: {
      total: aTotal,
      wins: aWins,
      losses: aLosses,
      pushes: aPushes,
      winRate: aWinRate,
      roi: aRoi,
      profitUnits: aProfit,
      edgeBuckets: allBuckets,
    },
    backtest: CFB_BACKTEST,
    vsBacktest: qWinRate > CFB_BACKTEST.winRate ? 'above' : qWinRate < CFB_BACKTEST.winRate ? 'below' : 'equal',
    vsBacktestSignificant: vsBacktestP < 0.05,
    vsBreakevenPValue: pValue,
    sampleSizeAdequate: qTotal >= 50,
    lastUpdated: new Date().toISOString(),
  };
}

async function getCBBStats() {
  // Get ALL graded predictions
  const { data: predictions, error } = await supabase
    .from('cbb_game_predictions')
    .select('*')
    .not('bet_result', 'is', null);

  if (error) {
    console.error('Error fetching CBB predictions:', error);
    return null;
  }

  const graded = predictions || [];

  // Split into qualifying and all predictions
  const qualifying = graded.filter(g => g.qualifies_for_bet);
  const allPredictions = graded;

  // Qualifying stats
  const qWins = qualifying.filter(g => g.bet_result === 'win').length;
  const qLosses = qualifying.filter(g => g.bet_result === 'loss').length;
  const qPushes = qualifying.filter(g => g.bet_result === 'push').length;
  const qTotal = qWins + qLosses;
  const qWinRate = qTotal > 0 ? qWins / qTotal : 0;
  const qRoi = calculateROI(qWins, qLosses);
  const qProfit = (qWins * 0.91) - qLosses;

  // All predictions stats
  const aWins = allPredictions.filter(g => g.bet_result === 'win').length;
  const aLosses = allPredictions.filter(g => g.bet_result === 'loss').length;
  const aPushes = allPredictions.filter(g => g.bet_result === 'push').length;
  const aTotal = aWins + aLosses;
  const aWinRate = aTotal > 0 ? aWins / aTotal : 0;
  const aRoi = calculateROI(aWins, aLosses);
  const aProfit = (aWins * 0.91) - aLosses;

  // Strategy breakdown for qualifying bets
  const favorites = qualifying.filter(g => !g.is_underdog_bet);
  const underdogs = qualifying.filter(g => g.is_underdog_bet);

  const favWins = favorites.filter(g => g.bet_result === 'win').length;
  const favLosses = favorites.filter(g => g.bet_result === 'loss').length;
  const favPushes = favorites.filter(g => g.bet_result === 'push').length;
  const favTotal = favWins + favLosses;

  const dogWins = underdogs.filter(g => g.bet_result === 'win').length;
  const dogLosses = underdogs.filter(g => g.bet_result === 'loss').length;
  const dogPushes = underdogs.filter(g => g.bet_result === 'push').length;
  const dogTotal = dogWins + dogLosses;

  // Edge buckets for qualifying
  const buckets: EdgeBucket[] = [];
  const bucketRanges = [
    { range: '3-4', min: 3, max: 4 },
    { range: '4-5', min: 4, max: 5 },
    { range: '5-6', min: 5, max: 6 },
    { range: '6+', min: 6, max: 100 },
  ];

  for (const bucket of bucketRanges) {
    const inBucket = qualifying.filter(g => {
      const absEdge = Math.abs(g.edge_points || 0);
      return absEdge >= bucket.min && absEdge < bucket.max;
    });
    const bWins = inBucket.filter(g => g.bet_result === 'win').length;
    const bLosses = inBucket.filter(g => g.bet_result === 'loss').length;
    const bPushes = inBucket.filter(g => g.bet_result === 'push').length;
    const bTotal = bWins + bLosses;
    buckets.push({
      range: bucket.range,
      wins: bWins,
      losses: bLosses,
      pushes: bPushes,
      winRate: bTotal > 0 ? bWins / bTotal : 0,
      roi: calculateROI(bWins, bLosses),
    });
  }

  // Edge buckets for ALL predictions
  const allBuckets: EdgeBucket[] = [];
  const allBucketRanges = [
    { range: '0-2', min: 0, max: 2 },
    { range: '2-3', min: 2, max: 3 },
    { range: '3-4', min: 3, max: 4 },
    { range: '4-5', min: 4, max: 5 },
    { range: '5-6', min: 5, max: 6 },
    { range: '6+', min: 6, max: 100 },
  ];

  for (const bucket of allBucketRanges) {
    const inBucket = allPredictions.filter(g => {
      const absEdge = Math.abs(g.edge_points || 0);
      return absEdge >= bucket.min && absEdge < bucket.max;
    });
    const bWins = inBucket.filter(g => g.bet_result === 'win').length;
    const bLosses = inBucket.filter(g => g.bet_result === 'loss').length;
    const bPushes = inBucket.filter(g => g.bet_result === 'push').length;
    const bTotal = bWins + bLosses;
    allBuckets.push({
      range: bucket.range,
      wins: bWins,
      losses: bLosses,
      pushes: bPushes,
      winRate: bTotal > 0 ? bWins / bTotal : 0,
      roi: calculateROI(bWins, bLosses),
    });
  }

  const pValue = binomialPValue(qWins, qTotal, 0.524);

  return {
    sport: 'cbb',
    // Qualifying bets
    qualifying: {
      total: qTotal,
      wins: qWins,
      losses: qLosses,
      pushes: qPushes,
      winRate: qWinRate,
      roi: qRoi,
      profitUnits: qProfit,
      edgeBuckets: buckets,
    },
    // All predictions
    all: {
      total: aTotal,
      wins: aWins,
      losses: aLosses,
      pushes: aPushes,
      winRate: aWinRate,
      roi: aRoi,
      profitUnits: aProfit,
      edgeBuckets: allBuckets,
    },
    // Strategy breakdown
    strategies: {
      favorites: {
        wins: favWins,
        losses: favLosses,
        pushes: favPushes,
        total: favTotal,
        winRate: favTotal > 0 ? favWins / favTotal : 0,
        roi: calculateROI(favWins, favLosses),
        backtest: CBB_BACKTEST.favorites,
      },
      underdogs: {
        wins: dogWins,
        losses: dogLosses,
        pushes: dogPushes,
        total: dogTotal,
        winRate: dogTotal > 0 ? dogWins / dogTotal : 0,
        roi: calculateROI(dogWins, dogLosses),
        backtest: CBB_BACKTEST.underdogs,
      },
    },
    backtest: CBB_BACKTEST.overall,
    vsBacktest: qWinRate > CBB_BACKTEST.overall.winRate ? 'above' : qWinRate < CBB_BACKTEST.overall.winRate ? 'below' : 'equal',
    vsBreakevenPValue: pValue,
    sampleSizeAdequate: qTotal >= 100,
    lastUpdated: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const [cfbStats, cbbStats] = await Promise.all([
      getCFBStats(),
      getCBBStats(),
    ]);

    return NextResponse.json({
      cfb: cfbStats,
      cbb: cbbStats,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Reports API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}
