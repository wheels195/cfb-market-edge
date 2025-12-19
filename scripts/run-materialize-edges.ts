/**
 * Run edge materialization
 */

import { materializeEdges } from '../src/lib/jobs/materialize-edges';

async function main() {
  console.log('=== MATERIALIZING EDGES ===\n');

  const result = await materializeEdges();

  console.log(`\nEdges created: ${result.edgesCreated}`);
  console.log(`Edges updated: ${result.edgesUpdated}`);
  console.log(`Coverage passed: ${result.oddsCoverage?.passed}`);

  if (result.errors && result.errors.length > 0) {
    console.log(`\nErrors (first 5):`);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  }
}

main().catch(console.error);
