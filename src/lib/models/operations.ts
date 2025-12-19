/**
 * Operational Hardening
 *
 * Before live use:
 *   - Odds ingestion health checks
 *   - Missing line detection
 *   - Duplicate tick protection
 *   - Book outage handling
 *   - Leakage assertion stays ON
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface HealthStatus {
  healthy: boolean;
  component: string;
  message: string;
  lastCheck: Date;
  details?: Record<string, unknown>;
}

export interface OddsTickHash {
  eventId: string;
  book: string;
  market: string;
  side: string;
  points: number;
  price: number;
  timestamp: Date;
}

export interface DataIntegrityReport {
  totalGames: number;
  gamesWithOdds: number;
  gamesMissingOdds: string[];
  duplicateTicks: number;
  staleOdds: string[];  // Games where odds haven't updated in expected time
  bookOutages: string[];
}

// =============================================================================
// LEAKAGE ASSERTION (ALWAYS ON)
// =============================================================================

/**
 * Asserts that we're not using future data in predictions
 * This MUST stay enabled in production
 */
export function assertNoLeakage(
  predictionTime: Date,
  dataTimestamp: Date,
  context: string
): void {
  if (dataTimestamp > predictionTime) {
    throw new Error(
      `LEAKAGE DETECTED: ${context} - Data timestamp ${dataTimestamp.toISOString()} ` +
      `is after prediction time ${predictionTime.toISOString()}`
    );
  }
}

/**
 * Validate that ratings used for prediction are from BEFORE the game
 */
export function assertPriorRatings(
  gameWeek: number,
  ratingWeek: number,
  team: string
): void {
  if (ratingWeek >= gameWeek) {
    throw new Error(
      `LEAKAGE DETECTED: Using week ${ratingWeek} rating for week ${gameWeek} game (${team})`
    );
  }
}

/**
 * Validate spread snapshot is from before kickoff
 */
export function assertPreKickoffSpread(
  spreadTimestamp: Date,
  kickoffTime: Date,
  gameKey: string
): void {
  if (spreadTimestamp > kickoffTime) {
    throw new Error(
      `LEAKAGE DETECTED: Spread timestamp ${spreadTimestamp.toISOString()} ` +
      `is after kickoff ${kickoffTime.toISOString()} for ${gameKey}`
    );
  }
}

// =============================================================================
// OPERATIONS STORE
// =============================================================================

export class OperationsStore {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ===========================================================================
  // HEALTH CHECKS
  // ===========================================================================

  async checkDatabaseHealth(): Promise<HealthStatus> {
    try {
      const { data, error } = await this.supabase
        .from('cfbd_betting_lines')
        .select('id')
        .limit(1);

      if (error) {
        return {
          healthy: false,
          component: 'database',
          message: `Database error: ${error.message}`,
          lastCheck: new Date(),
        };
      }

      return {
        healthy: true,
        component: 'database',
        message: 'Database connection OK',
        lastCheck: new Date(),
      };
    } catch (e) {
      return {
        healthy: false,
        component: 'database',
        message: `Database exception: ${e}`,
        lastCheck: new Date(),
      };
    }
  }

  async checkOddsIngestion(maxAgeMinutes: number = 30): Promise<HealthStatus> {
    try {
      const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

      const { data, error } = await this.supabase
        .from('odds_ticks')
        .select('captured_at')
        .gt('captured_at', cutoff.toISOString())
        .order('captured_at', { ascending: false })
        .limit(1);

      if (error) {
        return {
          healthy: false,
          component: 'odds_ingestion',
          message: `Odds query error: ${error.message}`,
          lastCheck: new Date(),
        };
      }

      if (!data || data.length === 0) {
        return {
          healthy: false,
          component: 'odds_ingestion',
          message: `No odds updates in last ${maxAgeMinutes} minutes`,
          lastCheck: new Date(),
        };
      }

      return {
        healthy: true,
        component: 'odds_ingestion',
        message: `Latest odds: ${data[0].captured_at}`,
        lastCheck: new Date(),
        details: { lastUpdate: data[0].captured_at },
      };
    } catch (e) {
      return {
        healthy: false,
        component: 'odds_ingestion',
        message: `Odds check exception: ${e}`,
        lastCheck: new Date(),
      };
    }
  }

  async checkBookAvailability(books: string[] = ['draftkings', 'fanduel']): Promise<HealthStatus[]> {
    const results: HealthStatus[] = [];
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);  // 1 hour

    for (const book of books) {
      try {
        const { data, error } = await this.supabase
          .from('odds_ticks')
          .select('captured_at')
          .eq('sportsbook', book)
          .gt('captured_at', cutoff.toISOString())
          .limit(1);

        if (error || !data || data.length === 0) {
          results.push({
            healthy: false,
            component: `book_${book}`,
            message: `${book}: No updates in last hour`,
            lastCheck: new Date(),
          });
        } else {
          results.push({
            healthy: true,
            component: `book_${book}`,
            message: `${book}: Active`,
            lastCheck: new Date(),
          });
        }
      } catch (e) {
        results.push({
          healthy: false,
          component: `book_${book}`,
          message: `${book}: Exception - ${e}`,
          lastCheck: new Date(),
        });
      }
    }

    return results;
  }

  // ===========================================================================
  // MISSING LINE DETECTION
  // ===========================================================================

  async detectMissingLines(
    season: number,
    week: number,
    requiredBooks: string[] = ['draftkings', 'fanduel']
  ): Promise<DataIntegrityReport> {
    // Get all games for this week
    const { data: games, error: gamesError } = await this.supabase
      .from('cfbd_betting_lines')
      .select('cfbd_game_id, home_team, away_team')
      .eq('season', season)
      .eq('week', week);

    if (gamesError || !games) {
      throw new Error(`Failed to fetch games: ${gamesError?.message}`);
    }

    // Get latest odds per game per book
    const { data: odds, error: oddsError } = await this.supabase
      .from('odds_ticks')
      .select('event_id, sportsbook')
      .eq('season', season)
      .eq('week', week);

    if (oddsError) {
      throw new Error(`Failed to fetch odds: ${oddsError.message}`);
    }

    const oddsByGame = new Map<string, Set<string>>();
    for (const tick of odds || []) {
      if (!oddsByGame.has(tick.event_id)) {
        oddsByGame.set(tick.event_id, new Set());
      }
      oddsByGame.get(tick.event_id)!.add(tick.sportsbook);
    }

    const gamesMissingOdds: string[] = [];
    let gamesWithOdds = 0;

    for (const game of games) {
      const gameKey = `${game.away_team}@${game.home_team}`;
      const books = oddsByGame.get(game.cfbd_game_id.toString());

      if (!books) {
        gamesMissingOdds.push(`${gameKey}: No odds from any book`);
      } else {
        const missing = requiredBooks.filter(b => !books.has(b));
        if (missing.length > 0) {
          gamesMissingOdds.push(`${gameKey}: Missing ${missing.join(', ')}`);
        } else {
          gamesWithOdds++;
        }
      }
    }

    return {
      totalGames: games.length,
      gamesWithOdds,
      gamesMissingOdds,
      duplicateTicks: 0,  // Calculated separately
      staleOdds: [],
      bookOutages: [],
    };
  }

  // ===========================================================================
  // DUPLICATE TICK PROTECTION
  // ===========================================================================

  /**
   * Generate dedupe hash for odds tick
   */
  generateTickHash(tick: OddsTickHash): string {
    return `${tick.eventId}-${tick.book}-${tick.market}-${tick.side}-${tick.points}-${tick.price}`;
  }

  /**
   * Check if tick already exists
   */
  async isDuplicateTick(tick: OddsTickHash): Promise<boolean> {
    const hash = this.generateTickHash(tick);

    const { data, error } = await this.supabase
      .from('odds_ticks')
      .select('id')
      .eq('dedupe_hash', hash)
      .limit(1);

    if (error) {
      console.error('Error checking duplicate:', error);
      return false;  // Allow insert on error (fail open)
    }

    return data && data.length > 0;
  }

  /**
   * Insert tick with duplicate protection
   */
  async insertTickWithDeduplication(
    tick: OddsTickHash & { rawData?: unknown }
  ): Promise<{ inserted: boolean; reason?: string }> {
    const hash = this.generateTickHash(tick);

    // Try insert with conflict handling
    const { error } = await this.supabase.from('odds_ticks').insert({
      event_id: tick.eventId,
      sportsbook: tick.book,
      market_type: tick.market,
      side: tick.side,
      points: tick.points,
      price: tick.price,
      dedupe_hash: hash,
      captured_at: tick.timestamp,
      raw_data: tick.rawData,
    });

    if (error) {
      if (error.code === '23505') {  // Unique violation
        return { inserted: false, reason: 'duplicate' };
      }
      return { inserted: false, reason: error.message };
    }

    return { inserted: true };
  }

  // ===========================================================================
  // BOOK OUTAGE HANDLING
  // ===========================================================================

  async detectBookOutages(
    maxSilenceMinutes: number = 60
  ): Promise<{ book: string; lastSeen: Date; minutesSilent: number }[]> {
    const books = ['draftkings', 'fanduel'];
    const outages: { book: string; lastSeen: Date; minutesSilent: number }[] = [];
    const now = new Date();

    for (const book of books) {
      const { data } = await this.supabase
        .from('odds_ticks')
        .select('captured_at')
        .eq('sportsbook', book)
        .order('captured_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const lastSeen = new Date(data[0].captured_at);
        const minutesSilent = (now.getTime() - lastSeen.getTime()) / (60 * 1000);

        if (minutesSilent > maxSilenceMinutes) {
          outages.push({ book, lastSeen, minutesSilent });
        }
      } else {
        outages.push({
          book,
          lastSeen: new Date(0),
          minutesSilent: Infinity,
        });
      }
    }

    return outages;
  }

  // ===========================================================================
  // FULL HEALTH REPORT
  // ===========================================================================

  async generateHealthReport(): Promise<string> {
    let report = `\n=== OPERATIONAL HEALTH REPORT ===\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // Database health
    const dbHealth = await this.checkDatabaseHealth();
    report += `Database: ${dbHealth.healthy ? 'OK' : 'FAIL'} - ${dbHealth.message}\n`;

    // Odds ingestion
    const oddsHealth = await this.checkOddsIngestion();
    report += `Odds Ingestion: ${oddsHealth.healthy ? 'OK' : 'FAIL'} - ${oddsHealth.message}\n`;

    // Book availability
    const bookHealth = await this.checkBookAvailability();
    for (const bh of bookHealth) {
      report += `${bh.component}: ${bh.healthy ? 'OK' : 'FAIL'} - ${bh.message}\n`;
    }

    // Outages
    const outages = await this.detectBookOutages();
    if (outages.length > 0) {
      report += '\n--- OUTAGES ---\n';
      for (const outage of outages) {
        report += `${outage.book}: Silent for ${outage.minutesSilent.toFixed(0)} minutes\n`;
      }
    }

    // Overall status
    const allHealthy = dbHealth.healthy && oddsHealth.healthy && bookHealth.every(b => b.healthy);
    report += `\nOverall Status: ${allHealthy ? 'HEALTHY' : 'DEGRADED'}\n`;

    return report;
  }
}

// =============================================================================
// LEAKAGE TEST SUITE
// =============================================================================

export function runLeakageTests(): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Future data detection
  try {
    const prediction = new Date('2024-09-01T12:00:00Z');
    const futureData = new Date('2024-09-01T14:00:00Z');
    assertNoLeakage(prediction, futureData, 'Test 1');
    failures.push('Test 1: Should have thrown for future data');
  } catch (e) {
    // Expected
  }

  // Test 2: Prior ratings check
  try {
    assertPriorRatings(5, 5, 'TestTeam');
    failures.push('Test 2: Should have thrown for same-week rating');
  } catch (e) {
    // Expected
  }

  // Test 3: Valid prior rating
  try {
    assertPriorRatings(5, 4, 'TestTeam');
    // Should not throw
  } catch (e) {
    failures.push('Test 3: Should not have thrown for prior-week rating');
  }

  // Test 4: Pre-kickoff spread
  try {
    const spread = new Date('2024-09-01T14:00:00Z');
    const kickoff = new Date('2024-09-01T12:00:00Z');
    assertPreKickoffSpread(spread, kickoff, 'Test 4 Game');
    failures.push('Test 4: Should have thrown for post-kickoff spread');
  } catch (e) {
    // Expected
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

// =============================================================================
// DATABASE SCHEMA (for reference)
// =============================================================================

/*
-- Add dedupe_hash to odds_ticks if not exists
ALTER TABLE odds_ticks ADD COLUMN IF NOT EXISTS dedupe_hash VARCHAR(200);
CREATE UNIQUE INDEX IF NOT EXISTS idx_odds_ticks_dedupe ON odds_ticks(dedupe_hash);

-- Health check log
CREATE TABLE IF NOT EXISTS health_checks (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50) NOT NULL,
  healthy BOOLEAN NOT NULL,
  message TEXT,
  details JSONB,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outage log
CREATE TABLE IF NOT EXISTS book_outages (
  id SERIAL PRIMARY KEY,
  book VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  UNIQUE(book, started_at)
);
*/
