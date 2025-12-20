/**
 * Run migration 014 - Paper Bets table
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('Running migration 014: Paper Bets table...\n');

  // Create paper_bets table
  const { error: tableError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS paper_bets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID REFERENCES events(id),
        side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away')),
        market_type VARCHAR(20) NOT NULL DEFAULT 'spread',
        market_spread_home NUMERIC(5,1) NOT NULL,
        spread_price_american INTEGER NOT NULL,
        model_spread_home NUMERIC(5,1) NOT NULL,
        edge_points NUMERIC(5,2) NOT NULL,
        abs_edge NUMERIC(5,2) NOT NULL,
        week_rank INTEGER,
        units NUMERIC(4,2) NOT NULL DEFAULT 1.0,
        stake_amount NUMERIC(10,2) NOT NULL DEFAULT 100.0,
        closing_spread_home NUMERIC(5,1),
        closing_price_american INTEGER,
        clv_points NUMERIC(5,2),
        result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push', 'pending')),
        home_score INTEGER,
        away_score INTEGER,
        profit_loss NUMERIC(10,2),
        bet_placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        game_started_at TIMESTAMPTZ,
        game_ended_at TIMESTAMPTZ,
        season INTEGER NOT NULL,
        week INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'settled')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `
  });

  if (tableError) {
    // Try direct insert approach - table might already exist or we need different approach
    console.log('RPC not available, trying direct table check...');

    // Check if table exists by trying to select from it
    const { error: checkError } = await supabase
      .from('paper_bets')
      .select('id')
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      console.log('Table does not exist. Please run the SQL manually in Supabase dashboard:');
      console.log('\n--- Copy this SQL to Supabase SQL Editor ---\n');
      console.log(`
CREATE TABLE IF NOT EXISTS paper_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  side VARCHAR(10) NOT NULL CHECK (side IN ('home', 'away')),
  market_type VARCHAR(20) NOT NULL DEFAULT 'spread',
  market_spread_home NUMERIC(5,1) NOT NULL,
  spread_price_american INTEGER NOT NULL,
  model_spread_home NUMERIC(5,1) NOT NULL,
  edge_points NUMERIC(5,2) NOT NULL,
  abs_edge NUMERIC(5,2) NOT NULL,
  week_rank INTEGER,
  units NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  stake_amount NUMERIC(10,2) NOT NULL DEFAULT 100.0,
  closing_spread_home NUMERIC(5,1),
  closing_price_american INTEGER,
  clv_points NUMERIC(5,2),
  result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push', 'pending')),
  home_score INTEGER,
  away_score INTEGER,
  profit_loss NUMERIC(10,2),
  bet_placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  game_started_at TIMESTAMPTZ,
  game_ended_at TIMESTAMPTZ,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'settled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_bets_event ON paper_bets(event_id);
CREATE INDEX IF NOT EXISTS idx_paper_bets_season_week ON paper_bets(season, week);
CREATE INDEX IF NOT EXISTS idx_paper_bets_status ON paper_bets(status);
CREATE INDEX IF NOT EXISTS idx_paper_bets_result ON paper_bets(result);
      `);
    } else if (checkError) {
      console.error('Error checking table:', checkError.message);
    } else {
      console.log('✓ paper_bets table already exists!');
    }
  } else {
    console.log('✓ Migration completed successfully!');
  }
}

main().catch(console.error);
