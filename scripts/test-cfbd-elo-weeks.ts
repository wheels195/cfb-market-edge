/**
 * Test CFBD Elo endpoint - compare values across weeks
 */
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const client = getCFBDApiClient();

async function testEloWeeks() {
  console.log('Comparing Elo values across weeks for select teams...\n');

  const teams = ['Alabama', 'Ohio State', 'Georgia', 'Oregon', 'Texas'];
  const weeks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  console.log('Team            | ' + weeks.map(w => `W${w}`.padStart(5)).join(' | '));
  console.log('-'.repeat(15) + '-+-' + weeks.map(() => '-----').join('-+-'));

  for (const team of teams) {
    const row = [team.padEnd(15)];

    for (const week of weeks) {
      try {
        const data = await client.getEloRatings(2024, undefined, week);
        const teamData = data.find(d => d.team === team);
        row.push(teamData ? String(teamData.elo).padStart(5) : '  N/A');
      } catch {
        row.push('  ERR');
      }
    }

    console.log(row.join(' | '));
  }

  console.log('\nObservations:');
  console.log('- Week 0 = preseason Elo (before any games)');
  console.log('- Week N = Elo AFTER week N games');
  console.log('- For game in week N, use week N-1 Elo as the "entering" rating');
}

testEloWeeks().catch(console.error);
