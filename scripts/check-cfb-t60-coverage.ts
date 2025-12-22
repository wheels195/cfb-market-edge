/**
 * Check CFB T-60 data coverage for execution validation
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  console.log('=== CFB T-60 Execution Validation - Data Check ===\n');

  // Check cfbd_betting_lines full coverage
  const { count: total } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true });

  const { count: hasOpen } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('spread_open', 'is', null);

  const { count: hasClose } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('spread_close', 'is', null);

  const { count: hasBoth } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('spread_open', 'is', null)
    .not('spread_close', 'is', null);

  const { count: hasScores } = await supabase
    .from('cfbd_betting_lines')
    .select('*', { count: 'exact', head: true })
    .not('home_score', 'is', null)
    .not('away_score', 'is', null);

  console.log('=== cfbd_betting_lines coverage ===');
  console.log('Total rows:', total);
  console.log('Has spread_open:', hasOpen);
  console.log('Has spread_close:', hasClose);
  console.log('Has BOTH open & close:', hasBoth);
  console.log('Has scores:', hasScores);

  // Check by season
  const { data: seasonData } = await supabase
    .from('cfbd_betting_lines')
    .select('season, spread_open, spread_close, home_score')
    .not('home_score', 'is', null);

  const seasonStats: Record<number, { total: number; hasOpen: number; hasClose: number; hasBoth: number }> = {};
  for (const row of seasonData || []) {
    if (!seasonStats[row.season]) {
      seasonStats[row.season] = { total: 0, hasOpen: 0, hasClose: 0, hasBoth: 0 };
    }
    seasonStats[row.season].total++;
    if (row.spread_open !== null) seasonStats[row.season].hasOpen++;
    if (row.spread_close !== null) seasonStats[row.season].hasClose++;
    if (row.spread_open !== null && row.spread_close !== null) seasonStats[row.season].hasBoth++;
  }

  console.log('\n=== By season (games with scores) ===');
  for (const [s, stats] of Object.entries(seasonStats).sort()) {
    console.log(`Season ${s}: ${stats.total} games, ${stats.hasBoth} with open+close (${(stats.hasBoth / stats.total * 100).toFixed(0)}%)`);
  }

  // Check line movement distribution (open vs close)
  const { data: moveData } = await supabase
    .from('cfbd_betting_lines')
    .select('spread_open, spread_close')
    .not('spread_open', 'is', null)
    .not('spread_close', 'is', null);

  if (moveData && moveData.length > 0) {
    const moves = moveData.map(r => r.spread_close - r.spread_open);
    const avgMove = moves.reduce((a, b) => a + b, 0) / moves.length;
    const absAvg = moves.map(m => Math.abs(m)).reduce((a, b) => a + b, 0) / moves.length;

    console.log('\n=== Line movement (close - open) ===');
    console.log('Games with both:', moveData.length);
    console.log('Avg move:', avgMove.toFixed(2));
    console.log('Avg absolute move:', absAvg.toFixed(2));

    // Distribution buckets
    const buckets = [
      { min: 0, max: 0.5, label: '0-0.5' },
      { min: 0.5, max: 1, label: '0.5-1' },
      { min: 1, max: 2, label: '1-2' },
      { min: 2, max: 3, label: '2-3' },
      { min: 3, max: 10, label: '3+' },
    ];

    console.log('\nMove distribution:');
    for (const bucket of buckets) {
      const count = moves.filter(m => Math.abs(m) >= bucket.min && Math.abs(m) < bucket.max).length;
      console.log(`  ${bucket.label} pts: ${count} games (${(count / moves.length * 100).toFixed(1)}%)`);
    }
  }

  // Check provider distribution
  const { data: providers } = await supabase
    .from('cfbd_betting_lines')
    .select('provider')
    .not('spread_open', 'is', null);

  const providerCounts: Record<string, number> = {};
  for (const row of providers || []) {
    providerCounts[row.provider] = (providerCounts[row.provider] || 0) + 1;
  }

  console.log('\n=== Providers (games with spread_open) ===');
  for (const [p, c] of Object.entries(providerCounts)) {
    console.log(`  ${p}: ${c}`);
  }

  console.log('\n=== Summary ===');
  console.log(`We have ${hasBoth} CFB games with BOTH open and close spreads.`);
  console.log('This can be used for Open vs Close comparison.');
  console.log('\nFor true T-60 validation, we need to sync DK spreads at T-60 via Historical Odds API.');
}

main().catch(console.error);
