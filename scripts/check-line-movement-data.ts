/**
 * Check line movement data coverage
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('Checking line movement data coverage...\n');

  // Get all games with execution timing
  const { data, error } = await supabase
    .from('cbb_betting_lines')
    .select(`
      spread_open,
      spread_t60,
      spread_t30,
      spread_close,
      execution_timing,
      cbb_games!inner(season, status)
    `)
    .eq('provider', 'DraftKings')
    .not('execution_timing', 'is', null)
    .eq('cbb_games.status', 'final');

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  const seasons: Record<number, { total: number; withOpen: number; withClose: number; withBoth: number }> = {};

  for (const row of data || []) {
    const s = (row.cbb_games as any).season;
    if (!seasons[s]) {
      seasons[s] = { total: 0, withOpen: 0, withClose: 0, withBoth: 0 };
    }
    seasons[s].total++;

    const hasOpen = row.spread_open !== null;
    const hasT60 = row.spread_t60 !== null || row.spread_t30 !== null;
    const hasClose = row.spread_close !== null;

    if (hasOpen) seasons[s].withOpen++;
    if (hasClose) seasons[s].withClose++;
    if (hasOpen && hasT60) seasons[s].withBoth++;
  }

  console.log('Coverage by Season:');
  console.log('Season | Total | With Open | With Close | Open+T60');
  console.log('-'.repeat(55));

  let totalAll = 0, totalOpen = 0, totalClose = 0, totalBoth = 0;

  for (const s of Object.keys(seasons).sort()) {
    const stats = seasons[parseInt(s)];
    console.log(
      `${s}   | ${stats.total.toString().padStart(5)} | ` +
      `${stats.withOpen.toString().padStart(9)} | ` +
      `${stats.withClose.toString().padStart(10)} | ` +
      `${stats.withBoth.toString().padStart(8)}`
    );
    totalAll += stats.total;
    totalOpen += stats.withOpen;
    totalClose += stats.withClose;
    totalBoth += stats.withBoth;
  }

  console.log('-'.repeat(55));
  console.log(
    `Total | ${totalAll.toString().padStart(5)} | ` +
    `${totalOpen.toString().padStart(9)} | ` +
    `${totalClose.toString().padStart(10)} | ` +
    `${totalBoth.toString().padStart(8)}`
  );

  // Sample some line movements
  console.log('\n\nSample Line Movements:');
  const samples = (data || [])
    .filter(r => r.spread_open !== null && r.spread_t60 !== null)
    .slice(0, 10);

  for (const s of samples) {
    const move = (s.spread_t60 || s.spread_t30)! - s.spread_open!;
    console.log(`  Open: ${s.spread_open}, T-60: ${s.spread_t60 || s.spread_t30}, Move: ${move >= 0 ? '+' : ''}${move.toFixed(1)}`);
  }
}

run().catch(console.error);
