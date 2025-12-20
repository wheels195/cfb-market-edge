/**
 * Test CFBD Elo endpoint to understand data structure
 */
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const client = getCFBDApiClient();

async function testElo() {
  console.log('Testing CFBD Elo endpoint...\n');

  // Test 1: Get all Elo ratings for 2024 season
  console.log('1. All teams, 2024 season:');
  const all2024 = await client.getEloRatings(2024);
  console.log(`   Found ${all2024.length} records`);
  console.log('   Sample:', JSON.stringify(all2024.slice(0, 3), null, 2));

  // Test 2: Get Elo for specific week
  console.log('\n2. Week 0 (preseason) 2024:');
  const week0 = await client.getEloRatings(2024, undefined, 0);
  console.log(`   Found ${week0.length} records`);
  console.log('   Sample:', JSON.stringify(week0.slice(0, 3), null, 2));

  // Test 3: Get Elo for week 5
  console.log('\n3. Week 5, 2024:');
  const week5 = await client.getEloRatings(2024, undefined, 5);
  console.log(`   Found ${week5.length} records`);
  console.log('   Sample:', JSON.stringify(week5.slice(0, 3), null, 2));

  // Test 4: Get Elo for specific team across weeks
  console.log('\n4. Alabama, 2024 (all weeks):');
  const alabama = await client.getEloRatings(2024, 'Alabama');
  console.log(`   Found ${alabama.length} records`);
  console.log('   All records:', JSON.stringify(alabama, null, 2));

  // Test 5: Check 2022 and 2023 availability
  console.log('\n5. Data availability:');
  for (const season of [2022, 2023, 2024]) {
    const data = await client.getEloRatings(season);
    const weeks = [...new Set(data.map(d => d.week))].sort((a, b) => (a ?? 0) - (b ?? 0));
    console.log(`   ${season}: ${data.length} records, weeks: ${weeks.join(', ')}`);
  }
}

testElo().catch(console.error);
