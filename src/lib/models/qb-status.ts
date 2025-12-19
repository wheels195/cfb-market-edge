/**
 * QB Status Ingestion
 *
 * Scope: Starting QB only
 * Fields: status, as_of_timestamp
 * Rules:
 *   - Must be pre-kickoff
 *   - If missing → increase uncertainty (do not guess)
 * Usage:
 *   - Reduces uncertainty when confirmed
 *   - Never directly shifts projection more than small fixed adjustment
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PRODUCTION_CONFIG, type QBStatus } from './production-v1';

// =============================================================================
// CONSTANTS
// =============================================================================

// Maximum projection adjustment for QB status (strictly scoped)
const MAX_QB_PROJECTION_ADJUSTMENT = 1.5;  // Points - do not increase

// Uncertainty adjustments from production config
const QB_CONFIRMED_UNCERTAINTY_REDUCTION = 0.10;
const QB_UNKNOWN_UNCERTAINTY_INCREASE = PRODUCTION_CONFIG.betting.QB_UNKNOWN_UNCERTAINTY_INCREASE;
const QB_OUT_UNCERTAINTY_INCREASE = PRODUCTION_CONFIG.betting.QB_OUT_UNCERTAINTY_INCREASE;
const QB_QUESTIONABLE_UNCERTAINTY_INCREASE = PRODUCTION_CONFIG.betting.QB_QUESTIONABLE_UNCERTAINTY_INCREASE;

// =============================================================================
// TYPES
// =============================================================================

export interface QBStatusRecord {
  id?: number;
  team: string;
  season: number;
  week: number;
  status: 'confirmed' | 'questionable' | 'out' | 'unknown';
  player_name?: string;
  as_of_timestamp: Date;
  source?: string;
  created_at?: Date;
}

export interface QBStatusInput {
  team: string;
  season: number;
  week: number;
  status: 'confirmed' | 'questionable' | 'out';
  playerName?: string;
  source?: string;
}

// =============================================================================
// QB STATUS STORE
// =============================================================================

export class QBStatusStore {
  private supabase: SupabaseClient;
  private cache: Map<string, QBStatus> = new Map();

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  private getCacheKey(team: string, season: number, week: number): string {
    return `${team.toLowerCase()}-${season}-${week}`;
  }

  /**
   * Record QB status (must be pre-kickoff)
   */
  async recordQBStatus(input: QBStatusInput): Promise<QBStatus> {
    const now = new Date();

    const record: QBStatusRecord = {
      team: input.team,
      season: input.season,
      week: input.week,
      status: input.status,
      player_name: input.playerName,
      as_of_timestamp: now,
      source: input.source,
    };

    // Insert to database
    const { data, error } = await this.supabase
      .from('qb_status')
      .upsert(record, {
        onConflict: 'team,season,week',
      })
      .select()
      .single();

    if (error) {
      console.error('Error recording QB status:', error);
      throw error;
    }

    const qbStatus: QBStatus = {
      team: input.team,
      season: input.season,
      week: input.week,
      status: input.status,
      asOfTimestamp: now,
      playerName: input.playerName,
    };

    // Update cache
    const key = this.getCacheKey(input.team, input.season, input.week);
    this.cache.set(key, qbStatus);

    return qbStatus;
  }

  /**
   * Get QB status for a team/game
   * Returns 'unknown' if no status recorded
   */
  async getQBStatus(team: string, season: number, week: number): Promise<QBStatus> {
    const key = this.getCacheKey(team, season, week);

    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Query database
    const { data, error } = await this.supabase
      .from('qb_status')
      .select('*')
      .eq('team', team)
      .eq('season', season)
      .eq('week', week)
      .order('as_of_timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      // No status recorded - return unknown (increases uncertainty)
      const unknown: QBStatus = {
        team,
        season,
        week,
        status: 'unknown',
        asOfTimestamp: new Date(),
      };
      return unknown;
    }

    const qbStatus: QBStatus = {
      team: data.team,
      season: data.season,
      week: data.week,
      status: data.status,
      asOfTimestamp: new Date(data.as_of_timestamp),
      playerName: data.player_name,
    };

    // Cache result
    this.cache.set(key, qbStatus);

    return qbStatus;
  }

  /**
   * Bulk get QB status for multiple teams
   */
  async getQBStatusBulk(
    requests: Array<{ team: string; season: number; week: number }>
  ): Promise<Map<string, QBStatus>> {
    const results = new Map<string, QBStatus>();

    // Check cache and identify missing
    const missing: typeof requests = [];
    for (const req of requests) {
      const key = this.getCacheKey(req.team, req.season, req.week);
      if (this.cache.has(key)) {
        results.set(key, this.cache.get(key)!);
      } else {
        missing.push(req);
      }
    }

    if (missing.length === 0) {
      return results;
    }

    // Build query for missing
    const { data, error } = await this.supabase
      .from('qb_status')
      .select('*')
      .in('team', [...new Set(missing.map(r => r.team))])
      .in('season', [...new Set(missing.map(r => r.season))])
      .in('week', [...new Set(missing.map(r => r.week))]);

    if (data) {
      for (const row of data) {
        const key = this.getCacheKey(row.team, row.season, row.week);
        const qbStatus: QBStatus = {
          team: row.team,
          season: row.season,
          week: row.week,
          status: row.status,
          asOfTimestamp: new Date(row.as_of_timestamp),
          playerName: row.player_name,
        };
        results.set(key, qbStatus);
        this.cache.set(key, qbStatus);
      }
    }

    // Fill in unknown for truly missing
    for (const req of missing) {
      const key = this.getCacheKey(req.team, req.season, req.week);
      if (!results.has(key)) {
        const unknown: QBStatus = {
          team: req.team,
          season: req.season,
          week: req.week,
          status: 'unknown',
          asOfTimestamp: new Date(),
        };
        results.set(key, unknown);
      }
    }

    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// =============================================================================
// UNCERTAINTY ADJUSTMENT
// =============================================================================

/**
 * Calculate uncertainty adjustment based on QB status
 * This ONLY affects uncertainty, not the projection directly
 */
export function getQBUncertaintyAdjustment(status: QBStatus['status']): number {
  switch (status) {
    case 'confirmed':
      return -QB_CONFIRMED_UNCERTAINTY_REDUCTION;  // Reduces uncertainty
    case 'questionable':
      return QB_QUESTIONABLE_UNCERTAINTY_INCREASE;
    case 'out':
      return QB_OUT_UNCERTAINTY_INCREASE;
    case 'unknown':
    default:
      return QB_UNKNOWN_UNCERTAINTY_INCREASE;  // Increases uncertainty
  }
}

/**
 * Get the maximum allowed projection adjustment for QB status
 * This is strictly capped to prevent the QB factor from dominating
 */
export function getMaxQBProjectionAdjustment(): number {
  return MAX_QB_PROJECTION_ADJUSTMENT;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that QB status was recorded pre-kickoff
 */
export function validatePreKickoff(
  qbStatus: QBStatus,
  kickoffTime: Date
): boolean {
  return qbStatus.asOfTimestamp < kickoffTime;
}

/**
 * Check if QB status is stale (recorded too early)
 * Status older than 24 hours before kickoff should be refreshed
 */
export function isQBStatusStale(
  qbStatus: QBStatus,
  kickoffTime: Date,
  maxAgeHours: number = 24
): boolean {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const timeDiff = kickoffTime.getTime() - qbStatus.asOfTimestamp.getTime();
  return timeDiff > maxAgeMs;
}

// =============================================================================
// DATABASE SCHEMA (for reference)
// =============================================================================

/*
CREATE TABLE IF NOT EXISTS qb_status (
  id SERIAL PRIMARY KEY,
  team VARCHAR(100) NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('confirmed', 'questionable', 'out', 'unknown')),
  player_name VARCHAR(100),
  as_of_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team, season, week)
);

CREATE INDEX idx_qb_status_lookup ON qb_status(team, season, week);
*/
