/**
 * Compare CFBD API Elo vs Database Elo
 */

import { createClient } from '@supabase/supabase-js';
import { getCFBDApiClient } from '../src/lib/api/cfbd-api';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const cfbd = getCFBDApiClient();

async function main() {
  const teams = ['Alabama', 'Ohio State', 'Georgia', 'Texas', 'Oregon', 'Penn State', 'Notre Dame', 'Michigan'];

  console.log('=== CFBD API Elo vs Database Elo (2025) ===\n');
  console.log('Team            | Wk  | CFBD Elo | DB Elo   | Match?');
  console.log('----------------|-----|----------|----------|-------');

  for (const teamName of teams) {
    // Get team ID from DB
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('name', teamName)
      .single();

    if (!team) {
      console.log(`${teamName.padEnd(16)}| Team not found`);
      continue;
    }

    // Check weeks 0, 13, 14, 15
    for (const week of [0, 13, 14, 15]) {
      // Get from CFBD
      let cfbdElo: number | null = null;
      try {
        const eloData = await cfbd.getEloRatings(2025, teamName, week);
        if (eloData.length > 0) {
          cfbdElo = eloData[0].elo;
        }
      } catch (e) {
        cfbdElo = null;
      }

      // Get from DB
      const { data: dbData } = await supabase
        .from('team_elo_snapshots')
        .select('elo')
        .eq('team_id', team.id)
        .eq('season', 2025)
        .eq('week', week)
        .single();

      const dbElo = dbData?.elo || null;
      const match = cfbdElo === dbElo ? '✓' : '✗ DIFF';

      console.log(
        `${teamName.padEnd(16)}| ${String(week).padStart(3)} | ${String(cfbdElo ?? 'N/A').padStart(8)} | ${String(dbElo ?? 'N/A').padStart(8)} | ${match}`
      );
    }
    console.log('');
  }
}

main().catch(console.error);
