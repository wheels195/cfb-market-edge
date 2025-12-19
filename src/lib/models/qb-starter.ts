/**
 * QB Starter Identification (Post-Game Truth)
 *
 * Purpose: Identify which QB actually started each game
 * Method: Player with highest pass attempts per team per game
 * Usage: Backtest validation, analytics, model accuracy tracking
 *
 * This is SEPARATE from qb_status (pre-kickoff predictions).
 * qb_started = post-game truth for validation
 * qb_status = pre-kickoff status for live betting
 *
 * ⚠️ GUARD: DO NOT USE THIS FOR LIVE BETTING DECISIONS ⚠️
 *
 * This module provides POST-GAME data only. For live betting:
 *   - Use qb-status.ts and QBStatus type
 *   - Query qb_status table (not qb_started)
 *
 * Live pipelines (model-snapshot.ts, betting-rules.ts, materialize-edges.ts)
 * MUST NOT import from this file. This is enforced by code review.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CFBDApiClient } from '../api/cfbd-api';
import { CFBDPlayerGameStats, CFBDPlayerGameStatsTeam } from '@/types/cfbd-api';

// =============================================================================
// TYPES
// =============================================================================

export interface QBStarted {
  cfbdGameId: number;
  season: number;
  week: number;
  team: string;
  playerId: string | null;
  playerName: string;
  passAttempts: number;
  passCompletions: number | null;
  passYards: number | null;
  passTds: number | null;
  interceptions: number | null;
}

export interface QBStarterSyncResult {
  season: number;
  week: number;
  gamesProcessed: number;
  startersIdentified: number;
  errors: string[];
}

// =============================================================================
// QB STARTER EXTRACTION
// =============================================================================

/**
 * Extract starting QB from a team's game stats
 * Starting QB = player with highest pass attempts
 */
function extractStartingQB(
  teamStats: CFBDPlayerGameStatsTeam,
  gameId: number,
  season: number,
  week: number
): QBStarted | null {
  // Find passing category
  const passingCategory = teamStats.categories.find(
    c => c.name.toLowerCase() === 'passing'
  );

  if (!passingCategory) {
    return null;
  }

  // Find ATT (attempts) type
  const attType = passingCategory.types.find(
    t => t.name.toLowerCase() === 'att' || t.name.toLowerCase() === 'attempts'
  );

  if (!attType || !attType.athletes || attType.athletes.length === 0) {
    return null;
  }

  // Find player with highest attempts
  let maxAttempts = 0;
  let startingQB: { id: string; name: string; attempts: number } | null = null;

  for (const athlete of attType.athletes) {
    const attempts = typeof athlete.stat === 'string'
      ? parseInt(athlete.stat, 10)
      : athlete.stat;

    if (!isNaN(attempts) && attempts > maxAttempts) {
      maxAttempts = attempts;
      startingQB = { id: athlete.id, name: athlete.name, attempts };
    }
  }

  if (!startingQB || startingQB.attempts === 0) {
    return null;
  }

  // Get additional stats for this player
  let completions: number | null = null;
  let yards: number | null = null;
  let tds: number | null = null;
  let interceptions: number | null = null;

  // Find completions (C or COMP)
  const compType = passingCategory.types.find(
    t => t.name.toLowerCase() === 'c' ||
         t.name.toLowerCase() === 'comp' ||
         t.name.toLowerCase() === 'completions'
  );
  if (compType?.athletes) {
    const playerStat = compType.athletes.find(a => a.id === startingQB!.id);
    if (playerStat) {
      completions = typeof playerStat.stat === 'string'
        ? parseInt(playerStat.stat, 10)
        : playerStat.stat;
    }
  }

  // Find yards (YDS)
  const ydsType = passingCategory.types.find(
    t => t.name.toLowerCase() === 'yds' || t.name.toLowerCase() === 'yards'
  );
  if (ydsType?.athletes) {
    const playerStat = ydsType.athletes.find(a => a.id === startingQB!.id);
    if (playerStat) {
      yards = typeof playerStat.stat === 'string'
        ? parseInt(playerStat.stat, 10)
        : playerStat.stat;
    }
  }

  // Find TDs
  const tdType = passingCategory.types.find(
    t => t.name.toLowerCase() === 'td' || t.name.toLowerCase() === 'tds'
  );
  if (tdType?.athletes) {
    const playerStat = tdType.athletes.find(a => a.id === startingQB!.id);
    if (playerStat) {
      tds = typeof playerStat.stat === 'string'
        ? parseInt(playerStat.stat, 10)
        : playerStat.stat;
    }
  }

  // Find INTs
  const intType = passingCategory.types.find(
    t => t.name.toLowerCase() === 'int' || t.name.toLowerCase() === 'interceptions'
  );
  if (intType?.athletes) {
    const playerStat = intType.athletes.find(a => a.id === startingQB!.id);
    if (playerStat) {
      interceptions = typeof playerStat.stat === 'string'
        ? parseInt(playerStat.stat, 10)
        : playerStat.stat;
    }
  }

  return {
    cfbdGameId: gameId,
    season,
    week,
    team: teamStats.school,
    playerId: startingQB.id,
    playerName: startingQB.name,
    passAttempts: startingQB.attempts,
    passCompletions: completions,
    passYards: yards,
    passTds: tds,
    interceptions,
  };
}

/**
 * Process player game stats and identify starting QBs
 */
export function identifyStartingQBs(
  gameStats: CFBDPlayerGameStats[],
  season: number,
  week: number
): QBStarted[] {
  const starters: QBStarted[] = [];

  for (const game of gameStats) {
    for (const teamStats of game.teams) {
      const starter = extractStartingQB(teamStats, game.id, season, week);
      if (starter) {
        starters.push(starter);
      }
    }
  }

  return starters;
}

// =============================================================================
// QB STARTER STORE
// =============================================================================

export class QBStarterStore {
  private supabase: SupabaseClient;
  private cfbdClient: CFBDApiClient;

  constructor(supabaseUrl: string, supabaseKey: string, cfbdApiKey?: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.cfbdClient = new CFBDApiClient(cfbdApiKey);
  }

  /**
   * Sync QB starters for a specific week
   * Fetches from CFBD and upserts to database
   */
  async syncWeek(season: number, week: number): Promise<QBStarterSyncResult> {
    const errors: string[] = [];
    let startersIdentified = 0;
    let gamesProcessed = 0;

    try {
      // Fetch player game stats from CFBD
      const gameStats = await this.cfbdClient.getPlayerGameStats(season, week);
      gamesProcessed = gameStats.length;

      // Identify starting QBs
      const starters = identifyStartingQBs(gameStats, season, week);
      startersIdentified = starters.length;

      // Upsert to database
      for (const starter of starters) {
        const { error } = await this.supabase
          .from('qb_started')
          .upsert({
            cfbd_game_id: starter.cfbdGameId,
            season: starter.season,
            week: starter.week,
            team: starter.team,
            player_id: starter.playerId,
            player_name: starter.playerName,
            pass_attempts: starter.passAttempts,
            pass_completions: starter.passCompletions,
            pass_yards: starter.passYards,
            pass_tds: starter.passTds,
            interceptions: starter.interceptions,
          }, {
            onConflict: 'cfbd_game_id,team',
          });

        if (error) {
          errors.push(`Error upserting ${starter.team} week ${week}: ${error.message}`);
        }
      }
    } catch (e) {
      errors.push(`Exception syncing week ${week}: ${e}`);
    }

    return {
      season,
      week,
      gamesProcessed,
      startersIdentified,
      errors,
    };
  }

  /**
   * Sync all weeks in a season
   */
  async syncSeason(season: number, startWeek: number = 1, endWeek: number = 15): Promise<QBStarterSyncResult[]> {
    const results: QBStarterSyncResult[] = [];

    for (let week = startWeek; week <= endWeek; week++) {
      console.log(`Syncing QB starters for ${season} week ${week}...`);
      const result = await this.syncWeek(season, week);
      results.push(result);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return results;
  }

  /**
   * Get starter for a specific game
   */
  async getStarterForGame(cfbdGameId: number, team: string): Promise<QBStarted | null> {
    const { data, error } = await this.supabase
      .from('qb_started')
      .select('*')
      .eq('cfbd_game_id', cfbdGameId)
      .eq('team', team)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      cfbdGameId: data.cfbd_game_id,
      season: data.season,
      week: data.week,
      team: data.team,
      playerId: data.player_id,
      playerName: data.player_name,
      passAttempts: data.pass_attempts,
      passCompletions: data.pass_completions,
      passYards: data.pass_yards,
      passTds: data.pass_tds,
      interceptions: data.interceptions,
    };
  }

  /**
   * Get all starters for a week
   */
  async getStartersForWeek(season: number, week: number): Promise<QBStarted[]> {
    const { data, error } = await this.supabase
      .from('qb_started')
      .select('*')
      .eq('season', season)
      .eq('week', week);

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      cfbdGameId: row.cfbd_game_id,
      season: row.season,
      week: row.week,
      team: row.team,
      playerId: row.player_id,
      playerName: row.player_name,
      passAttempts: row.pass_attempts,
      passCompletions: row.pass_completions,
      passYards: row.pass_yards,
      passTds: row.pass_tds,
      interceptions: row.interceptions,
    }));
  }

  /**
   * Get starter history for a team
   */
  async getStarterHistory(team: string, season: number): Promise<QBStarted[]> {
    const { data, error } = await this.supabase
      .from('qb_started')
      .select('*')
      .eq('team', team)
      .eq('season', season)
      .order('week', { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      cfbdGameId: row.cfbd_game_id,
      season: row.season,
      week: row.week,
      team: row.team,
      playerId: row.player_id,
      playerName: row.player_name,
      passAttempts: row.pass_attempts,
      passCompletions: row.pass_completions,
      passYards: row.pass_yards,
      passTds: row.pass_tds,
      interceptions: row.interceptions,
    }));
  }

  /**
   * Validate pre-kickoff QB status against actual starter
   * Returns accuracy metrics
   */
  async validateQBPredictions(season: number, week?: number): Promise<{
    total: number;
    correct: number;
    wrong: number;
    noPrediction: number;
    accuracy: number;
    details: Array<{
      team: string;
      week: number;
      predictedQB: string | null;
      predictedStatus: string | null;
      actualQB: string;
      correct: boolean;
    }>;
  }> {
    let query = this.supabase
      .from('v_qb_status_vs_started')
      .select('*')
      .eq('season', season);

    if (week !== undefined) {
      query = query.eq('week', week);
    }

    const { data, error } = await query;

    if (error || !data) {
      return {
        total: 0,
        correct: 0,
        wrong: 0,
        noPrediction: 0,
        accuracy: 0,
        details: [],
      };
    }

    const details = data.map(row => ({
      team: row.team,
      week: row.week,
      predictedQB: row.pregame_qb,
      predictedStatus: row.pregame_status,
      actualQB: row.started_qb,
      correct: row.accuracy === 'correct_confirmed' ||
               row.accuracy === 'correct_questionable' ||
               row.accuracy === 'correct_out',
    }));

    const total = details.length;
    const noPrediction = details.filter(d => d.predictedQB === null).length;
    const withPrediction = details.filter(d => d.predictedQB !== null);
    const correct = withPrediction.filter(d => d.correct).length;
    const wrong = withPrediction.filter(d => !d.correct).length;

    return {
      total,
      correct,
      wrong,
      noPrediction,
      accuracy: withPrediction.length > 0 ? correct / withPrediction.length : 0,
      details,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { extractStartingQB };
