/**
 * Create the advanced_team_ratings table
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  console.log('Creating advanced_team_ratings table...');

  // Since we can't run raw SQL easily, let's try inserting a test record
  // The table needs to be created via Supabase dashboard
  // OR we can use the supabase CLI

  // For now, let's check if the table exists
  const { data, error } = await supabase
    .from('advanced_team_ratings')
    .select('id')
    .limit(1);

  if (error && error.message.includes('does not exist')) {
    console.log('\nThe table does not exist. Please create it via Supabase SQL Editor:');
    console.log('\n--- Copy and paste this SQL into Supabase SQL Editor ---\n');
    console.log(`
CREATE TABLE IF NOT EXISTS advanced_team_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    cfbd_elo NUMERIC,
    fpi NUMERIC,
    srs NUMERIC,
    sp_overall NUMERIC,
    sp_offense NUMERIC,
    sp_defense NUMERIC,
    recruiting_rank INTEGER,
    recruiting_points NUMERIC,
    talent_rating NUMERIC,
    off_ppa NUMERIC,
    off_success_rate NUMERIC,
    off_explosiveness NUMERIC,
    off_power_success NUMERIC,
    off_stuff_rate NUMERIC,
    off_line_yards NUMERIC,
    off_havoc NUMERIC,
    def_ppa NUMERIC,
    def_success_rate NUMERIC,
    def_explosiveness NUMERIC,
    def_power_success NUMERIC,
    def_stuff_rate NUMERIC,
    def_line_yards NUMERIC,
    def_havoc NUMERIC,
    off_passing_ppa NUMERIC,
    off_rushing_ppa NUMERIC,
    def_passing_ppa NUMERIC,
    def_rushing_ppa NUMERIC,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, season)
);

CREATE INDEX idx_advanced_ratings_team_season ON advanced_team_ratings(team_id, season);
CREATE INDEX idx_advanced_ratings_sp ON advanced_team_ratings(sp_overall DESC);
`);
    console.log('\n--- End SQL ---\n');
    console.log('Go to: https://supabase.com/dashboard/project/cdhujemmhfbsmzchsuci/sql/new');
  } else if (error) {
    console.log('Error:', error.message);
  } else {
    console.log('Table exists!');
  }
}

main().catch(console.error);
