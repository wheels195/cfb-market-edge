/**
 * CLV + Performance Monitoring
 *
 * Daily jobs:
 *   - CLV vs close (per book)
 *   - Edge persistence
 *   - Win rate by edge bucket
 *   - Weeks 1-4 vs Weeks 5+
 *
 * Alerts:
 *   - If Top 5% drops below breakeven for N weeks → flag
 *   - If uncertainty-shrunk edges stop persisting → flag
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MONITORING_THRESHOLDS } from './production-v1';

// =============================================================================
// TYPES
// =============================================================================

export interface BetRecord {
  id: string;
  gameKey: string;
  season: number;
  week: number;
  team: string;
  side: 'home' | 'away';
  spreadAtBet: number;
  spreadAtClose?: number;
  effectiveEdge: number;
  rawEdge: number;
  uncertainty: number;
  percentile: number;
  result?: 'win' | 'loss' | 'push';
  homeScore?: number;
  awayScore?: number;
  timestamp: Date;
}

export interface CLVMetrics {
  totalBets: number;
  avgCLV: number;               // Average (close - open) in our favor
  clvCaptureRate: number;       // % of bets where line moved our way
  avgLineMovement: number;      // Average absolute line movement
}

export interface PerformanceMetrics {
  bucket: string;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
}

export interface Alert {
  type: 'warning' | 'critical';
  category: 'performance' | 'clv' | 'data';
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

// =============================================================================
// MONITORING STORE
// =============================================================================

export class MonitoringStore {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ===========================================================================
  // BET RECORDING
  // ===========================================================================

  async recordBet(bet: BetRecord): Promise<void> {
    const { error } = await this.supabase.from('bet_records').insert(bet);
    if (error) {
      console.error('Error recording bet:', error);
      throw error;
    }
  }

  async updateBetResult(
    gameKey: string,
    spreadAtClose: number,
    result: 'win' | 'loss' | 'push',
    homeScore: number,
    awayScore: number
  ): Promise<void> {
    const { error } = await this.supabase
      .from('bet_records')
      .update({
        spread_at_close: spreadAtClose,
        result,
        home_score: homeScore,
        away_score: awayScore,
      })
      .eq('game_key', gameKey);

    if (error) {
      console.error('Error updating bet result:', error);
      throw error;
    }
  }

  // ===========================================================================
  // CLV METRICS
  // ===========================================================================

  async calculateCLV(season: number, week?: number): Promise<CLVMetrics> {
    let query = this.supabase
      .from('bet_records')
      .select('*')
      .eq('season', season)
      .not('spread_at_close', 'is', null);

    if (week) {
      query = query.eq('week', week);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return {
        totalBets: 0,
        avgCLV: 0,
        clvCaptureRate: 0,
        avgLineMovement: 0,
      };
    }

    let totalCLV = 0;
    let clvCaptured = 0;
    let totalMovement = 0;

    for (const bet of data) {
      const lineMovement = bet.spread_at_close - bet.spread_at_bet;

      // CLV: If we bet home (edge < 0), line moving up is good
      // If we bet away (edge > 0), line moving down is good
      const clvDirection = bet.side === 'home' ? lineMovement : -lineMovement;

      totalCLV += clvDirection;
      if (clvDirection > 0) clvCaptured++;
      totalMovement += Math.abs(lineMovement);
    }

    return {
      totalBets: data.length,
      avgCLV: totalCLV / data.length,
      clvCaptureRate: clvCaptured / data.length,
      avgLineMovement: totalMovement / data.length,
    };
  }

  // ===========================================================================
  // PERFORMANCE METRICS
  // ===========================================================================

  async calculatePerformance(
    season: number,
    bucket?: 'top5' | 'top10' | 'top20' | 'all',
    weekRange?: { start: number; end: number }
  ): Promise<PerformanceMetrics> {
    let query = this.supabase
      .from('bet_records')
      .select('*')
      .eq('season', season)
      .not('result', 'is', null);

    if (weekRange) {
      query = query.gte('week', weekRange.start).lte('week', weekRange.end);
    }

    if (bucket === 'top5') {
      query = query.lte('percentile', 0.05);
    } else if (bucket === 'top10') {
      query = query.lte('percentile', 0.10);
    } else if (bucket === 'top20') {
      query = query.lte('percentile', 0.20);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return {
        bucket: bucket || 'all',
        totalBets: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        winRate: 0,
        roi: 0,
      };
    }

    const wins = data.filter(b => b.result === 'win').length;
    const losses = data.filter(b => b.result === 'loss').length;
    const pushes = data.filter(b => b.result === 'push').length;
    const decided = wins + losses;

    const winRate = decided > 0 ? wins / decided : 0;
    const roi = winRate * 0.909 - (1 - winRate);  // -110 odds

    return {
      bucket: bucket || 'all',
      totalBets: data.length,
      wins,
      losses,
      pushes,
      winRate,
      roi,
    };
  }

  async calculateWeekByWeek(season: number): Promise<PerformanceMetrics[]> {
    const results: PerformanceMetrics[] = [];

    for (let week = 1; week <= 16; week++) {
      const metrics = await this.calculatePerformance(season, 'top5', { start: week, end: week });
      if (metrics.totalBets > 0) {
        results.push({ ...metrics, bucket: `Week ${week}` });
      }
    }

    return results;
  }

  // ===========================================================================
  // EDGE PERSISTENCE
  // ===========================================================================

  async calculateEdgePersistence(season: number): Promise<number> {
    const { data, error } = await this.supabase
      .from('bet_records')
      .select('*')
      .eq('season', season)
      .not('spread_at_close', 'is', null);

    if (error || !data || data.length === 0) {
      return 0;
    }

    let persisted = 0;

    for (const bet of data) {
      const closingEdge = bet.side === 'home'
        ? -(bet.spread_at_close - bet.spread_at_bet)  // home: higher close = edge persisted
        : bet.spread_at_close - bet.spread_at_bet;    // away: lower close = edge persisted

      // Edge persisted if effective edge direction survived to close
      if ((bet.effective_edge > 0 && closingEdge > 0) ||
          (bet.effective_edge < 0 && closingEdge < 0)) {
        persisted++;
      }
    }

    return persisted / data.length;
  }

  // ===========================================================================
  // ALERTS
  // ===========================================================================

  async checkAlerts(season: number): Promise<Alert[]> {
    const alerts: Alert[] = [];

    // 1. Check Top 5% win rate
    const top5Metrics = await this.calculatePerformance(season, 'top5');
    if (top5Metrics.totalBets >= 10 && top5Metrics.winRate < MONITORING_THRESHOLDS.TOP_5_MIN_WIN_RATE) {
      alerts.push({
        type: 'critical',
        category: 'performance',
        message: `Top 5% win rate ${(top5Metrics.winRate * 100).toFixed(1)}% below ${(MONITORING_THRESHOLDS.TOP_5_MIN_WIN_RATE * 100).toFixed(0)}% threshold`,
        metric: 'top5_win_rate',
        value: top5Metrics.winRate,
        threshold: MONITORING_THRESHOLDS.TOP_5_MIN_WIN_RATE,
        timestamp: new Date(),
      });
    }

    // 2. Check CLV capture rate
    const clvMetrics = await this.calculateCLV(season);
    if (clvMetrics.totalBets >= 10 && clvMetrics.clvCaptureRate < MONITORING_THRESHOLDS.MIN_CLV_CAPTURE_RATE) {
      alerts.push({
        type: 'warning',
        category: 'clv',
        message: `CLV capture rate ${(clvMetrics.clvCaptureRate * 100).toFixed(1)}% below ${(MONITORING_THRESHOLDS.MIN_CLV_CAPTURE_RATE * 100).toFixed(0)}% threshold`,
        metric: 'clv_capture_rate',
        value: clvMetrics.clvCaptureRate,
        threshold: MONITORING_THRESHOLDS.MIN_CLV_CAPTURE_RATE,
        timestamp: new Date(),
      });
    }

    // 3. Check edge persistence
    const persistence = await this.calculateEdgePersistence(season);
    if (persistence < MONITORING_THRESHOLDS.MIN_EDGE_PERSISTENCE) {
      alerts.push({
        type: 'warning',
        category: 'clv',
        message: `Edge persistence ${(persistence * 100).toFixed(1)}% below ${(MONITORING_THRESHOLDS.MIN_EDGE_PERSISTENCE * 100).toFixed(0)}% threshold`,
        metric: 'edge_persistence',
        value: persistence,
        threshold: MONITORING_THRESHOLDS.MIN_EDGE_PERSISTENCE,
        timestamp: new Date(),
      });
    }

    // 4. Check Weeks 1-4 vs Weeks 5+ divergence
    const early = await this.calculatePerformance(season, 'top5', { start: 1, end: 4 });
    const late = await this.calculatePerformance(season, 'top5', { start: 5, end: 16 });

    if (early.totalBets >= 5 && late.totalBets >= 5) {
      const divergence = Math.abs(late.winRate - early.winRate);
      if (divergence > 0.15) {  // More than 15pp difference
        alerts.push({
          type: 'warning',
          category: 'performance',
          message: `Large divergence between early (${(early.winRate * 100).toFixed(1)}%) and late (${(late.winRate * 100).toFixed(1)}%) season`,
          metric: 'season_divergence',
          value: divergence,
          threshold: 0.15,
          timestamp: new Date(),
        });
      }
    }

    return alerts;
  }

  // ===========================================================================
  // DAILY REPORT
  // ===========================================================================

  async generateDailyReport(season: number): Promise<string> {
    let report = `\n=== DAILY MONITORING REPORT: ${season} ===\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // Performance summary
    report += '--- PERFORMANCE ---\n';
    for (const bucket of ['top5', 'top10', 'top20', 'all'] as const) {
      const metrics = await this.calculatePerformance(season, bucket);
      report += `${bucket.toUpperCase().padEnd(6)}: ${metrics.wins}W-${metrics.losses}L`;
      report += ` (${(metrics.winRate * 100).toFixed(1)}% win, ${(metrics.roi * 100).toFixed(1)}% ROI)\n`;
    }

    // Week breakdown
    report += '\n--- BY WEEK (TOP 5%) ---\n';
    const earlyMetrics = await this.calculatePerformance(season, 'top5', { start: 1, end: 4 });
    const lateMetrics = await this.calculatePerformance(season, 'top5', { start: 5, end: 16 });
    report += `Weeks 1-4:  ${(earlyMetrics.winRate * 100).toFixed(1)}% win (N=${earlyMetrics.totalBets})\n`;
    report += `Weeks 5+:   ${(lateMetrics.winRate * 100).toFixed(1)}% win (N=${lateMetrics.totalBets})\n`;

    // CLV summary
    report += '\n--- CLV METRICS ---\n';
    const clv = await this.calculateCLV(season);
    report += `Total bets: ${clv.totalBets}\n`;
    report += `Avg CLV: ${clv.avgCLV >= 0 ? '+' : ''}${clv.avgCLV.toFixed(2)} pts\n`;
    report += `CLV capture rate: ${(clv.clvCaptureRate * 100).toFixed(1)}%\n`;
    report += `Avg line movement: ${clv.avgLineMovement.toFixed(2)} pts\n`;

    // Edge persistence
    report += '\n--- EDGE PERSISTENCE ---\n';
    const persistence = await this.calculateEdgePersistence(season);
    report += `Persistence rate: ${(persistence * 100).toFixed(1)}%\n`;

    // Alerts
    report += '\n--- ALERTS ---\n';
    const alerts = await this.checkAlerts(season);
    if (alerts.length === 0) {
      report += 'No alerts.\n';
    } else {
      for (const alert of alerts) {
        report += `[${alert.type.toUpperCase()}] ${alert.message}\n`;
      }
    }

    return report;
  }
}

// =============================================================================
// DATABASE SCHEMA (for reference)
// =============================================================================

/*
CREATE TABLE IF NOT EXISTS bet_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team VARCHAR(100) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away')),
  spread_at_bet DECIMAL(5,1) NOT NULL,
  spread_at_close DECIMAL(5,1),
  effective_edge DECIMAL(5,2) NOT NULL,
  raw_edge DECIMAL(5,2) NOT NULL,
  uncertainty DECIMAL(3,2) NOT NULL,
  percentile DECIMAL(4,3) NOT NULL,
  result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push')),
  home_score INTEGER,
  away_score INTEGER,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_key, season, week)
);

CREATE INDEX idx_bet_records_season_week ON bet_records(season, week);
CREATE INDEX idx_bet_records_percentile ON bet_records(percentile);
CREATE INDEX idx_bet_records_result ON bet_records(result);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  category VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  metric VARCHAR(50) NOT NULL,
  value DECIMAL(10,4) NOT NULL,
  threshold DECIMAL(10,4) NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
*/
