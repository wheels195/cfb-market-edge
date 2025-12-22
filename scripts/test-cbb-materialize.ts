import { materializeCbbEdges } from '../src/lib/cbb/jobs/materialize-edges';

async function main() {
  console.log('Testing CBB materialize-edges job...\n');

  const result = await materializeCbbEdges();

  console.log('\n=== RESULTS ===');
  console.log(`Games processed: ${result.gamesProcessed}`);
  console.log(`Predictions written: ${result.predictionsWritten}`);
  console.log(`Qualifying bets: ${result.qualifyingBets}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  - ${err}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }
}

main().catch(console.error);
