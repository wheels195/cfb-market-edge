/**
 * CBB Sync Odds Job
 *
 * Polls The Odds API for CBB spreads and stores them
 */

import { supabase } from '@/lib/db/client';
import { getCbbOddsApiClient } from '../odds-api';
import { OddsApiEvent } from '@/types/odds-api';

export interface CbbSyncOddsResult {
  eventsPolled: number;
  ticksWritten: number;
  errors: string[];
}

/**
 * Generate a hash for deduplication
 */
function generateHash(
  eventId: string,
  sportsbook: string,
  spread: number | null,
  total: number | null
): string {
  const payload = `${eventId}|${sportsbook}|${spread}|${total}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Sync CBB odds from The Odds API
 */
export async function syncCbbOdds(): Promise<CbbSyncOddsResult> {
  const result: CbbSyncOddsResult = {
    eventsPolled: 0,
    ticksWritten: 0,
    errors: [],
  };

  try {
    const client = getCbbOddsApiClient();
    const oddsData = await client.getOdds();

    console.log(`Fetched ${oddsData.length} CBB events from Odds API`);

    for (const event of oddsData) {
      try {
        // Parse DraftKings odds (primary)
        const odds = client.parseOdds(event, 'draftkings');

        if (odds.spread === null) {
          // Try fallback to FanDuel
          const fdOdds = client.parseOdds(event, 'fanduel');
          if (fdOdds.spread !== null) {
            odds.spread = fdOdds.spread;
            odds.total = fdOdds.total;
          }
        }

        if (odds.spread === null) continue;

        const payloadHash = generateHash(event.id, 'draftkings', odds.spread, odds.total);

        // Insert tick (dedupe on payload_hash)
        const { error } = await supabase
          .from('cbb_odds_ticks')
          .upsert({
            event_id: event.id,
            home_team: odds.homeTeam,
            away_team: odds.awayTeam,
            commence_time: event.commence_time,
            sportsbook: 'draftkings',
            spread_home: odds.spread,
            total: odds.total,
            captured_at: new Date().toISOString(),
            payload_hash: payloadHash,
          }, {
            onConflict: 'event_id,sportsbook,payload_hash',
          });

        if (error && !error.message.includes('duplicate')) {
          result.errors.push(`Event ${event.id}: ${error.message}`);
        } else {
          result.ticksWritten++;
        }

        result.eventsPolled++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Event ${event.id}: ${message}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`API error: ${message}`);
  }

  return result;
}
