/**
 * Check CFB data coverage by season (with pagination)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  // Get total count first
  const { count: totalCount } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true });

  console.log(`Total rows in table: ${totalCount}`);

  // Get counts by season using pagination
  const allRows: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('cfbd_betting_lines')
      .select('season, spread_close, spread_open, home_score')
      .not('home_score', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error:', error);
      break;
    }
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`\nFetched ${allRows.length} completed games\n`);

  const bySeason: Record<number, { total: number; withClose: number; withOpen: number; withBoth: number }> = {};
  for (const row of allRows) {
    if (!bySeason[row.season]) {
      bySeason[row.season] = { total: 0, withClose: 0, withOpen: 0, withBoth: 0 };
    }
    bySeason[row.season].total++;
    if (row.spread_close !== null) bySeason[row.season].withClose++;
    if (row.spread_open !== null) bySeason[row.season].withOpen++;
    if (row.spread_close !== null && row.spread_open !== null) bySeason[row.season].withBoth++;
  }

  console.log('=== CFB Data by Season ===');
  let totalGames = 0;
  let totalWithClose = 0;
  let totalWithBoth = 0;
  for (const [s, stats] of Object.entries(bySeason).sort()) {
    console.log(`Season ${s}: ${stats.total} games, ${stats.withClose} with close, ${stats.withBoth} with BOTH (open+close)`);
    totalGames += stats.total;
    totalWithClose += stats.withClose;
    totalWithBoth += stats.withBoth;
  }
  console.log(`\nTotal completed: ${totalGames} games, ${totalWithClose} with close, ${totalWithBoth} with BOTH`);
}

main().catch(console.error);
