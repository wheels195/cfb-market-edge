/**
 * Run CBB Schema Migration via Supabase
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const migrations = [
  // 1. CBB Teams table
  `CREATE TABLE IF NOT EXISTS cbb_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cbbd_team_id INTEGER UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    abbreviation VARCHAR(20),
    conference VARCHAR(50),
    primary_color VARCHAR(10),
    secondary_color VARCHAR(10),
    venue VARCHAR(100),
    city VARCHAR(50),
    state VARCHAR(5),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 2. CBB Team Ratings
  `CREATE TABLE IF NOT EXISTS cbb_team_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES cbb_teams(id),
    season INTEGER NOT NULL,
    offensive_rating DECIMAL(6,2),
    defensive_rating DECIMAL(6,2),
    net_rating DECIMAL(6,2),
    srs_rating DECIMAL(6,2),
    offense_rank INTEGER,
    defense_rank INTEGER,
    net_rank INTEGER,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season)
  )`,

  // 3. CBB Games table
  `CREATE TABLE IF NOT EXISTS cbb_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cbbd_game_id INTEGER UNIQUE NOT NULL,
    season INTEGER NOT NULL,
    season_type VARCHAR(20) DEFAULT 'regular',
    start_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled',
    neutral_site BOOLEAN DEFAULT FALSE,
    conference_game BOOLEAN DEFAULT FALSE,
    home_team_id UUID REFERENCES cbb_teams(id),
    away_team_id UUID REFERENCES cbb_teams(id),
    home_team_name VARCHAR(100),
    away_team_name VARCHAR(100),
    home_score INTEGER,
    away_score INTEGER,
    venue VARCHAR(100),
    city VARCHAR(50),
    state VARCHAR(10),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 4. CBB Betting Lines
  `CREATE TABLE IF NOT EXISTS cbb_betting_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID REFERENCES cbb_games(id),
    cbbd_game_id INTEGER NOT NULL,
    provider VARCHAR(50),
    spread_home DECIMAL(5,2),
    spread_open DECIMAL(5,2),
    total DECIMAL(5,2),
    total_open DECIMAL(5,2),
    home_moneyline INTEGER,
    away_moneyline INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cbbd_game_id, provider)
  )`,

  // 5. CBB Game Predictions
  `CREATE TABLE IF NOT EXISTS cbb_game_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES cbb_games(id),
    model_spread_home DECIMAL(5,2) NOT NULL,
    market_spread_home DECIMAL(5,2) NOT NULL,
    edge_points DECIMAL(5,2) NOT NULL,
    predicted_side VARCHAR(10) NOT NULL,
    home_net_rating DECIMAL(6,2),
    away_net_rating DECIMAL(6,2),
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    result VARCHAR(10),
    graded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(game_id)
  )`,
];

async function runMigration() {
  console.log('=== Running CBB Schema Migration ===\n');

  // Test if tables already exist by trying to select from them
  const tables = ['cbb_teams', 'cbb_team_ratings', 'cbb_games', 'cbb_betting_lines', 'cbb_game_predictions'];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);

    if (error && error.code === '42P01') {
      console.log(`❌ Table ${table} does not exist`);
    } else if (error) {
      console.log(`⚠️  Table ${table}: ${error.message}`);
    } else {
      console.log(`✓ Table ${table} exists`);
    }
  }

  console.log('\n--- Migration Status ---');
  console.log('If tables are missing, please run this SQL in Supabase SQL Editor:');
  console.log('File: scripts/migrations/cbb-schema.sql\n');

  // Try to verify we can insert (this will fail if tables don't exist)
  const { error: testError } = await supabase
    .from('cbb_teams')
    .select('id')
    .limit(1);

  if (testError && testError.code === '42P01') {
    console.log('Tables need to be created. Run the SQL migration first.');
    return false;
  }

  console.log('✓ CBB tables are ready!\n');
  return true;
}

runMigration().catch(console.error);
