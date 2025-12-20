/**
 * Debug CFBD team ID matching - check type conversion
 */
import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const cfbd = getCFBDApiClient();

async function debug() {
  console.log('=== Debug CFBD Team ID Type Mismatch ===\n');

  // Get all our teams with cfbd_team_id
  const { data: ourTeams } = await supabase
    .from('teams')
    .select('id, name, cfbd_team_id')
    .not('cfbd_team_id', 'is', null);

  // Build set with both string and number versions
  const ourCfbdIdsAsNumbers = new Set<number>();
  for (const t of ourTeams || []) {
    ourCfbdIdsAsNumbers.add(parseInt(t.cfbd_team_id, 10));
  }
  console.log(`Our DB has ${ourCfbdIdsAsNumbers.size} unique cfbd_team_id values (as numbers)`);

  // Get FBS teams from CFBD API
  const cfbdTeams = await cfbd.getTeams();
  console.log(`CFBD API returned ${cfbdTeams.length} FBS teams\n`);

  // Check matches with proper type conversion
  let matched = 0;
  const unmatched: string[] = [];

  for (const cfbdTeam of cfbdTeams) {
    if (ourCfbdIdsAsNumbers.has(cfbdTeam.id)) {
      matched++;
    } else {
      unmatched.push(`${cfbdTeam.school} (ID: ${cfbdTeam.id})`);
    }
  }

  console.log(`Matches with type conversion: ${matched}/${cfbdTeams.length}`);

  if (unmatched.length > 0 && unmatched.length <= 20) {
    console.log('\nUnmatched CFBD teams:');
    for (const t of unmatched) {
      console.log(`  - ${t}`);
    }
  }

  // Show sample matches
  console.log('\nSample matches:');
  for (const cfbdTeam of cfbdTeams.slice(0, 10)) {
    const ourTeam = ourTeams?.find(t => parseInt(t.cfbd_team_id, 10) === cfbdTeam.id);
    if (ourTeam) {
      console.log(`  CFBD "${cfbdTeam.school}" (${cfbdTeam.id}) -> Our "${ourTeam.name}"`);
    }
  }
}

debug().catch(console.error);
