/**
 * Check CBB data status
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function check() {
  console.log('========================================');
  console.log('  CBB Data Status Report');
  console.log('========================================\n');

  // Count games by season
  const { data: games } = await supabase
    .from('cbb_games')
    .select('season, status');

  const completedBySeason: Record<number, number> = {};
  const totalBySeason: Record<number, number> = {};

  for (const g of games || []) {
    totalBySeason[g.season] = (totalBySeason[g.season] || 0) + 1;
    if (g.status === 'final') {
      completedBySeason[g.season] = (completedBySeason[g.season] || 0) + 1;
    }
  }

  console.log('=== Games ===');
  for (const season of Object.keys(totalBySeason).sort()) {
    console.log(`Season ${season}: ${completedBySeason[Number(season)] || 0} completed / ${totalBySeason[Number(season)]} total`);
  }

  // Count lines by provider
  const { data: lines } = await supabase
    .from('cbb_betting_lines')
    .select('provider, spread_home, total');

  const byProvider: Record<string, { total: number; withSpread: number; withTotal: number }> = {};

  for (const l of lines || []) {
    if (!byProvider[l.provider]) {
      byProvider[l.provider] = { total: 0, withSpread: 0, withTotal: 0 };
    }
    byProvider[l.provider].total++;
    if (l.spread_home !== null) byProvider[l.provider].withSpread++;
    if (l.total !== null) byProvider[l.provider].withTotal++;
  }

  console.log('\n=== Betting Lines by Provider ===');
  for (const [provider, stats] of Object.entries(byProvider)) {
    console.log(`${provider}: ${stats.total} total (${stats.withSpread} with spread, ${stats.withTotal} with total)`);
  }

  // Count team ratings
  const { data: ratings } = await supabase
    .from('cbb_team_ratings')
    .select('season');

  const ratingsBySeason: Record<number, number> = {};
  for (const r of ratings || []) {
    ratingsBySeason[r.season] = (ratingsBySeason[r.season] || 0) + 1;
  }

  console.log('\n=== Team Ratings ===');
  for (const season of Object.keys(ratingsBySeason).sort()) {
    console.log(`Season ${season}: ${ratingsBySeason[Number(season)]} team ratings`);
  }

  // Summary
  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');

  const dkCount = byProvider['DraftKings']?.withSpread || 0;
  const bovadaCount = byProvider['Bovada']?.withSpread || 0;
  const espnCount = byProvider['ESPN BET']?.withSpread || 0;

  console.log(`DraftKings lines: ${dkCount}`);
  console.log(`Bovada lines: ${bovadaCount}`);
  console.log(`ESPN BET lines (CBBD): ${espnCount}`);
  console.log(`\nTotal for backtest (DK + Bovada): ${dkCount + bovadaCount}`);
}

check().catch(console.error);
