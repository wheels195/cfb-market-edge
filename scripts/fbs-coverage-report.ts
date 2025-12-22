/**
 * FBS Coverage Report
 *
 * Recompute T-60 coverage and bet counts filtered to FBS-only games.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { isFBSGame } from '../src/lib/fbs-teams';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface T60Entry {
  cfbd_game_id: number;
  spread_t60: number | null;
  matched: boolean;
}

async function fetchAllRows<T>(
  tableName: string,
  selectColumns: string,
  filters?: (query: any) => any
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from(tableName)
      .select(selectColumns)
      .range(offset, offset + pageSize - 1);

    if (filters) query = filters(query);
    const { data, error } = await query;

    if (error || !data || data.length === 0) break;
    allRows.push(...(data as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}

async function main() {
  console.log('=== FBS Coverage Report ===\n');

  // Load T-60 data
  const t60Data: T60Entry[] = JSON.parse(
    fs.readFileSync('/home/wheel/cfb-market-edge/data/t60-spreads.json', 'utf-8')
  );
  const t60Map = new Map(t60Data.map(t => [t.cfbd_game_id, t]));

  // Load all games with pagination
  const games = await fetchAllRows<{
    cfbd_game_id: number;
    season: number;
    home_team: string;
    away_team: string;
    spread_close: number | null;
  }>(
    'cfbd_betting_lines',
    'cfbd_game_id, season, home_team, away_team, spread_close',
    q => q.in('season', [2022, 2023, 2024]).not('spread_close', 'is', null)
  );

  console.log('Total games loaded:', games.length);

  // Filter to FBS only
  const fbsGames = games.filter(g => isFBSGame(g.home_team, g.away_team));
  console.log('FBS games:', fbsGames.length);
  console.log('FCS/mixed games filtered out:', games.length - fbsGames.length);

  // Count by season
  const statsBySeason: Record<number, {
    total: number;
    matched: number;
    unmatched: number;
  }> = {
    2022: { total: 0, matched: 0, unmatched: 0 },
    2023: { total: 0, matched: 0, unmatched: 0 },
    2024: { total: 0, matched: 0, unmatched: 0 },
  };

  for (const g of fbsGames) {
    statsBySeason[g.season].total++;
    const t60 = t60Map.get(g.cfbd_game_id);
    if (t60?.matched && t60.spread_t60 !== null) {
      statsBySeason[g.season].matched++;
    } else {
      statsBySeason[g.season].unmatched++;
    }
  }

  console.log('\n=== FBS-Only Coverage by Season ===');
  console.log('| Season | FBS Games | T-60 Matched | Coverage |');
  console.log('|--------|-----------|--------------|----------|');

  for (const s of [2022, 2023, 2024] as const) {
    const stats = statsBySeason[s];
    const pct = (stats.matched / stats.total * 100).toFixed(1);
    console.log(`| ${s}   | ${String(stats.total).padStart(9)} | ${String(stats.matched).padStart(12)} | ${pct.padStart(7)}% |`);
  }

  const totalFBS = Object.values(statsBySeason).reduce((a, b) => a + b.total, 0);
  const totalMatched = Object.values(statsBySeason).reduce((a, b) => a + b.matched, 0);
  console.log(`| TOTAL  | ${String(totalFBS).padStart(9)} | ${String(totalMatched).padStart(12)} | ${(totalMatched / totalFBS * 100).toFixed(1).padStart(7)}% |`);

  // List unmatched FBS teams (teams in FBS games that weren't matched)
  const unmatchedTeams = new Set<string>();
  for (const g of fbsGames) {
    const t60 = t60Map.get(g.cfbd_game_id);
    if (!t60?.matched) {
      unmatchedTeams.add(g.home_team);
      unmatchedTeams.add(g.away_team);
    }
  }

  if (unmatchedTeams.size > 0) {
    console.log('\nUnmatched FBS teams (appear in games without T-60):');
    [...unmatchedTeams].sort().slice(0, 20).forEach(t => console.log('  ' + t));
    if (unmatchedTeams.size > 20) {
      console.log(`  ... and ${unmatchedTeams.size - 20} more`);
    }
  }
}

main().catch(console.error);
