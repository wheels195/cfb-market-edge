/**
 * Model Snapshot Jobs
 *
 * Weekly jobs for:
 *   - create_model_run_snapshot: Freeze model state at a point in time
 *   - generate_bet_records: Generate bet ledger from Top 5% edges
 *
 * These create immutable records for tracking and audit.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  PRODUCTION_CONFIG,
  MODEL_VERSION,
  MODEL_ID,
  BETTING_RULES,
  type EdgeResult,
  type QBStatus,
} from '../models/production-v1';
import {
  decideBet,
  processBettingSlate,
  generateBetSlips,
  type BetSlip,
} from '../models/betting-rules';

// =============================================================================
// TYPES
// =============================================================================

export interface ModelRun {
  id: string;
  season: number;
  week: number;
  modelVersion: string;
  modelId: string;
  asOfTimestamp: Date;
  configSnapshot: typeof PRODUCTION_CONFIG;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
}

export interface ModelRunProjection {
  modelRunId: string;
  cfbdGameId: number;
  homeTeam: string;
  awayTeam: string;
  modelSpread: number;
  modelTotal: number | null;
  homeRating: number;
  awayRating: number;
  uncertainty: number;
}

export interface ModelRunEdge {
  modelRunId: string;
  cfbdGameId: number;
  marketType: 'spread' | 'total';
  marketLine: number;
  modelLine: number;
  rawEdge: number;
  effectiveEdge: number;
  uncertainty: number;
  side: 'home' | 'away' | 'over' | 'under';
  percentile: number;
  bettable: boolean;
  reason: string | null;
}

export interface SnapshotResult {
  modelRunId: string;
  season: number;
  week: number;
  projectionsCreated: number;
  edgesCreated: number;
  errors: string[];
}

export interface BetLedgerResult {
  modelRunId: string;
  betsGenerated: number;
  totalEdge: number;
  avgEffectiveEdge: number;
  errors: string[];
}

// =============================================================================
// MODEL SNAPSHOT STORE
// =============================================================================

export class ModelSnapshotStore {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Create a model run snapshot
   * Freezes the current model state at a specific point in time
   */
  async createModelRunSnapshot(
    season: number,
    week: number,
    asOfTimestamp: Date = new Date()
  ): Promise<SnapshotResult> {
    const errors: string[] = [];

    // Generate unique ID for this model run
    const modelRunId = `${MODEL_VERSION}-${season}-W${week}-${asOfTimestamp.getTime()}`;

    try {
      // IDEMPOTENCY CHECK: Skip if model run already exists
      const { data: existingRun } = await this.supabase
        .from('model_runs')
        .select('id, status')
        .eq('id', modelRunId)
        .single();

      if (existingRun) {
        // Model run already exists - return existing data without re-creating
        const { data: existingProjections } = await this.supabase
          .from('model_run_projections')
          .select('count')
          .eq('model_run_id', modelRunId);

        const { data: existingEdges } = await this.supabase
          .from('model_run_edges')
          .select('count')
          .eq('model_run_id', modelRunId);

        return {
          modelRunId,
          season,
          week,
          projectionsCreated: existingProjections?.length || 0,
          edgesCreated: existingEdges?.length || 0,
          errors: [`Model run already exists (status: ${existingRun.status}), reusing`],
        };
      }

      // 1. Create model_run record
      const { error: runError } = await this.supabase
        .from('model_runs')
        .insert({
          id: modelRunId,
          season,
          week,
          model_version: MODEL_VERSION,
          model_id: MODEL_ID,
          as_of_timestamp: asOfTimestamp.toISOString(),
          config_snapshot: PRODUCTION_CONFIG,
          status: 'pending',
        });

      if (runError) {
        errors.push(`Error creating model run: ${runError.message}`);
        return { modelRunId, season, week, projectionsCreated: 0, edgesCreated: 0, errors };
      }

      // 2. Get team ratings for this week
      const { data: ratings, error: ratingsError } = await this.supabase
        .from('team_ratings')
        .select('*')
        .eq('season', season)
        .eq('week', week - 1);  // Use prior week ratings

      if (ratingsError) {
        errors.push(`Error fetching ratings: ${ratingsError.message}`);
      }

      // 3. Get games for this week
      const { data: games, error: gamesError } = await this.supabase
        .from('cfbd_games')
        .select('*')
        .eq('season', season)
        .eq('week', week);

      if (gamesError) {
        errors.push(`Error fetching games: ${gamesError.message}`);
      }

      // 4. Get betting lines (latest before as_of_timestamp)
      const { data: lines, error: linesError } = await this.supabase
        .from('cfbd_betting_lines')
        .select('*')
        .eq('season', season)
        .eq('week', week);

      if (linesError) {
        errors.push(`Error fetching lines: ${linesError.message}`);
      }

      // 5. Get existing projections
      const { data: projections, error: projError } = await this.supabase
        .from('projections')
        .select('*')
        .eq('season', season)
        .eq('week', week);

      if (projError) {
        errors.push(`Error fetching projections: ${projError.message}`);
      }

      // 6. Create projection snapshots
      let projectionsCreated = 0;
      const projectionRecords: any[] = [];

      for (const proj of projections || []) {
        projectionRecords.push({
          model_run_id: modelRunId,
          cfbd_game_id: proj.cfbd_game_id,
          home_team: proj.home_team,
          away_team: proj.away_team,
          model_spread: proj.model_spread,
          model_total: proj.model_total,
          home_rating: proj.home_rating,
          away_rating: proj.away_rating,
          uncertainty: proj.uncertainty,
        });
      }

      if (projectionRecords.length > 0) {
        // Use upsert for idempotency (safe to re-run)
        const { error: projInsertError } = await this.supabase
          .from('model_run_projections')
          .upsert(projectionRecords, { onConflict: 'model_run_id,cfbd_game_id' });

        if (projInsertError) {
          errors.push(`Error inserting projections: ${projInsertError.message}`);
        } else {
          projectionsCreated = projectionRecords.length;
        }
      }

      // 7. Get existing edges
      const { data: edges, error: edgesError } = await this.supabase
        .from('edges')
        .select('*')
        .eq('season', season)
        .eq('week', week);

      if (edgesError) {
        errors.push(`Error fetching edges: ${edgesError.message}`);
      }

      // 8. Create edge snapshots
      let edgesCreated = 0;
      const edgeRecords: any[] = [];

      for (const edge of edges || []) {
        edgeRecords.push({
          model_run_id: modelRunId,
          cfbd_game_id: edge.cfbd_game_id,
          market_type: edge.market_type || 'spread',
          market_line: edge.market_spread,
          model_line: edge.model_spread,
          raw_edge: edge.raw_edge,
          effective_edge: edge.effective_edge,
          uncertainty: edge.uncertainty,
          side: edge.side,
          percentile: edge.percentile,
          bettable: edge.bettable,
          reason: edge.reason,
        });
      }

      if (edgeRecords.length > 0) {
        // Use upsert for idempotency (safe to re-run)
        const { error: edgeInsertError } = await this.supabase
          .from('model_run_edges')
          .upsert(edgeRecords, { onConflict: 'model_run_id,cfbd_game_id,market_type' });

        if (edgeInsertError) {
          errors.push(`Error inserting edges: ${edgeInsertError.message}`);
        } else {
          edgesCreated = edgeRecords.length;
        }
      }

      // 9. Update model run status
      await this.supabase
        .from('model_runs')
        .update({ status: errors.length === 0 ? 'completed' : 'failed' })
        .eq('id', modelRunId);

      return {
        modelRunId,
        season,
        week,
        projectionsCreated,
        edgesCreated,
        errors,
      };
    } catch (e) {
      errors.push(`Exception creating snapshot: ${e}`);
      return { modelRunId, season, week, projectionsCreated: 0, edgesCreated: 0, errors };
    }
  }

  /**
   * Generate bet records from a model run
   * Only includes Top 5% effective edges that pass all betting rules
   */
  async generateBetRecords(modelRunId: string): Promise<BetLedgerResult> {
    const errors: string[] = [];
    let betsGenerated = 0;
    let totalEdge = 0;

    try {
      // 1. Get model run details
      const { data: modelRun, error: runError } = await this.supabase
        .from('model_runs')
        .select('*')
        .eq('id', modelRunId)
        .single();

      if (runError || !modelRun) {
        errors.push(`Model run not found: ${modelRunId}`);
        return { modelRunId, betsGenerated: 0, totalEdge: 0, avgEffectiveEdge: 0, errors };
      }

      const season = modelRun.season;
      const week = modelRun.week;

      // 2. Get edges from this model run
      const { data: edges, error: edgesError } = await this.supabase
        .from('model_run_edges')
        .select('*')
        .eq('model_run_id', modelRunId)
        .eq('bettable', true)
        .order('effective_edge', { ascending: false });

      if (edgesError) {
        errors.push(`Error fetching edges: ${edgesError.message}`);
        return { modelRunId, betsGenerated: 0, totalEdge: 0, avgEffectiveEdge: 0, errors };
      }

      if (!edges || edges.length === 0) {
        return { modelRunId, betsGenerated: 0, totalEdge: 0, avgEffectiveEdge: 0, errors: ['No bettable edges found'] };
      }

      // 3. Get QB status for this week
      const { data: qbStatuses } = await this.supabase
        .from('qb_status')
        .select('*')
        .eq('season', season)
        .eq('week', week);

      const qbStatusMap = new Map<string, QBStatus>();
      for (const qs of qbStatuses || []) {
        const key = `${qs.team.toLowerCase()}-${season}-${week}`;
        qbStatusMap.set(key, {
          team: qs.team,
          season: qs.season,
          week: qs.week,
          status: qs.status,
          asOfTimestamp: new Date(qs.as_of_timestamp),
          playerName: qs.player_name,
        });
      }

      // 4. Get projections for game details
      const { data: projections } = await this.supabase
        .from('model_run_projections')
        .select('*')
        .eq('model_run_id', modelRunId);

      const projectionMap = new Map<number, any>();
      for (const proj of projections || []) {
        projectionMap.set(proj.cfbd_game_id, proj);
      }

      // 5. Filter to Top 5% and apply betting rules
      const betRecords: any[] = [];
      const percentileThreshold = BETTING_RULES.DEFAULT_EDGE_PERCENTILE;

      // Calculate percentiles
      const sortedEdges = [...edges].sort((a, b) =>
        Math.abs(b.effective_edge) - Math.abs(a.effective_edge)
      );

      for (let i = 0; i < sortedEdges.length; i++) {
        const edge = sortedEdges[i];
        const percentile = (i + 1) / sortedEdges.length;

        // Skip if not in Top 5%
        if (percentile > percentileThreshold) continue;

        const proj = projectionMap.get(edge.cfbd_game_id);
        if (!proj) continue;

        // Get QB status
        const homeQBKey = `${proj.home_team.toLowerCase()}-${season}-${week}`;
        const awayQBKey = `${proj.away_team.toLowerCase()}-${season}-${week}`;
        const homeQBStatus = qbStatusMap.get(homeQBKey) || {
          team: proj.home_team,
          season,
          week,
          status: 'unknown' as const,
          asOfTimestamp: new Date(),
        };
        const awayQBStatus = qbStatusMap.get(awayQBKey) || {
          team: proj.away_team,
          season,
          week,
          status: 'unknown' as const,
          asOfTimestamp: new Date(),
        };

        // Create edge result for betting rules
        const edgeResult: EdgeResult = {
          season,
          week,
          homeTeam: proj.home_team,
          awayTeam: proj.away_team,
          spreadOpen: edge.market_line,
          modelSpread: edge.model_line,
          rawEdge: edge.raw_edge,
          effectiveEdge: edge.effective_edge,
          uncertainty: {
            total: edge.uncertainty,
            week: 0,
            homeRoster: 0,
            homeQB: 0,
            homeCoach: 0,
            awayRoster: 0,
            awayQB: 0,
            awayCoach: 0,
          },
          side: edge.side,
          isHighUncertainty: edge.uncertainty > 0.40,
          requiresQBCheck: week <= 4,
          bettable: edge.bettable,
          reason: edge.reason,
        };

        // Apply betting rules
        const decision = decideBet({
          edge: edgeResult,
          homeQBStatus,
          awayQBStatus,
          percentile,
          marketType: edge.market_type,
        });

        if (decision.shouldBet) {
          const team = edge.side === 'home' ? proj.home_team : proj.away_team;
          const gameKey = `${proj.away_team}@${proj.home_team}`;

          betRecords.push({
            game_key: gameKey,
            season,
            week,
            team,
            side: edge.side,
            spread_at_bet: edge.market_line,
            effective_edge: edge.effective_edge,
            raw_edge: edge.raw_edge,
            uncertainty: edge.uncertainty,
            percentile,
            model_version: MODEL_VERSION,
            model_run_id: modelRunId,
          });

          totalEdge += Math.abs(edge.effective_edge);
        }
      }

      // 6. Insert bet records
      if (betRecords.length > 0) {
        const { error: insertError } = await this.supabase
          .from('bet_records')
          .upsert(betRecords, { onConflict: 'game_key,season,week' });

        if (insertError) {
          errors.push(`Error inserting bet records: ${insertError.message}`);
        } else {
          betsGenerated = betRecords.length;
        }
      }

      return {
        modelRunId,
        betsGenerated,
        totalEdge,
        avgEffectiveEdge: betsGenerated > 0 ? totalEdge / betsGenerated : 0,
        errors,
      };
    } catch (e) {
      errors.push(`Exception generating bets: ${e}`);
      return { modelRunId, betsGenerated: 0, totalEdge: 0, avgEffectiveEdge: 0, errors };
    }
  }

  /**
   * Get model run by ID
   */
  async getModelRun(modelRunId: string): Promise<ModelRun | null> {
    const { data, error } = await this.supabase
      .from('model_runs')
      .select('*')
      .eq('id', modelRunId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      season: data.season,
      week: data.week,
      modelVersion: data.model_version,
      modelId: data.model_id,
      asOfTimestamp: new Date(data.as_of_timestamp),
      configSnapshot: data.config_snapshot,
      status: data.status,
      createdAt: new Date(data.created_at),
    };
  }

  /**
   * Get all model runs for a season/week
   */
  async getModelRuns(season: number, week?: number): Promise<ModelRun[]> {
    let query = this.supabase
      .from('model_runs')
      .select('*')
      .eq('season', season)
      .order('as_of_timestamp', { ascending: false });

    if (week !== undefined) {
      query = query.eq('week', week);
    }

    const { data, error } = await query;

    if (error || !data) return [];

    return data.map(row => ({
      id: row.id,
      season: row.season,
      week: row.week,
      modelVersion: row.model_version,
      modelId: row.model_id,
      asOfTimestamp: new Date(row.as_of_timestamp),
      configSnapshot: row.config_snapshot,
      status: row.status,
      createdAt: new Date(row.created_at),
    }));
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { ModelSnapshotStore as default };
