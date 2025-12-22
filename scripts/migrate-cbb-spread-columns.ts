/**
 * Migration: Add DK spread columns to cbb_games and create sync progress table
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function migrate() {
  console.log('=== CBB Spread Columns Migration ===\n');

  // Add spread columns to cbb_games
  const columns = [
    { name: 'dk_spread_open', type: 'NUMERIC', desc: 'DK opening spread (earliest available)' },
    { name: 'dk_spread_open_ts', type: 'TIMESTAMPTZ', desc: 'When opening spread was captured' },
    { name: 'dk_spread_t60', type: 'NUMERIC', desc: 'DK spread at T-60 min' },
    { name: 'dk_spread_t60_ts', type: 'TIMESTAMPTZ', desc: 'When T-60 spread was captured' },
    { name: 'dk_spread_t30', type: 'NUMERIC', desc: 'DK spread at T-30 min' },
    { name: 'dk_spread_t30_ts', type: 'TIMESTAMPTZ', desc: 'When T-30 spread was captured' },
    { name: 'dk_spread_close', type: 'NUMERIC', desc: 'DK closing spread' },
    { name: 'dk_spread_close_ts', type: 'TIMESTAMPTZ', desc: 'When closing spread was captured' },
  ];

  console.log('Adding columns to cbb_games...');

  for (const col of columns) {
    // Check if column exists by trying to select it
    const { error: checkError } = await supabase
      .from('cbb_games')
      .select(col.name)
      .limit(1);

    if (checkError?.message.includes('does not exist')) {
      console.log(`  Adding ${col.name}...`);

      // Use raw SQL via RPC if available, otherwise note it needs manual creation
      const { error } = await supabase.rpc('exec_sql', {
        sql: `ALTER TABLE cbb_games ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`
      });

      if (error) {
        console.log(`    Manual SQL needed: ALTER TABLE cbb_games ADD COLUMN ${col.name} ${col.type};`);
      } else {
        console.log(`    Added ${col.name}`);
      }
    } else {
      console.log(`  ${col.name} already exists`);
    }
  }

  // Create sync progress table
  console.log('\nCreating cbb_sync_progress table...');

  const { error: progressError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS cbb_sync_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sync_type TEXT NOT NULL,
        date_key TEXT NOT NULL,
        games_matched INTEGER DEFAULT 0,
        games_total INTEGER DEFAULT 0,
        completed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(sync_type, date_key)
      );
    `
  });

  if (progressError) {
    console.log('  Manual SQL needed:');
    console.log(`
CREATE TABLE IF NOT EXISTS cbb_sync_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,
  date_key TEXT NOT NULL,
  games_matched INTEGER DEFAULT 0,
  games_total INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sync_type, date_key)
);
    `);
  } else {
    console.log('  Created cbb_sync_progress');
  }

  console.log('\n=== Migration Complete ===');
  console.log('\nIf any manual SQL is needed above, run it in Supabase Dashboard > SQL Editor');
}

migrate().catch(console.error);
