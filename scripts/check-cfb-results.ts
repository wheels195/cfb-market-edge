/**
 * Check CFB production model results
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function run() {
  console.log('CFB Production Model Results\n');

  // Check game_predictions
  const { data, error } = await supabase
    .from('game_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No predictions found');
    return;
  }

  let wins = 0, losses = 0, pushes = 0, pending = 0;
  let totalPL = 0;

  console.log('Recent Predictions:');
  console.log('-'.repeat(80));

  for (const p of data) {
    const outcome = p.outcome || 'PENDING';
    if (outcome === 'WIN') {
      wins++;
      totalPL += 0.909; // -110 payout
    } else if (outcome === 'LOSS') {
      losses++;
      totalPL -= 1;
    } else if (outcome === 'PUSH') {
      pushes++;
    } else {
      pending++;
    }

    const homeTeam = (p.home_team || 'Unknown').substring(0, 20).padEnd(20);
    const awayTeam = (p.away_team || 'Unknown').substring(0, 20).padEnd(20);
    console.log(`${homeTeam} vs ${awayTeam} | ${outcome.padEnd(7)}`);
  }

  console.log('-'.repeat(80));
  console.log('\nSummary:');
  console.log(`  Wins: ${wins}`);
  console.log(`  Losses: ${losses}`);
  console.log(`  Pushes: ${pushes}`);
  console.log(`  Pending: ${pending}`);

  const decided = wins + losses;
  if (decided > 0) {
    const winRate = (wins / decided * 100).toFixed(1);
    const roi = (totalPL / decided * 100).toFixed(1);
    console.log(`\n  Win Rate: ${winRate}%`);
    console.log(`  P/L: ${totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)} units`);
    console.log(`  ROI: ${roi}%`);
  }
}

run().catch(console.error);
