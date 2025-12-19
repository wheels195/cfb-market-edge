/**
 * Sync Weekly Elo Ratings from CFBD
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const CFBD_API_KEY = process.env.CFBD_API_KEY || '';

async function cfbdFetch(endpoint: string) {
  const response = await fetch(`https://apinext.collegefootballdata.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${CFBD_API_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) return null;
  return response.json();
}

async function main() {
  console.log('=== SYNC WEEKLY ELO RATINGS ===\n');

  // Clear existing
  await supabase.from('cfbd_elo_ratings').delete().gte('season', 2022);

  const allRows: any[] = [];

  for (const season of [2022, 2023, 2024]) {
    console.log(`Season ${season}:`);

    for (let week = 1; week <= 16; week++) {
      const data = await cfbdFetch(`/ratings/elo?year=${season}&week=${week}`);
      if (!data || data.length === 0) continue;

      for (const r of data) {
        allRows.push({
          season,
          week,
          team_name: r.team,
          conference: r.conference,
          elo: r.elo,
        });
      }

      process.stdout.write(`  Week ${week}: ${data.length} teams\r`);
      await new Promise(r => setTimeout(r, 50));
    }
    console.log(`  Synced 16 weeks                    `);
  }

  console.log(`\nTotal records: ${allRows.length}`);

  // Insert in batches
  for (let i = 0; i < allRows.length; i += 500) {
    const batch = allRows.slice(i, i + 500);
    const { error } = await supabase.from('cfbd_elo_ratings').insert(batch);
    if (error) console.log(`Error: ${error.message}`);
    process.stdout.write(`\rInserted ${Math.min(i + 500, allRows.length)}/${allRows.length}`);
  }

  console.log('\n\n=== SYNC COMPLETE ===');
}

main().catch(console.error);
