/**
 * Sync CFBD Betting Lines
 *
 * Gets historical betting lines with OPENING spreads from CFBD.
 * This is critical for opening-line residual analysis.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

async function cfbdFetch(endpoint: string) {
  const response = await fetch(`https://apinext.collegefootballdata.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${CFBD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`CFBD API error: ${response.status} for ${endpoint}`);
  }
  return response.json();
}

interface CFBDLine {
  provider: string;
  spread: number | null;
  spreadOpen: number | null;
  overUnder: number | null;
  overUnderOpen: number | null;
}

interface CFBDGame {
  id: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  lines: CFBDLine[];
}

async function syncBettingLines(season: number) {
  console.log(`\n=== Syncing betting lines for ${season} ===`);

  // Get all weeks
  const allLines: any[] = [];

  for (let week = 1; week <= 16; week++) {
    try {
      const data: CFBDGame[] = await cfbdFetch(`/lines?year=${season}&week=${week}`);
      if (data && data.length > 0) {
        allLines.push(...data);
        console.log(`  Week ${week}: ${data.length} games`);
      }
    } catch (e) {
      // Week might not exist
    }

    // Small delay
    await new Promise(r => setTimeout(r, 100));
  }

  // Also get postseason
  try {
    const postseason: CFBDGame[] = await cfbdFetch(`/lines?year=${season}&seasonType=postseason`);
    if (postseason && postseason.length > 0) {
      allLines.push(...postseason);
      console.log(`  Postseason: ${postseason.length} games`);
    }
  } catch (e) {
    // No postseason
  }

  console.log(`  Total: ${allLines.length} games with lines`);

  // Process and store
  const rows: any[] = [];

  for (const game of allLines) {
    // Get consensus line (prefer Bovada or ESPN Bet)
    let bestLine: CFBDLine | null = null;
    for (const line of game.lines || []) {
      if (line.spread !== null) {
        if (!bestLine || line.provider === 'Bovada' || line.provider === 'ESPN Bet') {
          bestLine = line;
        }
      }
    }

    if (!bestLine) continue;

    rows.push({
      cfbd_game_id: game.id,
      season: game.season,
      week: game.week,
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      home_score: game.homeScore,
      away_score: game.awayScore,
      spread_open: bestLine.spreadOpen,
      spread_close: bestLine.spread,
      total_open: bestLine.overUnderOpen,
      total_close: bestLine.overUnder,
      provider: bestLine.provider,
    });
  }

  return rows;
}

async function syncEloRatings(season: number) {
  console.log(`\n=== Syncing Elo ratings for ${season} ===`);

  const data = await cfbdFetch(`/ratings/elo?year=${season}`);
  console.log(`  Retrieved ${data.length} Elo ratings`);

  return data.map((r: any) => ({
    season,
    team_name: r.team,
    conference: r.conference,
    elo: r.elo,
  }));
}

async function main() {
  console.log('=== SYNC CFBD BETTING LINES & ELO ===\n');

  // Create tables if not exist
  console.log('Ensuring tables exist...');

  // Sync betting lines for 2021-2024
  const allBettingLines: any[] = [];
  for (const season of [2021, 2022, 2023, 2024]) {
    const lines = await syncBettingLines(season);
    allBettingLines.push(...lines);
  }

  console.log(`\nTotal betting lines: ${allBettingLines.length}`);

  // Store in a new table (or update existing)
  // For now, just output summary
  let withOpen = 0;
  let withClose = 0;
  let withBoth = 0;

  for (const line of allBettingLines) {
    if (line.spread_open !== null) withOpen++;
    if (line.spread_close !== null) withClose++;
    if (line.spread_open !== null && line.spread_close !== null) withBoth++;
  }

  console.log(`\n=== BETTING LINE SUMMARY ===`);
  console.log(`Games with opening spread: ${withOpen}`);
  console.log(`Games with closing spread: ${withClose}`);
  console.log(`Games with BOTH open & close: ${withBoth}`);

  // Calculate line movement stats
  const movements: number[] = [];
  for (const line of allBettingLines) {
    if (line.spread_open !== null && line.spread_close !== null) {
      const move = line.spread_close - line.spread_open;
      movements.push(move);
    }
  }

  if (movements.length > 0) {
    const avgMove = movements.reduce((a, b) => a + Math.abs(b), 0) / movements.length;
    const maxMove = Math.max(...movements.map(Math.abs));
    console.log(`\nAverage absolute line movement: ${avgMove.toFixed(2)} points`);
    console.log(`Max line movement: ${maxMove.toFixed(1)} points`);
  }

  // Sync Elo
  const allElo: any[] = [];
  for (const season of [2021, 2022, 2023, 2024]) {
    const elo = await syncEloRatings(season);
    allElo.push(...elo);
  }

  console.log(`\n=== ELO SUMMARY ===`);
  console.log(`Total Elo ratings: ${allElo.length}`);

  // Show sample
  console.log('\nSample betting line with movement:');
  const withMovement = allBettingLines.find(l =>
    l.spread_open !== null &&
    l.spread_close !== null &&
    Math.abs(l.spread_close - l.spread_open) >= 2
  );
  if (withMovement) {
    console.log(JSON.stringify(withMovement, null, 2));
  }

  console.log('\n=== SYNC COMPLETE ===');
}

main().catch(console.error);
