/**
 * Check what CFBD data we have and what's missing
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

async function cfbdFetch(endpoint: string) {
  const response = await fetch(`https://apinext.collegefootballdata.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${CFBD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) {
    console.log(`CFBD API error: ${response.status} for ${endpoint}`);
    return null;
  }
  return response.json();
}

async function main() {
  console.log('=== CFBD DATA AVAILABILITY CHECK ===\n');

  // 1. Check current database tables
  console.log('--- CURRENT DATABASE TABLES ---');
  const tables = [
    'advanced_team_ratings',
    'game_advanced_stats',
    'game_weather',
    'returning_production',
    'recruiting_classes',
    'transfer_portal',
    'player_seasons',
    'player_usage',
  ];

  for (const table of tables) {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    console.log(`${table}: ${count} rows`);
  }

  // 2. Check what CFBD Elo ratings look like
  console.log('\n--- CFBD ELO RATINGS (sample) ---');
  const eloData = await cfbdFetch('/ratings/elo?year=2024');
  if (eloData) {
    console.log(`Retrieved ${eloData.length} Elo ratings`);
    console.log('Sample:', JSON.stringify(eloData.slice(0, 2), null, 2));
  }

  // 3. Check CFBD betting lines (this is KEY - opening lines!)
  console.log('\n--- CFBD BETTING LINES (sample) ---');
  const bettingData = await cfbdFetch('/lines?year=2024&week=1');
  if (bettingData) {
    console.log(`Retrieved ${bettingData.length} games with betting lines`);
    if (bettingData.length > 0) {
      console.log('Sample game:', JSON.stringify(bettingData[0], null, 2));
    }
  }

  // 4. Check transfer portal data
  console.log('\n--- CFBD TRANSFER PORTAL (sample) ---');
  const transferData = await cfbdFetch('/player/portal?year=2024');
  if (transferData) {
    console.log(`Retrieved ${transferData.length} transfer portal entries`);
    // Filter for QBs
    const qbs = transferData.filter((p: any) => p.position === 'QB');
    console.log(`QBs in portal: ${qbs.length}`);
    if (qbs.length > 0) {
      console.log('Sample QB:', JSON.stringify(qbs[0], null, 2));
    }
  }

  // 5. Check SRS ratings
  console.log('\n--- CFBD SRS RATINGS (sample) ---');
  const srsData = await cfbdFetch('/ratings/srs?year=2024');
  if (srsData) {
    console.log(`Retrieved ${srsData.length} SRS ratings`);
    console.log('Sample:', JSON.stringify(srsData.slice(0, 2), null, 2));
  }

  // 6. Check FPI ratings
  console.log('\n--- CFBD FPI RATINGS (sample) ---');
  const fpiData = await cfbdFetch('/ratings/fpi?year=2024');
  if (fpiData) {
    console.log(`Retrieved ${fpiData.length} FPI ratings`);
    console.log('Sample:', JSON.stringify(fpiData.slice(0, 2), null, 2));
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`
CFBD has these key data sources we should use:

1. ELO RATINGS - Weekly team Elo ratings
   - Use as internal rating base instead of building from scratch

2. BETTING LINES - Historical opening/closing lines per game
   - Critical for opening-line residual analysis
   - Can compare our projection to OPENING line (not just close)

3. SRS/FPI RATINGS - Alternative rating systems
   - Can blend multiple rating systems

4. TRANSFER PORTAL - Player movement with positions
   - Can track QB transfers specifically

5. We already have: SP+, game PPA, weather, returning production, recruiting
`);

  console.log('=== CHECK COMPLETE ===');
}

main().catch(console.error);
