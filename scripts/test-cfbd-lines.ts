/**
 * Test CFBD lines endpoint to understand price data
 */
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const client = getCFBDApiClient();

async function testLines() {
  console.log('Testing CFBD lines endpoint...\n');

  // Get sample lines from 2024 week 5
  const lines = await client.getBettingLines(2024, 5, 'regular');

  console.log(`Found ${lines.length} games with lines\n`);

  // Find DraftKings lines
  let dkCount = 0;
  for (const game of lines.slice(0, 5)) {
    console.log(`${game.awayTeam} @ ${game.homeTeam}:`);

    for (const line of game.lines || []) {
      if (line.provider === 'DraftKings') {
        dkCount++;
        console.log('  DraftKings:');
        console.log(`    spread: ${line.spread} (open: ${line.spreadOpen})`);
        console.log(`    total: ${line.overUnder} (open: ${line.overUnderOpen})`);
        console.log(`    homeMoneyline: ${line.homeMoneyline}`);
        console.log(`    awayMoneyline: ${line.awayMoneyline}`);
        console.log(`    Full line object:`, JSON.stringify(line, null, 2));
      }
    }
    console.log('');
  }

  // Check if spread prices are available
  console.log('\n=== Checking for spread prices ===');
  let hasSpreadPrices = 0;
  let noSpreadPrices = 0;

  for (const game of lines) {
    for (const line of game.lines || []) {
      if (line.provider === 'DraftKings') {
        // Check what price fields exist
        const lineObj = line as unknown as Record<string, unknown>;
        const priceFields = Object.keys(lineObj).filter(k =>
          k.toLowerCase().includes('price') ||
          k.toLowerCase().includes('vig') ||
          k.toLowerCase().includes('juice') ||
          k.toLowerCase().includes('odds')
        );

        if (priceFields.length > 0) {
          hasSpreadPrices++;
          if (hasSpreadPrices === 1) {
            console.log('Price-related fields found:', priceFields);
          }
        } else {
          noSpreadPrices++;
        }
      }
    }
  }

  console.log(`Games with price fields: ${hasSpreadPrices}`);
  console.log(`Games without price fields: ${noSpreadPrices}`);
}

testLines().catch(console.error);
