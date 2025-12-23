/**
 * Run report generation manually
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Backtest expectations
const CFB_BACKTEST = { winRate: 0.632, roi: 0.206 };
const CBB_BACKTEST = {
  favorites: { winRate: 0.545, roi: 0.040 },
  underdogs: { winRate: 0.779, roi: 0.487 },
  overall: { winRate: 0.559, roi: 0.068 },
};

function binomialPValue(successes: number, trials: number, expectedRate: number): number {
  if (trials === 0) return 1;
  const observed = successes / trials;
  const se = Math.sqrt(expectedRate * (1 - expectedRate) / trials);
  const z = (observed - expectedRate) / se;
  const absZ = Math.abs(z);
  const p = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI);
  return Math.min(1, 2 * p * (1 + absZ * 0.3));
}

function calculateROI(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return ((wins * 0.91) - losses) / total;
}

async function generateCFBReport() {
  const { data: predictions } = await supabase
    .from('game_predictions')
    .select('*')
    .not('bet_result', 'is', null);

  const graded = predictions || [];
  console.log(`CFB: ${graded.length} graded predictions`);

  if (graded.length === 0) {
    return {
      sport: 'cfb',
      total_bets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      win_rate: null,
      roi: null,
      profit_units: 0,
      backtest_win_rate: CFB_BACKTEST.winRate,
      vs_backtest: 'N/A',
      vs_backtest_significant: false,
      vs_breakeven_pvalue: null,
      edge_buckets: {},
      sample_size_adequate: false,
      recommendation: 'No graded CFB bets yet.',
    };
  }

  const wins = graded.filter(g => g.bet_result === 'win').length;
  const losses = graded.filter(g => g.bet_result === 'loss').length;
  const pushes = graded.filter(g => g.bet_result === 'push').length;
  const total = wins + losses;
  const winRate = total > 0 ? wins / total : 0;
  const roi = calculateROI(wins, losses);
  const profit = (wins * 0.91) - losses;

  const pValue = binomialPValue(wins, total, 0.524);
  const vsBacktestP = binomialPValue(wins, total, CFB_BACKTEST.winRate);

  const buckets: Record<string, { wins: number; losses: number }> = {};
  for (const g of graded) {
    const absEdge = Math.abs(g.edge_points || 0);
    let bucket = '5+';
    if (absEdge < 3) bucket = '2.5-3';
    else if (absEdge < 4) bucket = '3-4';
    else if (absEdge < 5) bucket = '4-5';

    if (!buckets[bucket]) buckets[bucket] = { wins: 0, losses: 0 };
    if (g.bet_result === 'win') buckets[bucket].wins++;
    else if (g.bet_result === 'loss') buckets[bucket].losses++;
  }

  const sampleAdequate = total >= 50;
  let recommendation = '';
  if (total < 20) {
    recommendation = 'Sample too small for any conclusions. Continue collecting data.';
  } else if (total < 50) {
    recommendation = 'Early data. Monitor for major deviations from backtest.';
  } else if (winRate < 0.50) {
    recommendation = 'ALERT: Win rate below 50%. Investigate model performance.';
  } else if (pValue < 0.05) {
    recommendation = 'Performance significantly above breakeven. Model working.';
  } else {
    recommendation = 'Performance within expected range. Continue monitoring.';
  }

  return {
    sport: 'cfb',
    total_bets: total,
    wins,
    losses,
    pushes,
    win_rate: winRate,
    roi,
    profit_units: profit,
    backtest_win_rate: CFB_BACKTEST.winRate,
    vs_backtest: winRate > CFB_BACKTEST.winRate ? 'above' : winRate < CFB_BACKTEST.winRate ? 'below' : 'equal',
    vs_backtest_significant: vsBacktestP < 0.05,
    vs_breakeven_pvalue: pValue,
    edge_buckets: buckets,
    sample_size_adequate: sampleAdequate,
    recommendation,
  };
}

async function generateCBBReport() {
  const { data: predictions } = await supabase
    .from('cbb_game_predictions')
    .select('*')
    .not('bet_result', 'is', null);

  const graded = predictions || [];
  const qualifying = graded.filter(g => g.qualifies_for_bet);
  console.log(`CBB: ${graded.length} graded, ${qualifying.length} qualifying`);

  if (qualifying.length === 0) {
    return {
      sport: 'cbb',
      total_bets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      win_rate: null,
      roi: null,
      profit_units: 0,
      backtest_win_rate: CBB_BACKTEST.overall.winRate,
      vs_backtest: 'N/A',
      vs_backtest_significant: false,
      vs_breakeven_pvalue: null,
      edge_buckets: {},
      favorites_record: '0-0',
      favorites_roi: null,
      underdogs_record: '0-0',
      underdogs_roi: null,
      sample_size_adequate: false,
      recommendation: 'No graded CBB qualifying bets yet.',
    };
  }

  const wins = qualifying.filter(g => g.bet_result === 'win').length;
  const losses = qualifying.filter(g => g.bet_result === 'loss').length;
  const pushes = qualifying.filter(g => g.bet_result === 'push').length;
  const total = wins + losses;
  const winRate = total > 0 ? wins / total : 0;
  const roi = calculateROI(wins, losses);
  const profit = (wins * 0.91) - losses;

  const favorites = qualifying.filter(g => !g.is_underdog_bet);
  const underdogs = qualifying.filter(g => g.is_underdog_bet);

  const favWins = favorites.filter(g => g.bet_result === 'win').length;
  const favLosses = favorites.filter(g => g.bet_result === 'loss').length;
  const dogWins = underdogs.filter(g => g.bet_result === 'win').length;
  const dogLosses = underdogs.filter(g => g.bet_result === 'loss').length;

  const buckets: Record<string, { wins: number; losses: number }> = {};
  for (const g of graded) {
    const absEdge = Math.abs(g.edge_points || 0);
    let bucket = '5+';
    if (absEdge < 3.5) bucket = '2.5-3.5';
    else if (absEdge < 4.5) bucket = '3.5-4.5';
    else if (absEdge < 5.5) bucket = '4.5-5.5';

    if (!buckets[bucket]) buckets[bucket] = { wins: 0, losses: 0 };
    if (g.bet_result === 'win') buckets[bucket].wins++;
    else if (g.bet_result === 'loss') buckets[bucket].losses++;
  }

  const pValue = binomialPValue(wins, total, 0.524);
  const sampleAdequate = total >= 100;

  let recommendation = '';
  if (total < 20) {
    recommendation = 'Sample too small. Continue collecting data.';
  } else if (total < 100) {
    recommendation = `Need ${100 - total} more bets for reliable analysis.`;
  } else if (pValue < 0.05 && winRate > 0.524) {
    recommendation = 'Statistically significant edge detected. Model working.';
  } else if (winRate < 0.50) {
    recommendation = 'ALERT: Below 50% win rate. Review model.';
  } else {
    recommendation = 'Performance within expected range.';
  }

  return {
    sport: 'cbb',
    total_bets: total,
    wins,
    losses,
    pushes,
    win_rate: winRate,
    roi,
    profit_units: profit,
    backtest_win_rate: CBB_BACKTEST.overall.winRate,
    vs_backtest: winRate > CBB_BACKTEST.overall.winRate ? 'above' : 'below',
    vs_backtest_significant: false,
    vs_breakeven_pvalue: pValue,
    edge_buckets: buckets,
    favorites_record: `${favWins}-${favLosses}`,
    favorites_roi: calculateROI(favWins, favLosses),
    underdogs_record: `${dogWins}-${dogLosses}`,
    underdogs_roi: calculateROI(dogWins, dogLosses),
    sample_size_adequate: sampleAdequate,
    recommendation,
  };
}

async function run() {
  console.log('=== Generating Model Reports ===\n');

  const today = new Date().toISOString().split('T')[0];

  const cfbReport = await generateCFBReport();
  const cbbReport = await generateCBBReport();

  console.log('\n--- CFB Report ---');
  console.log(`Record: ${cfbReport.wins}-${cfbReport.losses}`);
  console.log(`Win Rate: ${cfbReport.win_rate ? (cfbReport.win_rate * 100).toFixed(1) : 'N/A'}%`);
  console.log(`ROI: ${cfbReport.roi ? (cfbReport.roi * 100).toFixed(1) : 'N/A'}%`);
  console.log(`Recommendation: ${cfbReport.recommendation}`);

  console.log('\n--- CBB Report ---');
  console.log(`Record: ${cbbReport.wins}-${cbbReport.losses}`);
  console.log(`Win Rate: ${cbbReport.win_rate ? (cbbReport.win_rate * 100).toFixed(1) : 'N/A'}%`);
  console.log(`ROI: ${cbbReport.roi ? (cbbReport.roi * 100).toFixed(1) : 'N/A'}%`);
  console.log(`Favorites: ${cbbReport.favorites_record}`);
  console.log(`Underdogs: ${cbbReport.underdogs_record}`);
  console.log(`Recommendation: ${cbbReport.recommendation}`);

  // Save to database
  console.log('\n--- Saving to database ---');

  const { error: cfbError } = await supabase
    .from('model_reports')
    .upsert({
      report_date: today,
      ...cfbReport,
    }, { onConflict: 'report_date,sport' });

  if (cfbError) {
    console.error('CFB save error:', cfbError.message);
  } else {
    console.log('CFB report saved');
  }

  const { error: cbbError } = await supabase
    .from('model_reports')
    .upsert({
      report_date: today,
      ...cbbReport,
    }, { onConflict: 'report_date,sport' });

  if (cbbError) {
    console.error('CBB save error:', cbbError.message);
  } else {
    console.log('CBB report saved');
  }

  // Verify
  const { data: saved } = await supabase
    .from('model_reports')
    .select('id, report_date, sport, wins, losses')
    .eq('report_date', today);

  console.log('\nSaved reports:', saved);
}

run().catch(console.error);
