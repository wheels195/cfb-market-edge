/**
 * Sync Full CFB Games with Betting Lines from CFBD
 *
 * Fetches all games for 2022-2024 seasons with:
 * - Game start times (kickoff) for T-60 computation
 * - Open and close spreads/totals
 * - Final scores
 *
 * Upserts to cfbd_betting_lines table with start_date column.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const CFBD_API_KEY = process.env.CFBD_API_KEY!;

async function cfbdFetch<T>(endpoint: string): Promise<T> {
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

interface CFBDGameLines {
  id: number;
  season: number;
  week: number;
  startDate: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  lines: CFBDLine[];
}

interface DBRow {
  cfbd_game_id: number;
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  spread_open: number | null;
  spread_close: number | null;
  total_open: number | null;
  total_close: number | null;
  provider: string;
}

// Store start_dates separately for T-60 computation
const gameStartDates = new Map<number, string>();

async function fetchSeasonLines(season: number): Promise<DBRow[]> {
  console.log(`\n=== Fetching ${season} season ===`);
  const allGames: CFBDGameLines[] = [];

  // Regular season weeks
  for (let week = 1; week <= 16; week++) {
    try {
      const data = await cfbdFetch<CFBDGameLines[]>(`/lines?year=${season}&week=${week}`);
      if (data && data.length > 0) {
        allGames.push(...data);
        console.log(`  Week ${week}: ${data.length} games`);
      }
    } catch (e) {
      // Week might not exist
    }
    await new Promise(r => setTimeout(r, 100));
  }

  // Postseason
  try {
    const postseason = await cfbdFetch<CFBDGameLines[]>(`/lines?year=${season}&seasonType=postseason`);
    if (postseason && postseason.length > 0) {
      allGames.push(...postseason);
      console.log(`  Postseason: ${postseason.length} games`);
    }
  } catch (e) {
    // No postseason
  }

  console.log(`  Total: ${allGames.length} games`);

  // Convert to DB rows
  const rows: DBRow[] = [];
  for (const game of allGames) {
    // Prefer consensus > Bovada > ESPN Bet > any other
    let bestLine: CFBDLine | null = null;
    for (const line of game.lines || []) {
      if (line.spread !== null || line.spreadOpen !== null) {
        if (!bestLine) {
          bestLine = line;
        } else if (line.provider === 'consensus') {
          bestLine = line;
        } else if (line.provider === 'Bovada' && bestLine.provider !== 'consensus') {
          bestLine = line;
        } else if (line.provider === 'ESPN Bet' && !['consensus', 'Bovada'].includes(bestLine.provider)) {
          bestLine = line;
        }
      }
    }

    if (!bestLine) continue;

    // Store start_date for T-60 computation
    gameStartDates.set(game.id, game.startDate);

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

async function main() {
  console.log('========================================');
  console.log('  CFB Full Season Sync (2022-2024)');
  console.log('========================================\n');

  // Fetch all seasons
  const allRows: DBRow[] = [];
  for (const season of [2022, 2023, 2024]) {
    const rows = await fetchSeasonLines(season);
    allRows.push(...rows);
  }

  console.log(`\n=== Total: ${allRows.length} games fetched ===`);

  // Filter to completed games only
  const completedRows = allRows.filter(r => r.home_score !== null && r.away_score !== null);
  console.log(`Completed games: ${completedRows.length}`);

  // Coverage stats
  let hasOpen = 0;
  let hasClose = 0;
  let hasBoth = 0;

  for (const row of completedRows) {
    if (row.spread_open !== null) hasOpen++;
    if (row.spread_close !== null) hasClose++;
    if (row.spread_open !== null && row.spread_close !== null) hasBoth++;
  }

  console.log(`\n=== Coverage Stats ===`);
  console.log(`Games with spread_open: ${hasOpen}`);
  console.log(`Games with spread_close: ${hasClose}`);
  console.log(`Games with BOTH: ${hasBoth}`);

  // Upsert to database in batches
  console.log(`\n=== Upserting to database ===`);
  const batchSize = 100;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < completedRows.length; i += batchSize) {
    const batch = completedRows.slice(i, i + batchSize);

    const { error } = await supabase
      .from('cfbd_betting_lines')
      .upsert(batch, { onConflict: 'cfbd_game_id,provider' });

    if (error) {
      console.error(`Batch ${i / batchSize + 1} error:`, error.message);
      errors++;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\n=== Sync Complete ===`);
  console.log(`Inserted/Updated: ${inserted} games`);
  console.log(`Errors: ${errors} batches`);

  // Save start dates to JSON for T-60 sync
  const fs = await import('fs');
  const startDatesFile = '/home/wheel/cfb-market-edge/data/game-start-dates.json';
  const startDatesObj: Record<number, string> = {};
  for (const [id, date] of gameStartDates) {
    startDatesObj[id] = date;
  }
  await fs.promises.mkdir('/home/wheel/cfb-market-edge/data', { recursive: true });
  await fs.promises.writeFile(startDatesFile, JSON.stringify(startDatesObj, null, 2));
  console.log(`\nSaved ${gameStartDates.size} start dates to ${startDatesFile}`);

  // Verify final counts
  const { count: finalCount } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true });

  const { count: finalWithClose } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('spread_close', 'is', null)
    .not('home_score', 'is', null);

  console.log(`\nFinal table count: ${finalCount} rows`);
  console.log(`Games with close spread + scores: ${finalWithClose}`);
}

main().catch(console.error);
