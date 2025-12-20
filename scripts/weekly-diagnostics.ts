/**
 * Weekly Performance Diagnostics
 *
 * Run every Sunday after games are graded.
 * Outputs:
 *   - Week-over-week performance
 *   - Rolling metrics (4-week, 8-week)
 *   - Edge decay detection
 *   - Capital protection alerts
 *
 * Usage: npx tsx scripts/weekly-diagnostics.ts [season] [week]
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// =============================================================================
// CONSTANTS
// =============================================================================

const THRESHOLDS = {
  // Minimum sample before alerting
  MIN_BETS_FOR_ALERT: 20,

  // Win rate thresholds
  WIN_RATE_CRITICAL: 0.48,     // Below this = critical
  WIN_RATE_WARNING: 0.52,      // Below this = warning

  // ROI thresholds
  ROI_CRITICAL: -0.10,         // -10% or worse = critical
  ROI_WARNING: -0.02,          // -2% or worse = warning

  // Edge decay (rolling window comparison)
  DECAY_THRESHOLD: 0.10,       // 10pp drop in win rate = decay alert

  // CLV
  CLV_MIN_CAPTURE: 0.45,       // Minimum CLV capture rate

  // Consecutive losing weeks
  MAX_LOSING_WEEKS: 3,
};

// =============================================================================
// TYPES
// =============================================================================

interface WeeklyStats {
  season: number;
  week: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  avgEdge: number;
  avgCLV: number;
  clvCaptureRate: number;
}

interface RollingStats {
  window: string;
  bets: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
}

interface Alert {
  level: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  action: string;
}

// =============================================================================
// DATA FETCHING
// =============================================================================

async function getBetRecords(season: number, weekStart?: number, weekEnd?: number) {
  let query = supabase
    .from('bet_records')
    .select('*')
    .eq('season', season)
    .not('result', 'is', null);

  if (weekStart !== undefined) {
    query = query.gte('week', weekStart);
  }
  if (weekEnd !== undefined) {
    query = query.lte('week', weekEnd);
  }

  const { data, error } = await query.order('week', { ascending: true });

  if (error) {
    console.error('Error fetching bet records:', error);
    return [];
  }

  return data || [];
}

async function getWeeklyStats(season: number): Promise<WeeklyStats[]> {
  const bets = await getBetRecords(season);

  // Group by week
  const byWeek = new Map<number, typeof bets>();
  for (const bet of bets) {
    if (!byWeek.has(bet.week)) byWeek.set(bet.week, []);
    byWeek.get(bet.week)!.push(bet);
  }

  const stats: WeeklyStats[] = [];

  for (const [week, weekBets] of Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0])) {
    const wins = weekBets.filter(b => b.result === 'win').length;
    const losses = weekBets.filter(b => b.result === 'loss').length;
    const pushes = weekBets.filter(b => b.result === 'push').length;
    const decided = wins + losses;

    // CLV calculation
    const betsWithClose = weekBets.filter(b => b.spread_at_close !== null);
    let totalCLV = 0;
    let clvCaptured = 0;

    for (const bet of betsWithClose) {
      const lineMovement = bet.spread_at_close - bet.spread_at_bet;
      const clvDirection = bet.side === 'home' ? lineMovement : -lineMovement;
      totalCLV += clvDirection;
      if (clvDirection > 0) clvCaptured++;
    }

    stats.push({
      season,
      week,
      bets: weekBets.length,
      wins,
      losses,
      pushes,
      winRate: decided > 0 ? wins / decided : 0,
      roi: decided > 0 ? (wins * 1.0 - losses * 1.1) / (decided * 1.1) : 0,
      avgEdge: weekBets.reduce((a, b) => a + b.effective_edge, 0) / weekBets.length,
      avgCLV: betsWithClose.length > 0 ? totalCLV / betsWithClose.length : 0,
      clvCaptureRate: betsWithClose.length > 0 ? clvCaptured / betsWithClose.length : 0,
    });
  }

  return stats;
}

function calculateRollingStats(weeklyStats: WeeklyStats[], windowSize: number): RollingStats | null {
  if (weeklyStats.length < windowSize) return null;

  const recent = weeklyStats.slice(-windowSize);

  let totalBets = 0;
  let totalWins = 0;
  let totalLosses = 0;

  for (const w of recent) {
    totalBets += w.bets;
    totalWins += w.wins;
    totalLosses += w.losses;
  }

  const decided = totalWins + totalLosses;

  return {
    window: `${windowSize}-week`,
    bets: totalBets,
    wins: totalWins,
    losses: totalLosses,
    winRate: decided > 0 ? totalWins / decided : 0,
    roi: decided > 0 ? (totalWins * 1.0 - totalLosses * 1.1) / (decided * 1.1) : 0,
  };
}

// =============================================================================
// ANALYSIS
// =============================================================================

function detectEdgeDecay(weeklyStats: WeeklyStats[]): Alert | null {
  if (weeklyStats.length < 8) return null;

  // Compare first half vs second half
  const mid = Math.floor(weeklyStats.length / 2);
  const firstHalf = weeklyStats.slice(0, mid);
  const secondHalf = weeklyStats.slice(mid);

  const firstWinRate = firstHalf.reduce((a, w) => a + w.wins, 0) /
    Math.max(1, firstHalf.reduce((a, w) => a + w.wins + w.losses, 0));

  const secondWinRate = secondHalf.reduce((a, w) => a + w.wins, 0) /
    Math.max(1, secondHalf.reduce((a, w) => a + w.wins + w.losses, 0));

  const decay = firstWinRate - secondWinRate;

  if (decay > THRESHOLDS.DECAY_THRESHOLD) {
    return {
      level: 'warning',
      category: 'edge_decay',
      message: `Win rate dropped from ${(firstWinRate * 100).toFixed(1)}% (first half) to ${(secondWinRate * 100).toFixed(1)}% (second half)`,
      action: 'Review model assumptions. Consider if market has adjusted.',
    };
  }

  return null;
}

function detectLosingStreak(weeklyStats: WeeklyStats[]): Alert | null {
  let consecutiveLosing = 0;

  for (let i = weeklyStats.length - 1; i >= 0; i--) {
    if (weeklyStats[i].winRate < 0.5) {
      consecutiveLosing++;
    } else {
      break;
    }
  }

  if (consecutiveLosing >= THRESHOLDS.MAX_LOSING_WEEKS) {
    return {
      level: 'critical',
      category: 'losing_streak',
      message: `${consecutiveLosing} consecutive losing weeks`,
      action: 'PAUSE BETTING. Conduct full model review before resuming.',
    };
  }

  return null;
}

function analyzeCurrentPerformance(
  rolling4: RollingStats | null,
  rolling8: RollingStats | null
): Alert[] {
  const alerts: Alert[] = [];

  const stats = rolling4 || rolling8;
  if (!stats || stats.bets < THRESHOLDS.MIN_BETS_FOR_ALERT) {
    return alerts;
  }

  // Win rate check
  if (stats.winRate < THRESHOLDS.WIN_RATE_CRITICAL) {
    alerts.push({
      level: 'critical',
      category: 'win_rate',
      message: `Rolling win rate ${(stats.winRate * 100).toFixed(1)}% is critically low`,
      action: 'REDUCE STAKE SIZE immediately. Review all recent bets for patterns.',
    });
  } else if (stats.winRate < THRESHOLDS.WIN_RATE_WARNING) {
    alerts.push({
      level: 'warning',
      category: 'win_rate',
      message: `Rolling win rate ${(stats.winRate * 100).toFixed(1)}% below target`,
      action: 'Monitor closely. Consider reducing stake size.',
    });
  }

  // ROI check
  if (stats.roi < THRESHOLDS.ROI_CRITICAL) {
    alerts.push({
      level: 'critical',
      category: 'roi',
      message: `Rolling ROI ${(stats.roi * 100).toFixed(1)}% is critically negative`,
      action: 'PAUSE NEW BETS. Review model and data quality.',
    });
  } else if (stats.roi < THRESHOLDS.ROI_WARNING) {
    alerts.push({
      level: 'warning',
      category: 'roi',
      message: `Rolling ROI ${(stats.roi * 100).toFixed(1)}% is negative`,
      action: 'Reduce position sizes. Monitor next 2 weeks.',
    });
  }

  return alerts;
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

async function generateReport(season: number, currentWeek?: number): Promise<string> {
  const weeklyStats = await getWeeklyStats(season);

  let report = '\n';
  report += '╔══════════════════════════════════════════════════════════════════╗\n';
  report += '║               WEEKLY PERFORMANCE DIAGNOSTICS                     ║\n';
  report += '╚══════════════════════════════════════════════════════════════════╝\n\n';

  report += `Season: ${season}\n`;
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `Total weeks with data: ${weeklyStats.length}\n\n`;

  // Week-by-week breakdown
  report += '═══════════════════════════════════════════════════════════════════\n';
  report += 'WEEK-BY-WEEK PERFORMANCE\n';
  report += '═══════════════════════════════════════════════════════════════════\n\n';

  report += 'Week | Bets | W-L-P   | Win%  | ROI     | Avg Edge | CLV\n';
  report += '-----|------|---------|-------|---------|----------|-------\n';

  for (const w of weeklyStats) {
    const wlp = `${w.wins}-${w.losses}-${w.pushes}`;
    report += `${w.week.toString().padStart(4)} | `;
    report += `${w.bets.toString().padStart(4)} | `;
    report += `${wlp.padStart(7)} | `;
    report += `${(w.winRate * 100).toFixed(1).padStart(5)}% | `;
    report += `${w.roi >= 0 ? '+' : ''}${(w.roi * 100).toFixed(1).padStart(6)}% | `;
    report += `${w.avgEdge >= 0 ? '+' : ''}${w.avgEdge.toFixed(1).padStart(8)} | `;
    report += `${w.avgCLV >= 0 ? '+' : ''}${w.avgCLV.toFixed(2)}\n`;
  }

  // Rolling metrics
  report += '\n═══════════════════════════════════════════════════════════════════\n';
  report += 'ROLLING METRICS\n';
  report += '═══════════════════════════════════════════════════════════════════\n\n';

  const rolling4 = calculateRollingStats(weeklyStats, 4);
  const rolling8 = calculateRollingStats(weeklyStats, 8);
  const rollingAll = calculateRollingStats(weeklyStats, weeklyStats.length);

  report += 'Window   | Bets | W-L    | Win%  | ROI\n';
  report += '---------|------|--------|-------|--------\n';

  if (rolling4) {
    report += `4-week   | ${rolling4.bets.toString().padStart(4)} | ${rolling4.wins}-${rolling4.losses}`.padEnd(20);
    report += ` | ${(rolling4.winRate * 100).toFixed(1).padStart(5)}% | ${rolling4.roi >= 0 ? '+' : ''}${(rolling4.roi * 100).toFixed(1)}%\n`;
  }

  if (rolling8) {
    report += `8-week   | ${rolling8.bets.toString().padStart(4)} | ${rolling8.wins}-${rolling8.losses}`.padEnd(20);
    report += ` | ${(rolling8.winRate * 100).toFixed(1).padStart(5)}% | ${rolling8.roi >= 0 ? '+' : ''}${(rolling8.roi * 100).toFixed(1)}%\n`;
  }

  if (rollingAll) {
    report += `Season   | ${rollingAll.bets.toString().padStart(4)} | ${rollingAll.wins}-${rollingAll.losses}`.padEnd(20);
    report += ` | ${(rollingAll.winRate * 100).toFixed(1).padStart(5)}% | ${rollingAll.roi >= 0 ? '+' : ''}${(rollingAll.roi * 100).toFixed(1)}%\n`;
  }

  // Regime comparison
  report += '\n═══════════════════════════════════════════════════════════════════\n';
  report += 'REGIME COMPARISON\n';
  report += '═══════════════════════════════════════════════════════════════════\n\n';

  const earlyWeeks = weeklyStats.filter(w => w.week <= 4);
  const lateWeeks = weeklyStats.filter(w => w.week > 4);

  if (earlyWeeks.length > 0) {
    const earlyWins = earlyWeeks.reduce((a, w) => a + w.wins, 0);
    const earlyLosses = earlyWeeks.reduce((a, w) => a + w.losses, 0);
    const earlyDecided = earlyWins + earlyLosses;
    const earlyWinRate = earlyDecided > 0 ? earlyWins / earlyDecided : 0;
    const earlyROI = earlyDecided > 0 ? (earlyWins * 1.0 - earlyLosses * 1.1) / (earlyDecided * 1.1) : 0;

    report += `Weeks 1-4:  ${earlyWins}-${earlyLosses} (${(earlyWinRate * 100).toFixed(1)}% win, ${earlyROI >= 0 ? '+' : ''}${(earlyROI * 100).toFixed(1)}% ROI)\n`;
  }

  if (lateWeeks.length > 0) {
    const lateWins = lateWeeks.reduce((a, w) => a + w.wins, 0);
    const lateLosses = lateWeeks.reduce((a, w) => a + w.losses, 0);
    const lateDecided = lateWins + lateLosses;
    const lateWinRate = lateDecided > 0 ? lateWins / lateDecided : 0;
    const lateROI = lateDecided > 0 ? (lateWins * 1.0 - lateLosses * 1.1) / (lateDecided * 1.1) : 0;

    report += `Weeks 5+:   ${lateWins}-${lateLosses} (${(lateWinRate * 100).toFixed(1)}% win, ${lateROI >= 0 ? '+' : ''}${(lateROI * 100).toFixed(1)}% ROI)\n`;
  }

  // Alerts
  report += '\n═══════════════════════════════════════════════════════════════════\n';
  report += 'ALERTS & ACTIONS\n';
  report += '═══════════════════════════════════════════════════════════════════\n\n';

  const alerts: Alert[] = [];

  // Edge decay check
  const decayAlert = detectEdgeDecay(weeklyStats);
  if (decayAlert) alerts.push(decayAlert);

  // Losing streak check
  const streakAlert = detectLosingStreak(weeklyStats);
  if (streakAlert) alerts.push(streakAlert);

  // Current performance check
  const performanceAlerts = analyzeCurrentPerformance(rolling4, rolling8);
  alerts.push(...performanceAlerts);

  if (alerts.length === 0) {
    report += '✓ No alerts. Model performing within expected parameters.\n';
  } else {
    const criticals = alerts.filter(a => a.level === 'critical');
    const warnings = alerts.filter(a => a.level === 'warning');

    if (criticals.length > 0) {
      report += '🚨 CRITICAL ALERTS:\n';
      for (const alert of criticals) {
        report += `   [${alert.category.toUpperCase()}] ${alert.message}\n`;
        report += `   → ACTION: ${alert.action}\n\n`;
      }
    }

    if (warnings.length > 0) {
      report += '⚠️  WARNINGS:\n';
      for (const alert of warnings) {
        report += `   [${alert.category.toUpperCase()}] ${alert.message}\n`;
        report += `   → ACTION: ${alert.action}\n\n`;
      }
    }
  }

  // Capital protection status
  report += '\n═══════════════════════════════════════════════════════════════════\n';
  report += 'CAPITAL PROTECTION STATUS\n';
  report += '═══════════════════════════════════════════════════════════════════\n\n';

  const hasCritical = alerts.some(a => a.level === 'critical');
  const hasWarning = alerts.some(a => a.level === 'warning');

  if (hasCritical) {
    report += '🔴 STATUS: PAUSE RECOMMENDED\n';
    report += '   Critical issues detected. Reduce or suspend betting until resolved.\n';
  } else if (hasWarning) {
    report += '🟡 STATUS: CAUTION\n';
    report += '   Warnings present. Consider reducing stake sizes.\n';
  } else {
    report += '🟢 STATUS: NORMAL\n';
    report += '   Model operating within expected parameters.\n';
  }

  return report;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const season = args[0] ? parseInt(args[0]) : new Date().getFullYear();
  const week = args[1] ? parseInt(args[1]) : undefined;

  console.log('Generating weekly diagnostics...');

  const report = await generateReport(season, week);
  console.log(report);

  // Also save to database for tracking
  try {
    await supabase.from('diagnostic_reports').insert({
      season,
      week,
      report,
      generated_at: new Date().toISOString(),
    });
    console.log('\nReport saved to database.');
  } catch (e) {
    // Table may not exist, that's OK
    console.log('\n(Report not saved to database - table may not exist)');
  }
}

main().catch(console.error);
