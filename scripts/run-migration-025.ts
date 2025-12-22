/**
 * Run CBB Elo Production Migration
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function runMigration() {
  console.log('Running CBB Elo Production Migration...\n');

  // 1. Create cbb_elo_snapshots table
  console.log('1. Creating cbb_elo_snapshots table...');
  const { error: error1 } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS cbb_elo_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES cbb_teams(id),
        season INTEGER NOT NULL,
        games_played INTEGER NOT NULL DEFAULT 0,
        elo NUMERIC(8,2) NOT NULL DEFAULT 1500,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(team_id, season)
      );
    `
  });
  if (error1) {
    console.log('Note: cbb_elo_snapshots table may already exist or needs manual creation');
  }

  // Test direct table creation with insert
  const { error: testError } = await supabase.from('cbb_elo_snapshots').select('*').limit(1);
  if (testError?.message?.includes('does not exist')) {
    console.log('Table does not exist - needs manual creation via Supabase dashboard');
    console.log('\nRun this SQL in Supabase dashboard:');
    console.log('----------------------------------------');
    console.log(`
CREATE TABLE IF NOT EXISTS cbb_elo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cbb_teams(id),
  season INTEGER NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  elo NUMERIC(8,2) NOT NULL DEFAULT 1500,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_cbb_elo_snapshots_team_season ON cbb_elo_snapshots(team_id, season);
CREATE INDEX IF NOT EXISTS idx_cbb_elo_snapshots_season ON cbb_elo_snapshots(season);

GRANT ALL ON cbb_elo_snapshots TO authenticated;
GRANT ALL ON cbb_elo_snapshots TO anon;
    `);
  } else {
    console.log('   cbb_elo_snapshots table exists or was created');
  }

  // 2. Check if cbb_game_predictions has new columns
  console.log('\n2. Checking cbb_game_predictions columns...');
  const { data: predictions, error: predError } = await supabase
    .from('cbb_game_predictions')
    .select('*')
    .limit(1);

  if (predError) {
    console.log('Error checking predictions:', predError);
  } else {
    const sample = predictions?.[0] || {};
    const hasNewCols = 'home_elo' in sample;
    if (hasNewCols) {
      console.log('   cbb_game_predictions already has Elo columns');
    } else {
      console.log('   Need to add columns. Run this SQL:');
      console.log('----------------------------------------');
      console.log(`
ALTER TABLE cbb_game_predictions
ADD COLUMN IF NOT EXISTS home_elo NUMERIC(8,2),
ADD COLUMN IF NOT EXISTS away_elo NUMERIC(8,2),
ADD COLUMN IF NOT EXISTS home_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS away_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS spread_size NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS is_underdog_bet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qualifies_for_bet BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qualification_reason TEXT,
ADD COLUMN IF NOT EXISTS bet_result VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_cbb_predictions_qualifies ON cbb_game_predictions(qualifies_for_bet) WHERE qualifies_for_bet = TRUE;
      `);
    }
  }

  // 3. Check cbb_odds_ticks
  console.log('\n3. Checking cbb_odds_ticks table...');
  const { error: oddsError } = await supabase.from('cbb_odds_ticks').select('*').limit(1);
  if (oddsError?.message?.includes('does not exist')) {
    console.log('   Need to create cbb_odds_ticks table. Run this SQL:');
    console.log('----------------------------------------');
    console.log(`
CREATE TABLE IF NOT EXISTS cbb_odds_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  sportsbook TEXT NOT NULL,
  spread_home NUMERIC(5,2),
  spread_away NUMERIC(5,2),
  total NUMERIC(5,2),
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  payload_hash TEXT,
  UNIQUE(event_id, sportsbook, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_cbb_odds_ticks_event ON cbb_odds_ticks(event_id);
CREATE INDEX IF NOT EXISTS idx_cbb_odds_ticks_commence ON cbb_odds_ticks(commence_time);

GRANT ALL ON cbb_odds_ticks TO authenticated;
GRANT ALL ON cbb_odds_ticks TO anon;
    `);
  } else {
    console.log('   cbb_odds_ticks table exists');
  }

  console.log('\nMigration check complete!');
}

runMigration().catch(console.error);
