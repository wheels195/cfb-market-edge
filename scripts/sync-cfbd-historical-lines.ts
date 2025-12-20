/**
 * Sync CFBD historical betting lines to odds_ticks table
 *
 * CFBD provides:
 * - spread (closing) and spreadOpen (opening)
 * - overUnder (closing) and overUnderOpen (opening)
 * - homeMoneyline and awayMoneyline (NOT spread prices)
 *
 * We store:
 * - Opening lines as tick_type='open'
 * - Closing lines as tick_type='close'
 * - price_american = -110 (fallback, since CFBD doesn't have spread prices)
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';
import * as crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

// DraftKings sportsbook ID (we'll look this up)
let dkSportsbookId: string | null = null;

async function getSportsbookId(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('sportsbooks')
    .select('id')
    .eq('key', key)
    .single();
  return data?.id || null;
}

async function getEventByCfbdId(cfbdGameId: number): Promise<{ id: string; week: number } | null> {
  const { data } = await supabase
    .from('events')
    .select('id, week')
    .eq('cfbd_game_id', cfbdGameId)
    .single();
  return data as { id: string; week: number } | null;
}

function hashPayload(data: Record<string, unknown>): string {
  const str = JSON.stringify(data);
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 8);
}

function americanToDecimal(american: number): number {
  if (american > 0) {
    return (american / 100) + 1;
  } else {
    return (100 / Math.abs(american)) + 1;
  }
}

async function syncSeasonLines(season: number) {
  console.log(`\nSyncing ${season} season lines...`);

  let totalOpen = 0;
  let totalClose = 0;
  let skipped = 0;
  let noEvent = 0;

  // Regular season weeks 1-15 plus postseason
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  for (const week of weeks) {
    try {
      const lines = await cfbd.getBettingLines(season, week, 'regular');

      for (const game of lines) {
        // Skip non-FBS games
        if (game.homeClassification !== 'fbs' && game.awayClassification !== 'fbs') {
          continue;
        }

        // Find DraftKings line
        const dkLine = game.lines?.find(l => l.provider === 'DraftKings');
        if (!dkLine) {
          skipped++;
          continue;
        }

        // Get event from our database
        const event = await getEventByCfbdId(game.id);
        if (!event) {
          noEvent++;
          continue;
        }

        const records: Array<{
          event_id: string;
          sportsbook_id: string;
          market_type: string;
          captured_at: string;
          side: string;
          spread_points_home: number | null;
          total_points: number | null;
          price_american: number;
          price_decimal: number;
          payload_hash: string;
          tick_type: string;
        }> = [];

        // Opening spread (if available)
        if (dkLine.spreadOpen !== null && dkLine.spreadOpen !== undefined) {
          const spreadOpen = dkLine.spreadOpen;

          // Home side
          records.push({
            event_id: event.id,
            sportsbook_id: dkSportsbookId!,
            market_type: 'spread',
            captured_at: new Date(game.startDate).toISOString(),
            side: 'home',
            spread_points_home: spreadOpen,
            total_points: null,
            price_american: -110, // Fallback
            price_decimal: americanToDecimal(-110),
            payload_hash: hashPayload({ type: 'open', spread: spreadOpen, side: 'home', game: game.id }),
            tick_type: 'open',
          });

          // Away side
          records.push({
            event_id: event.id,
            sportsbook_id: dkSportsbookId!,
            market_type: 'spread',
            captured_at: new Date(game.startDate).toISOString(),
            side: 'away',
            spread_points_home: spreadOpen,
            total_points: null,
            price_american: -110, // Fallback
            price_decimal: americanToDecimal(-110),
            payload_hash: hashPayload({ type: 'open', spread: spreadOpen, side: 'away', game: game.id }),
            tick_type: 'open',
          });

          totalOpen += 2;
        }

        // Closing spread
        if (dkLine.spread !== null && dkLine.spread !== undefined) {
          const spreadClose = dkLine.spread;

          // Home side
          records.push({
            event_id: event.id,
            sportsbook_id: dkSportsbookId!,
            market_type: 'spread',
            captured_at: new Date(game.startDate).toISOString(),
            side: 'home',
            spread_points_home: spreadClose,
            total_points: null,
            price_american: -110, // Fallback
            price_decimal: americanToDecimal(-110),
            payload_hash: hashPayload({ type: 'close', spread: spreadClose, side: 'home', game: game.id }),
            tick_type: 'close',
          });

          // Away side
          records.push({
            event_id: event.id,
            sportsbook_id: dkSportsbookId!,
            market_type: 'spread',
            captured_at: new Date(game.startDate).toISOString(),
            side: 'away',
            spread_points_home: spreadClose,
            total_points: null,
            price_american: -110, // Fallback
            price_decimal: americanToDecimal(-110),
            payload_hash: hashPayload({ type: 'close', spread: spreadClose, side: 'away', game: game.id }),
            tick_type: 'close',
          });

          totalClose += 2;
        }

        // Insert records
        if (records.length > 0) {
          const { error } = await supabase
            .from('odds_ticks')
            .upsert(records, { onConflict: 'payload_hash' });

          if (error) {
            console.error(`  Error inserting: ${error.message}`);
          }
        }
      }

      console.log(`  Week ${week}: processed`);
    } catch (err) {
      console.error(`  Week ${week}: ${err}`);
    }
  }

  // Also try postseason
  try {
    const postLines = await cfbd.getBettingLines(season, undefined, 'postseason');
    console.log(`  Postseason: ${postLines.length} games found`);

    for (const game of postLines) {
      const dkLine = game.lines?.find(l => l.provider === 'DraftKings');
      if (!dkLine) continue;

      const event = await getEventByCfbdId(game.id);
      if (!event) {
        noEvent++;
        continue;
      }

      // Same logic for opening/closing spreads...
      const records: Array<{
        event_id: string;
        sportsbook_id: string;
        market_type: string;
        captured_at: string;
        side: string;
        spread_points_home: number | null;
        total_points: number | null;
        price_american: number;
        price_decimal: number;
        payload_hash: string;
        tick_type: string;
      }> = [];

      if (dkLine.spreadOpen !== null && dkLine.spreadOpen !== undefined) {
        records.push({
          event_id: event.id,
          sportsbook_id: dkSportsbookId!,
          market_type: 'spread',
          captured_at: new Date(game.startDate).toISOString(),
          side: 'home',
          spread_points_home: dkLine.spreadOpen,
          total_points: null,
          price_american: -110,
          price_decimal: americanToDecimal(-110),
          payload_hash: hashPayload({ type: 'open', spread: dkLine.spreadOpen, side: 'home', game: game.id }),
          tick_type: 'open',
        });
        records.push({
          event_id: event.id,
          sportsbook_id: dkSportsbookId!,
          market_type: 'spread',
          captured_at: new Date(game.startDate).toISOString(),
          side: 'away',
          spread_points_home: dkLine.spreadOpen,
          total_points: null,
          price_american: -110,
          price_decimal: americanToDecimal(-110),
          payload_hash: hashPayload({ type: 'open', spread: dkLine.spreadOpen, side: 'away', game: game.id }),
          tick_type: 'open',
        });
        totalOpen += 2;
      }

      if (dkLine.spread !== null && dkLine.spread !== undefined) {
        records.push({
          event_id: event.id,
          sportsbook_id: dkSportsbookId!,
          market_type: 'spread',
          captured_at: new Date(game.startDate).toISOString(),
          side: 'home',
          spread_points_home: dkLine.spread,
          total_points: null,
          price_american: -110,
          price_decimal: americanToDecimal(-110),
          payload_hash: hashPayload({ type: 'close', spread: dkLine.spread, side: 'home', game: game.id }),
          tick_type: 'close',
        });
        records.push({
          event_id: event.id,
          sportsbook_id: dkSportsbookId!,
          market_type: 'spread',
          captured_at: new Date(game.startDate).toISOString(),
          side: 'away',
          spread_points_home: dkLine.spread,
          total_points: null,
          price_american: -110,
          price_decimal: americanToDecimal(-110),
          payload_hash: hashPayload({ type: 'close', spread: dkLine.spread, side: 'away', game: game.id }),
          tick_type: 'close',
        });
        totalClose += 2;
      }

      if (records.length > 0) {
        await supabase.from('odds_ticks').upsert(records, { onConflict: 'payload_hash' });
      }
    }
  } catch {
    console.log(`  Postseason: no data`);
  }

  console.log(`  Season ${season}: ${totalOpen} opening ticks, ${totalClose} closing ticks`);
  console.log(`  Skipped (no DK): ${skipped}, No event match: ${noEvent}`);
}

async function main() {
  console.log('=== Syncing CFBD Historical Lines ===\n');

  // Get DraftKings sportsbook ID
  dkSportsbookId = await getSportsbookId('draftkings');
  if (!dkSportsbookId) {
    console.error('DraftKings sportsbook not found in database');
    return;
  }
  console.log('DraftKings sportsbook ID:', dkSportsbookId);

  // Sync 2022-2024 seasons
  for (const season of [2022, 2023, 2024]) {
    await syncSeasonLines(season);
  }

  // Summary
  const { count: totalTicks } = await supabase
    .from('odds_ticks')
    .select('*', { count: 'exact', head: true });

  const { data: tickTypeCounts } = await supabase
    .from('odds_ticks')
    .select('tick_type');

  const typeCounts: Record<string, number> = {};
  for (const t of tickTypeCounts || []) {
    const type = t.tick_type || 'null';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  console.log('\n=== Sync Complete ===');
  console.log('Total odds_ticks:', totalTicks);
  console.log('By tick_type:', typeCounts);
}

main().catch(console.error);
