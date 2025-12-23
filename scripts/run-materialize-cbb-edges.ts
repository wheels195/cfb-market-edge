/**
 * Run CBB materialize edges job
 */

import { materializeCbbEdges } from '../src/lib/cbb/jobs/materialize-edges';

async function main() {
  console.log('Running CBB materialize edges...\n');
  const result = await materializeCbbEdges();
  console.log('\nResult:', result);
}

main().catch(console.error);
