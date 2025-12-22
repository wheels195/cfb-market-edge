/**
 * Run migration 024 to add T-60 columns
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('Running migration 024: Add T-60 columns...\n');

  // Add start_date column
  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: 'ALTER TABLE cfbd_betting_lines ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;'
  });

  if (e1) {
    console.log('Adding start_date via RPC failed, trying direct approach...');

    // Try using postgrest-js to insert a row with the new column
    // This won't work for DDL, but let's check if column already exists
    const { data, error } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .limit(1);

    if (data?.[0]) {
      const cols = Object.keys(data[0]);
      console.log('Current columns:', cols.join(', '));

      if (!cols.includes('start_date')) {
        console.log('\nstart_date column MISSING - need to add via SQL dashboard or CLI');
        console.log('Run this SQL in Supabase dashboard:');
        console.log('');
        console.log('ALTER TABLE cfbd_betting_lines ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;');
        console.log('ALTER TABLE cfbd_betting_lines ADD COLUMN IF NOT EXISTS spread_t60 NUMERIC(6,2);');
        console.log('ALTER TABLE cfbd_betting_lines ADD COLUMN IF NOT EXISTS total_t60 NUMERIC(6,2);');
        console.log('CREATE INDEX IF NOT EXISTS idx_cfbd_lines_start_date ON cfbd_betting_lines(start_date);');
      } else {
        console.log('start_date column already exists!');
      }
    }
  } else {
    console.log('Migration 024 applied successfully');
  }
}

main().catch(console.error);
