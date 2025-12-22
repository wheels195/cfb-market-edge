/**
 * Analyze line movement distribution
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('Analyzing line movement distribution...\n');

  const { data, error } = await supabase
    .from('cbb_betting_lines')
    .select(`
      spread_open,
      spread_t60,
      spread_t30,
      spread_close,
      execution_timing,
      cbb_games!inner(season, status, home_score, away_score, home_team_name, away_team_name)
    `)
    .eq('provider', 'DraftKings')
    .not('execution_timing', 'is', null)
    .not('spread_open', 'is', null)
    .eq('cbb_games.status', 'final');

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  // Calculate movements
  const movements: number[] = [];
  const movementBuckets: Record<string, number> = {
    'no_move': 0,
    'move_0.5': 0,
    'move_1': 0,
    'move_1.5': 0,
    'move_2': 0,
    'move_2.5+': 0,
  };

  for (const row of data || []) {
    const t60 = row.spread_t60 ?? row.spread_t30;
    if (t60 === null || row.spread_open === null) continue;

    const move = t60 - row.spread_open;
    movements.push(move);

    const absMv = Math.abs(move);
    if (absMv === 0) movementBuckets['no_move']++;
    else if (absMv <= 0.5) movementBuckets['move_0.5']++;
    else if (absMv <= 1) movementBuckets['move_1']++;
    else if (absMv <= 1.5) movementBuckets['move_1.5']++;
    else if (absMv <= 2) movementBuckets['move_2']++;
    else movementBuckets['move_2.5+']++;
  }

  console.log('Movement Distribution (Open to T-60):');
  console.log(`Total games: ${movements.length}\n`);

  for (const [bucket, count] of Object.entries(movementBuckets)) {
    const pct = (count / movements.length * 100).toFixed(1);
    console.log(`  ${bucket.padEnd(12)}: ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Movement stats
  const nonZeroMoves = movements.filter(m => m !== 0);
  console.log(`\nNon-zero movements: ${nonZeroMoves.length} (${(nonZeroMoves.length / movements.length * 100).toFixed(1)}%)`);

  if (nonZeroMoves.length > 0) {
    const avgAbs = nonZeroMoves.reduce((s, m) => s + Math.abs(m), 0) / nonZeroMoves.length;
    const towardsFav = nonZeroMoves.filter(m => m < 0).length;
    const towardsUnd = nonZeroMoves.filter(m => m > 0).length;

    console.log(`Avg absolute move: ${avgAbs.toFixed(2)} points`);
    console.log(`Moves toward favorite: ${towardsFav} (${(towardsFav / nonZeroMoves.length * 100).toFixed(1)}%)`);
    console.log(`Moves toward underdog: ${towardsUnd} (${(towardsUnd / nonZeroMoves.length * 100).toFixed(1)}%)`);
  }

  // Also check T-60 to Close movement (we have more data here)
  console.log('\n\n--- T-60 to Close Movement (Alternative) ---\n');

  const { data: t60Data, error: t60Error } = await supabase
    .from('cbb_betting_lines')
    .select(`
      spread_t60,
      spread_t30,
      spread_close,
      execution_timing,
      cbb_games!inner(season, status)
    `)
    .eq('provider', 'DraftKings')
    .not('execution_timing', 'is', null)
    .not('spread_close', 'is', null)
    .eq('cbb_games.status', 'final');

  if (t60Error) {
    console.log('Error:', t60Error.message);
    return;
  }

  const t60Movements: number[] = [];
  const t60Buckets: Record<string, number> = {
    'no_move': 0,
    'move_0.5': 0,
    'move_1': 0,
    'move_1.5': 0,
    'move_2': 0,
    'move_2.5+': 0,
  };

  for (const row of t60Data || []) {
    const t60 = row.spread_t60 ?? row.spread_t30;
    if (t60 === null || row.spread_close === null) continue;

    const move = row.spread_close - t60; // Close minus T-60
    t60Movements.push(move);

    const absMv = Math.abs(move);
    if (absMv === 0) t60Buckets['no_move']++;
    else if (absMv <= 0.5) t60Buckets['move_0.5']++;
    else if (absMv <= 1) t60Buckets['move_1']++;
    else if (absMv <= 1.5) t60Buckets['move_1.5']++;
    else if (absMv <= 2) t60Buckets['move_2']++;
    else t60Buckets['move_2.5+']++;
  }

  console.log('Movement Distribution (T-60 to Close):');
  console.log(`Total games: ${t60Movements.length}\n`);

  for (const [bucket, count] of Object.entries(t60Buckets)) {
    const pct = (count / t60Movements.length * 100).toFixed(1);
    console.log(`  ${bucket.padEnd(12)}: ${count.toString().padStart(4)} (${pct}%)`);
  }

  const nonZeroT60 = t60Movements.filter(m => m !== 0);
  console.log(`\nNon-zero movements: ${nonZeroT60.length} (${(nonZeroT60.length / t60Movements.length * 100).toFixed(1)}%)`);

  if (nonZeroT60.length > 0) {
    const avgAbs = nonZeroT60.reduce((s, m) => s + Math.abs(m), 0) / nonZeroT60.length;
    console.log(`Avg absolute move: ${avgAbs.toFixed(2)} points`);
  }
}

run().catch(console.error);
