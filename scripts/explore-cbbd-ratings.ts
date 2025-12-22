/**
 * Explore CBBD ratings endpoints to understand data availability
 */

import { getCBBDApiClient, getCBBDAPIUsage } from '../src/lib/api/cbbd-api';

async function run() {
  const client = getCBBDApiClient();

  console.log('========================================');
  console.log('  Exploring CBBD Ratings Data');
  console.log('========================================\n');

  // Check adjusted ratings for 2024 season
  console.log('Fetching 2024 adjusted ratings...');
  try {
    const ratings = await client.getAdjustedRatings(2024);
    console.log(`Total teams with ratings: ${ratings.length}`);

    if (ratings.length > 0) {
      console.log('\nSample rating:');
      console.log(JSON.stringify(ratings[0], null, 2));

      console.log('\nTop 10 by net rating:');
      const sorted = [...ratings].sort((a, b) => b.netRating - a.netRating);
      for (let i = 0; i < Math.min(10, sorted.length); i++) {
        const r = sorted[i];
        console.log(`  ${i + 1}. ${r.team}: Off ${r.offensiveRating.toFixed(1)}, Def ${r.defensiveRating.toFixed(1)}, Net ${r.netRating.toFixed(1)}`);
      }
    }
  } catch (error: any) {
    console.log(`Error fetching adjusted ratings: ${error.message}`);
  }

  // Check SRS ratings
  console.log('\n----------------------------------------');
  console.log('Fetching 2024 SRS ratings...');
  try {
    const srs = await client.getSRSRatings(2024);
    console.log(`Total teams with SRS: ${srs.length}`);

    if (srs.length > 0) {
      console.log('\nSample SRS:');
      console.log(JSON.stringify(srs[0], null, 2));
    }
  } catch (error: any) {
    console.log(`Error fetching SRS: ${error.message}`);
  }

  // Check available endpoints for weekly data
  console.log('\n----------------------------------------');
  console.log('Testing potential weekly endpoints...');

  // Try a few potential endpoints
  const potentialEndpoints = [
    '/ratings/adjusted?week=10',
    '/ratings/sp',
    '/ratings/weekly',
  ];

  for (const endpoint of potentialEndpoints) {
    try {
      const url = `https://api.collegebasketballdata.com${endpoint}&season=2024`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${process.env.CFBD_API_KEY}`,
          'Accept': 'application/json',
        },
      });
      console.log(`  ${endpoint}: ${response.status} ${response.statusText}`);
      if (response.ok) {
        const data = await response.json();
        console.log(`    Sample: ${JSON.stringify(data).slice(0, 200)}...`);
      }
    } catch (error: any) {
      console.log(`  ${endpoint}: Error - ${error.message}`);
    }
  }

  // Usage stats
  console.log('\n========================================');
  console.log('  API Usage');
  console.log('========================================');
  console.log(getCBBDAPIUsage());
}

run().catch(console.error);
