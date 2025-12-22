/**
 * Optimized CFB T-60 Sync from Historical Odds API
 *
 * Optimization: Group games by T-60 timestamp (rounded to 30 min),
 * then query once per timestamp and match all games in that batch.
 *
 * This reduces API calls from ~5000 (one per game) to ~600-800 (one per time slot).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'e035a3d861365e045027dc00c240c941';
const SPORT = 'americanfootball_ncaaf';

interface HistoricalOddsGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

interface GameForSync {
  cfbd_game_id: number;
  home_team: string;
  away_team: string;
  start_date: string;
  t60_timestamp: string;
  spread_close: number | null;
}

// Round timestamp to nearest 30 minutes and format for API
function roundToHalfHour(date: Date): string {
  const ms = 30 * 60 * 1000;
  const rounded = new Date(Math.round(date.getTime() / ms) * ms);
  // Format as YYYY-MM-DDTHH:MM:SSZ (no milliseconds)
  return rounded.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Check if teams match (fuzzy)
function teamsMatch(cfbdHome: string, cfbdAway: string, oddsHome: string, oddsAway: string): boolean {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/\s*(university|college|state|tech|a&m|ole miss)\s*/gi, ' ')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)[0]; // First word

  const cfbdHomeNorm = normalize(cfbdHome);
  const cfbdAwayNorm = normalize(cfbdAway);
  const oddsHomeNorm = normalize(oddsHome);
  const oddsAwayNorm = normalize(oddsAway);

  // Check if first word matches
  return (oddsHomeNorm.includes(cfbdHomeNorm) || cfbdHomeNorm.includes(oddsHomeNorm)) &&
         (oddsAwayNorm.includes(cfbdAwayNorm) || cfbdAwayNorm.includes(oddsAwayNorm));
}

// Extract DK spread for home team
function getDKSpread(game: HistoricalOddsGame, homeTeam: string): number | null {
  const dk = game.bookmakers.find(b => b.key === 'draftkings');
  if (!dk) return null;

  const spreads = dk.markets.find(m => m.key === 'spreads');
  if (!spreads) return null;

  // Find home team outcome
  const homeNorm = homeTeam.toLowerCase().split(/\s+/)[0];
  for (const outcome of spreads.outcomes) {
    const outNorm = outcome.name.toLowerCase().split(/\s+/)[0];
    if (outNorm.includes(homeNorm) || homeNorm.includes(outNorm)) {
      return outcome.point ?? null;
    }
  }

  // Fallback: first outcome with negative spread might be favorite
  return null;
}

async function fetchHistoricalOdds(date: string): Promise<HistoricalOddsGame[]> {
  const url = `https://api.the-odds-api.com/v4/historical/sports/${SPORT}/odds?` +
    `apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american&date=${date}`;

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Odds API error ${response.status}: ${text.substring(0, 200)}`);
  }

  const json = await response.json();
  return json.data || [];
}

async function getGamesForSync(): Promise<GameForSync[]> {
  // Load start dates
  const startDatesFile = '/home/wheel/cfb-market-edge/data/game-start-dates.json';
  const startDates: Record<string, string> = JSON.parse(fs.readFileSync(startDatesFile, 'utf-8'));

  // Get games from database
  const games: GameForSync[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('cfbd_betting_lines')
      .select('cfbd_game_id, home_team, away_team, spread_close, season')
      .not('home_score', 'is', null)
      .not('spread_close', 'is', null)
      .in('season', [2022, 2023, 2024])
      .range(offset, offset + pageSize - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      const startDate = startDates[row.cfbd_game_id.toString()];
      if (startDate) {
        const kickoff = new Date(startDate);
        const t60 = new Date(kickoff.getTime() - 60 * 60 * 1000);
        const t60Rounded = roundToHalfHour(t60);

        games.push({
          cfbd_game_id: row.cfbd_game_id,
          home_team: row.home_team,
          away_team: row.away_team,
          start_date: startDate,
          t60_timestamp: t60Rounded,
          spread_close: row.spread_close,
        });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return games;
}

async function main() {
  console.log('========================================');
  console.log('  CFB T-60 Odds Sync (Optimized)');
  console.log('========================================\n');

  const games = await getGamesForSync();
  console.log(`Total games to sync: ${games.length}`);

  // Group games by T-60 timestamp
  const gamesByTimestamp = new Map<string, GameForSync[]>();
  for (const game of games) {
    if (!gamesByTimestamp.has(game.t60_timestamp)) {
      gamesByTimestamp.set(game.t60_timestamp, []);
    }
    gamesByTimestamp.get(game.t60_timestamp)!.push(game);
  }

  console.log(`Unique T-60 timestamps: ${gamesByTimestamp.size}`);
  console.log(`Estimated API calls: ${gamesByTimestamp.size}`);
  console.log(`Estimated credits: ${gamesByTimestamp.size * 10}\n`);

  // Results storage
  const results: Array<{
    cfbd_game_id: number;
    spread_t60: number | null;
    spread_close: number | null;
    matched: boolean;
  }> = [];

  let apiCalls = 0;
  let matched = 0;
  const sortedTimestamps = Array.from(gamesByTimestamp.keys()).sort();

  for (const timestamp of sortedTimestamps) {
    const gamesAtTime = gamesByTimestamp.get(timestamp)!;

    try {
      const oddsData = await fetchHistoricalOdds(timestamp);
      apiCalls++;

      // Match each game
      for (const game of gamesAtTime) {
        let spreadT60: number | null = null;
        let foundMatch = false;

        for (const oddsGame of oddsData) {
          if (teamsMatch(game.home_team, game.away_team, oddsGame.home_team, oddsGame.away_team)) {
            spreadT60 = getDKSpread(oddsGame, game.home_team);
            if (spreadT60 !== null) {
              foundMatch = true;
              matched++;
            }
            break;
          }
        }

        results.push({
          cfbd_game_id: game.cfbd_game_id,
          spread_t60: spreadT60,
          spread_close: game.spread_close,
          matched: foundMatch,
        });
      }

      // Progress every 50 calls
      if (apiCalls % 50 === 0) {
        console.log(`Progress: ${apiCalls}/${gamesByTimestamp.size} timestamps, ${matched}/${results.length} matched`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200)); // 5 req/sec

    } catch (err) {
      console.error(`Error at ${timestamp}:`, err);
      for (const game of gamesAtTime) {
        results.push({
          cfbd_game_id: game.cfbd_game_id,
          spread_t60: null,
          spread_close: game.spread_close,
          matched: false,
        });
      }
    }
  }

  console.log(`\n=== Sync Complete ===`);
  console.log(`API calls: ${apiCalls}`);
  console.log(`Games processed: ${results.length}`);
  console.log(`Games matched: ${matched} (${(matched / results.length * 100).toFixed(1)}%)`);

  // Save results
  const resultsFile = '/home/wheel/cfb-market-edge/data/t60-spreads.json';
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${resultsFile}`);

  // Summary by season
  const byCloseDiff: Record<string, { count: number; avgDiff: number }> = {};
  for (const r of results.filter(r => r.matched && r.spread_t60 !== null && r.spread_close !== null)) {
    const diff = Math.abs(r.spread_t60! - r.spread_close!);
    const bucket = diff < 0.5 ? '0-0.5' : diff < 1 ? '0.5-1' : diff < 2 ? '1-2' : '2+';
    if (!byCloseDiff[bucket]) byCloseDiff[bucket] = { count: 0, avgDiff: 0 };
    byCloseDiff[bucket].count++;
  }

  console.log('\nT-60 vs Close spread difference:');
  for (const [bucket, stats] of Object.entries(byCloseDiff).sort()) {
    console.log(`  ${bucket} pts: ${stats.count} games`);
  }
}

main().catch(console.error);
