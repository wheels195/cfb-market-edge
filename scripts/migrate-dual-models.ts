/**
 * Migration: Set up dual model architecture
 *
 * 1. Create SPREADS_MARKET_ANCHORED_V1 model version
 * 2. Create SPREADS_ELO_RAW_V1 model version
 * 3. Add elo_disagreement_points column to edges table
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== DUAL MODEL MIGRATION ===\n');

  // 1. Create SPREADS_MARKET_ANCHORED_V1
  console.log('Creating SPREADS_MARKET_ANCHORED_V1...');

  // Check if already exists
  const { data: existingMarket } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'SPREADS_MARKET_ANCHORED_V1')
    .single();

  if (existingMarket) {
    console.log('Already exists:', existingMarket.id);
  } else {
    const { data: marketModel, error: marketError } = await supabase
      .from('model_versions')
      .insert({
        name: 'SPREADS_MARKET_ANCHORED_V1',
        description: 'Market-calibrated spread model. Uses market line as baseline with learned adjustments for conference strength, injuries, line movement, weather, and situational factors.',
        config: {
          type: 'market_anchored',
          coefficients: {
            conferenceStrengthWeight: 0.4,
            homeFieldBase: 2.5,
            bowlGameHFAReduction: 2.0,
            injuryQBWeight: 3.0,
            injuryNonQBWeight: 0.5,
            sharpLineMovementWeight: 0.5,
            weatherWindWeight: 0.3,
            weatherPrecipWeight: 1.5,
            maxReasonableEdge: 5.0,
            minActionableEdge: 2.0,
          },
          calibration: {
            profitableEdgeMin: 2.5,
            profitableEdgeMax: 5.0,
          },
        },
      })
      .select()
      .single();

    if (marketError) {
      console.error('Error creating SPREADS_MARKET_ANCHORED_V1:', marketError);
    } else {
      console.log('Created:', marketModel?.id);
    }
  }

  // 2. Create SPREADS_ELO_RAW_V1
  console.log('\nCreating SPREADS_ELO_RAW_V1...');

  const { data: existingElo } = await supabase
    .from('model_versions')
    .select('id')
    .eq('name', 'SPREADS_ELO_RAW_V1')
    .single();

  if (existingElo) {
    console.log('Already exists:', existingElo.id);
  } else {
    const { data: eloModel, error: eloError } = await supabase
      .from('model_versions')
      .insert({
        name: 'SPREADS_ELO_RAW_V1',
        description: 'Pure Elo-based spread model. Uses team Elo ratings directly to compute expected spread. Secondary model for sanity checks and disagreement warnings.',
        config: {
          type: 'elo_raw',
          formula: 'spread = (home_elo - away_elo) / 25 + hfa',
          homeFieldAdvantage: 2.5,
          eloSource: 'team_elo_snapshots',
          weekCap: 13, // Use week 13 max for bowl season
        },
      })
      .select()
      .single();

    if (eloError) {
      console.error('Error creating SPREADS_ELO_RAW_V1:', eloError);
    } else {
      console.log('Created:', eloModel?.id);
    }
  }

  // 3. Check if elo_disagreement_points column exists
  console.log('\nChecking edges table for elo_disagreement_points...');
  const { data: testEdge } = await supabase
    .from('edges')
    .select('*')
    .limit(1);

  if (testEdge && testEdge[0] && !('elo_disagreement_points' in testEdge[0])) {
    console.log('Column does not exist. Please run this SQL in Supabase:');
    console.log(`
ALTER TABLE edges
ADD COLUMN IF NOT EXISTS elo_disagreement_points NUMERIC;

COMMENT ON COLUMN edges.elo_disagreement_points IS
  'Difference between market-anchored model and pure Elo model. Large values indicate potential model disagreement.';
`);
  } else {
    console.log('Column already exists or table empty.');
  }

  // 4. List final model versions
  console.log('\n=== FINAL MODEL VERSIONS ===');
  const { data: allVersions } = await supabase
    .from('model_versions')
    .select('id, name, description')
    .in('name', ['SPREADS_MARKET_ANCHORED_V1', 'SPREADS_ELO_RAW_V1']);

  for (const v of allVersions || []) {
    console.log(`\n${v.name}:`);
    console.log(`  ID: ${v.id}`);
    console.log(`  ${v.description}`);
  }
}

main().catch(console.error);
