/**
 * Run the optimized fast historical sync
 */
import { syncHistoricalFast, getEloSummaryFast } from '../src/lib/jobs/sync-historical-fast';

async function main() {
  console.log('Starting optimized historical sync...');
  console.log('Seasons: 2022, 2023, 2024, 2025\n');

  const result = await syncHistoricalFast([2022, 2023, 2024, 2025]);

  console.log('\n=== SYNC COMPLETE ===');
  console.log(`Time: ${result.timeSeconds} seconds`);
  console.log(`Seasons processed: ${result.seasonsProcessed}`);
  console.log(`Games processed: ${result.gamesProcessed}`);
  console.log(`Teams created: ${result.teamsCreated}`);
  console.log(`Events created: ${result.eventsCreated}`);
  console.log(`Results created: ${result.resultsCreated}`);
  console.log(`Ratings updated: ${result.ratingsUpdated}`);
  console.log(`API calls: ${result.apiCalls}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }

  // Show Elo summary
  console.log('\n=== 2024 SEASON ELO RANKINGS ===');
  const summary2024 = await getEloSummaryFast(2024);
  console.log('\nTop 15 Teams:');
  summary2024.topTeams.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.team}: ${t.rating} (${t.games} games)`);
  });

  console.log('\n=== 2025 SEASON ELO RANKINGS ===');
  const summary2025 = await getEloSummaryFast(2025);
  console.log('\nTop 15 Teams:');
  summary2025.topTeams.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.team}: ${t.rating} (${t.games} games)`);
  });

  console.log('\nRating spread:', summary2025.ratingSpread, 'points');
}

main().catch(console.error);
