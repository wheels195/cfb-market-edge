/**
 * Fix Unmatched Team Mappings
 *
 * Directly inserts mappings from Odds API names to team_id
 * for the 10 teams that were failing due to name string mismatches.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Mappings discovered via ILIKE search
const DIRECT_MAPPINGS: Array<{ oddsApiName: string; teamId: string; cbbdName: string }> = [
  {
    oddsApiName: 'Queens University Royals',
    teamId: '813b28db-bb33-4501-af6e-5ea22197c812',
    cbbdName: 'Queens University',
  },
  {
    oddsApiName: 'Maryland-Eastern Shore Hawks',
    teamId: '147fd816-4a5b-41b3-b29a-d118eb692366',
    cbbdName: 'Maryland Eastern Shore',
  },
  {
    oddsApiName: "Florida Int'l Golden Panthers",
    teamId: 'ec3f61dc-d37e-4040-b209-0eadee1abc7e',
    cbbdName: 'Florida International',
  },
  {
    oddsApiName: 'St. Thomas (MN) Tommies',
    teamId: '5ee9f14c-64b1-41eb-9e7b-d6d6855cef48',
    cbbdName: 'St. Thomas-Minnesota',
  },
  {
    oddsApiName: 'Seattle Redhawks',
    teamId: '9d1ade87-4df1-45e9-bd9a-d443520e471f',
    cbbdName: 'Seattle U',
  },
  {
    oddsApiName: 'Omaha Mavericks',
    teamId: '2ed84bae-4691-4dd6-bc13-6ea2a0763fbc',
    cbbdName: 'Omaha',
  },
  {
    oddsApiName: 'IUPUI Jaguars',
    teamId: '50e3faf2-2fa0-4f73-9407-cb3e4617274c',
    cbbdName: 'IU Indianapolis',
  },
  {
    oddsApiName: 'Appalachian St Mountaineers',
    teamId: 'c8cc0065-da54-499a-8c78-769bc81846f8',
    cbbdName: 'App State',
  },
  {
    oddsApiName: "Hawai'i Rainbow Warriors",
    teamId: '3b33d9ee-1362-4bf7-9512-b250927ce61d',
    cbbdName: "Hawai'i",
  },
];

// Texas A&M-Commerce Lions - not found in CBBD (likely not D1 or different conference)

async function run() {
  console.log('Inserting direct team mappings...\n');

  let inserted = 0;
  let failed = 0;

  for (const mapping of DIRECT_MAPPINGS) {
    const { error } = await supabase
      .from('cbb_team_name_mappings')
      .upsert({
        source_name: mapping.oddsApiName,
        source_type: 'odds_api',
        team_id: mapping.teamId,
      }, { onConflict: 'source_name,source_type' });

    if (error) {
      console.log(`✗ Failed: ${mapping.oddsApiName} → ${mapping.cbbdName}`);
      console.log(`  Error: ${error.message}`);
      failed++;
    } else {
      console.log(`✓ ${mapping.oddsApiName} → ${mapping.cbbdName} (${mapping.teamId})`);
      inserted++;
    }
  }

  // Also update odds_api_name on cbb_teams for direct lookup
  console.log('\nUpdating odds_api_name on cbb_teams...');
  for (const mapping of DIRECT_MAPPINGS) {
    const { error } = await supabase
      .from('cbb_teams')
      .update({ odds_api_name: mapping.oddsApiName })
      .eq('id', mapping.teamId);

    if (error) {
      console.log(`  ✗ Failed to update ${mapping.cbbdName}: ${error.message}`);
    } else {
      console.log(`  ✓ Updated ${mapping.cbbdName}`);
    }
  }

  // Mark unmatched as resolved
  console.log('\nMarking unmatched teams as resolved...');
  const oddsApiNames = DIRECT_MAPPINGS.map(m => m.oddsApiName);
  const { error: resolveError } = await supabase
    .from('cbb_unmatched_team_names')
    .update({ resolved: true })
    .in('team_name', oddsApiNames);

  if (resolveError) {
    console.log(`  Error: ${resolveError.message}`);
  } else {
    console.log(`  ✓ Marked ${oddsApiNames.length} as resolved`);
  }

  console.log(`\n========================================`);
  console.log(`  Summary`);
  console.log(`========================================`);
  console.log(`Mappings inserted: ${inserted}`);
  console.log(`Mappings failed: ${failed}`);
  console.log(`Not in CBBD: Texas A&M-Commerce Lions`);
}

run().catch(console.error);
