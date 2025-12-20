/**
 * Check CFBD provider coverage
 */
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const client = getCFBDApiClient();

async function analyzeProviderCoverage() {
  console.log('Analyzing CFBD line data coverage for 2024 season...\n');

  const providerStats: Record<string, { games: number; spreads: number; totals: number; opens: number }> = {};
  let totalGames = 0;

  // Check 2024 regular season
  for (const week of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]) {
    try {
      const lines = await client.getBettingLines(2024, week, 'regular');

      for (const game of lines) {
        // Only count FBS games
        if (game.homeClassification !== 'fbs' && game.awayClassification !== 'fbs') continue;

        totalGames++;

        for (const line of game.lines || []) {
          const provider = line.provider || 'unknown';
          if (!providerStats[provider]) {
            providerStats[provider] = { games: 0, spreads: 0, totals: 0, opens: 0 };
          }

          providerStats[provider].games++;
          if (line.spread !== null && line.spread !== undefined) providerStats[provider].spreads++;
          if (line.overUnder !== null && line.overUnder !== undefined) providerStats[provider].totals++;
          if (line.spreadOpen !== null || line.overUnderOpen !== null) providerStats[provider].opens++;
        }
      }
    } catch {
      // Week might not exist
    }
  }

  console.log('Total FBS games analyzed:', totalGames);
  console.log('\nProvider breakdown:');
  console.log('Provider                           | Games | Spreads | Totals | Opens');
  console.log('-----------------------------------|-------|---------|--------|------');

  for (const [provider, stats] of Object.entries(providerStats).sort((a, b) => b[1].games - a[1].games)) {
    console.log(
      provider.padEnd(35) + '|' +
      String(stats.games).padStart(6) + ' |' +
      String(stats.spreads).padStart(8) + ' |' +
      String(stats.totals).padStart(7) + ' |' +
      String(stats.opens).padStart(5)
    );
  }

  // Check if FanDuel exists in any data
  console.log('\nSearching for FanDuel in 2022-2024...');
  let foundFanDuel = false;

  for (const season of [2022, 2023, 2024]) {
    for (const week of [1, 5, 10]) {
      try {
        const lines = await client.getBettingLines(season, week, 'regular');
        for (const game of lines) {
          for (const line of game.lines || []) {
            if (line.provider?.toLowerCase().includes('fanduel')) {
              console.log(`Found FanDuel: ${season} week ${week} - ${line.provider}`);
              foundFanDuel = true;
            }
          }
        }
      } catch {
        // skip
      }
    }
  }

  if (!foundFanDuel) {
    console.log('FanDuel NOT FOUND in CFBD data');
  }

  // Check DraftKings data quality
  console.log('\nDraftKings sample (2024 week 5):');
  const week5 = await client.getBettingLines(2024, 5, 'regular');
  let dkSample = 0;
  for (const game of week5) {
    if (game.homeClassification !== 'fbs') continue;
    for (const line of game.lines || []) {
      if (line.provider === 'DraftKings' && dkSample < 3) {
        console.log(`  ${game.awayTeam} @ ${game.homeTeam}:`);
        console.log(`    spread: ${line.spread} (open: ${line.spreadOpen})`);
        console.log(`    total: ${line.overUnder} (open: ${line.overUnderOpen})`);
        dkSample++;
      }
    }
  }
}

analyzeProviderCoverage().catch(console.error);
