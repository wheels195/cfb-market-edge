/**
 * Apply migration 011 using direct PostgreSQL connection
 *
 * This requires the database password which should be set in .env.local as:
 * DATABASE_URL=postgresql://postgres:[YOUR_PASSWORD]@db.cdhujemmhfbsmzchsuci.supabase.co:5432/postgres
 *
 * Get the password from: https://supabase.com/dashboard/project/cdhujemmhfbsmzchsuci/settings/database
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function applyMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.log('=== MANUAL MIGRATION REQUIRED ===\n');
    console.log('No DATABASE_URL found. Please run the migration manually:');
    console.log('\n1. Go to: https://supabase.com/dashboard/project/cdhujemmhfbsmzchsuci/sql/new');
    console.log('\n2. Copy and paste the contents of:');
    console.log('   supabase/migrations/011_backtest_v1_tables.sql');
    console.log('\n3. Click "Run" to execute the migration');
    console.log('\n=================================\n');

    // Output the SQL for convenience
    const migrationPath = path.join(__dirname, '../supabase/migrations/011_backtest_v1_tables.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    console.log('Migration SQL:\n');
    console.log('```sql');
    console.log(sql);
    console.log('```');
    return;
  }

  console.log('Connecting to database...');
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('Connected!\n');

    const migrationPath = path.join(__dirname, '../supabase/migrations/011_backtest_v1_tables.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    console.log('Running migration 011_backtest_v1_tables.sql...');
    await client.query(sql);
    console.log('Migration completed successfully!');

    // Verify tables exist
    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('team_elo_snapshots', 'backtest_projections', 'model_calibration', 'backtest_results', 'backtest_bets')
    `);

    console.log('\nCreated tables:');
    for (const row of rows) {
      console.log(`  ✓ ${row.table_name}`);
    }

    // Check tick_type column
    const { rows: cols } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'odds_ticks' AND column_name = 'tick_type'
    `);

    if (cols.length > 0) {
      console.log('  ✓ odds_ticks.tick_type column added');
    }

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

applyMigration().catch(console.error);
