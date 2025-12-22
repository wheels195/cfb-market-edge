/**
 * Check CFB data coverage by season
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  const { data } = await supabase
    .from('cfbd_betting_lines')
    .select('season, spread_close, spread_open, home_score')
    .not('home_score', 'is', null);

  const bySeason: Record<number, { total: number; withClose: number; withOpen: number; withBoth: number }> = {};
  for (const row of data || []) {
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
    console.log(`Season ${s}: ${stats.total} games, ${stats.withClose} with close, ${stats.withBoth} with BOTH`);
    totalGames += stats.total;
    totalWithClose += stats.withClose;
    totalWithBoth += stats.withBoth;
  }
  console.log(`\nTotal: ${totalGames} games, ${totalWithClose} with close, ${totalWithBoth} with BOTH`);
}

main().catch(console.error);
