/**
 * Run migration 011: Backtest V1 Tables
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function runMigration() {
  console.log('Running migration 011_backtest_v1_tables.sql...\n');

  // Read the migration file
  const migrationPath = path.join(__dirname, '../supabase/migrations/011_backtest_v1_tables.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  // Split into individual statements (simple split on semicolons outside of $$ blocks)
  // For complex migrations, we'll run key parts individually

  // 1. Create team_elo_snapshots
  console.log('1. Creating team_elo_snapshots table...');
  const { error: err1 } = await supabase.rpc('exec_sql', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS team_elo_snapshots (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          season INTEGER NOT NULL,
          week INTEGER NOT NULL,
          elo NUMERIC NOT NULL,
          source TEXT NOT NULL DEFAULT 'cfbd',
          fetched_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(team_id, season, week)
      );
    `
  });

  if (err1) {
    // Table might already exist or RPC might not exist, try direct approach
    console.log('   RPC not available, tables may need manual creation');
  } else {
    console.log('   Done');
  }

  // Check if tables exist
  const { data: tables } = await supabase
    .from('information_schema.tables' as any)
    .select('table_name')
    .eq('table_schema', 'public')
    .in('table_name', ['team_elo_snapshots', 'backtest_projections', 'model_calibration', 'backtest_results', 'backtest_bets']);

  console.log('\nChecking existing tables...');

  // Try to query each table to see if it exists
  const tablesToCheck = [
    'team_elo_snapshots',
    'backtest_projections',
    'model_calibration',
    'backtest_results',
    'backtest_bets'
  ];

  for (const table of tablesToCheck) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (error && error.code === '42P01') {
      console.log(`   ${table}: NOT EXISTS - needs creation`);
    } else if (error) {
      console.log(`   ${table}: ERROR - ${error.message}`);
    } else {
      console.log(`   ${table}: EXISTS`);
    }
  }

  // Check odds_ticks for tick_type column
  console.log('\nChecking odds_ticks.tick_type column...');
  const { data: tickSample, error: tickErr } = await supabase
    .from('odds_ticks')
    .select('id, tick_type')
    .limit(1);

  if (tickErr) {
    console.log('   odds_ticks error:', tickErr.message);
  } else {
    console.log('   tick_type column:', tickSample?.[0]?.tick_type !== undefined ? 'EXISTS' : 'NOT IN RESPONSE');
  }

  console.log('\n=== Migration Status ===');
  console.log('If tables show NOT EXISTS, run the SQL manually in Supabase dashboard:');
  console.log('https://supabase.com/dashboard/project/cdhujemmhfbsmzchsuci/sql');
  console.log('\nMigration file: supabase/migrations/011_backtest_v1_tables.sql');
}

runMigration().catch(console.error);
