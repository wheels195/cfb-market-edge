import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// The 10 unmatched teams from Odds API
const unmatchedTeams = [
  { oddsApi: 'Queens University Royals', search: ['Queens', 'Charlotte'] },
  { oddsApi: 'Maryland-Eastern Shore Hawks', search: ['Eastern Shore', 'Maryland-Eastern', 'UMES'] },
  { oddsApi: "Florida Int'l Golden Panthers", search: ['Florida Int', 'FIU', 'Florida International'] },
  { oddsApi: 'Texas A&M-Commerce Lions', search: ['Commerce', 'Texas A&M-Commerce', 'TAMUC'] },
  { oddsApi: 'St. Thomas (MN) Tommies', search: ['Thomas', 'St. Thomas', 'Saint Thomas'] },
  { oddsApi: 'Seattle Redhawks', search: ['Seattle'] },
  { oddsApi: 'Omaha Mavericks', search: ['Omaha', 'Nebraska-Omaha', 'UNO'] },
  { oddsApi: 'IUPUI Jaguars', search: ['IUPUI', 'Indiana-Purdue', 'Indianapolis'] },
  { oddsApi: 'Appalachian St Mountaineers', search: ['Appalachian', 'App State'] },
  { oddsApi: "Hawai'i Rainbow Warriors", search: ['Hawaii', 'Hawai'] },
];

async function run() {
  console.log('Searching for exact CBBD names for unmatched Odds API teams...\n');

  for (const team of unmatchedTeams) {
    console.log(`\n=== ${team.oddsApi} ===`);

    for (const term of team.search) {
      const { data, error } = await supabase
        .from('cbb_teams')
        .select('id, name, odds_api_name')
        .ilike('name', `%${term}%`)
        .limit(10);

      if (error) {
        console.log(`  Error searching '${term}': ${error.message}`);
        continue;
      }

      if (data && data.length > 0) {
        console.log(`  Search '${term}':`);
        for (const t of data) {
          console.log(`    → "${t.name}" (odds_api_name: ${t.odds_api_name || 'N/A'}, id: ${t.id})`);
        }
      }
    }
  }
}

run().catch(console.error);
