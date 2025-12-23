/**
 * Run model_reports table migration
 *
 * This creates the model_reports table if it doesn't exist.
 * Run via: SUPABASE_URL="..." SUPABASE_ANON_KEY="..." npx tsx scripts/run-model-reports-migration.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('Checking if model_reports table exists...');

  // Try to query the table
  const { error } = await supabase.from('model_reports').select('id').limit(1);

  if (!error) {
    console.log('Table model_reports already exists.');
    return;
  }

  console.log('Table does not exist. Please run the following SQL in your Supabase dashboard:');
  console.log('');
  console.log(`
-- Model performance reports table
CREATE TABLE IF NOT EXISTS model_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  sport VARCHAR(10) NOT NULL,
  total_bets INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  pushes INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC(5,4),
  roi NUMERIC(6,4),
  profit_units NUMERIC(8,2),
  backtest_win_rate NUMERIC(5,4),
  vs_backtest VARCHAR(20),
  vs_backtest_significant BOOLEAN DEFAULT FALSE,
  vs_breakeven_pvalue NUMERIC(6,4),
  edge_buckets JSONB,
  favorites_record VARCHAR(20),
  favorites_roi NUMERIC(6,4),
  underdogs_record VARCHAR(20),
  underdogs_roi NUMERIC(6,4),
  sample_size_adequate BOOLEAN DEFAULT FALSE,
  recommendation TEXT,
  report_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_date, sport)
);

CREATE INDEX idx_model_reports_sport_date ON model_reports(sport, report_date DESC);
`);
}

run().catch(console.error);
