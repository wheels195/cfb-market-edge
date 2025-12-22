import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function main() {
  // Check Elo coverage by season
  const { data: eloCoverage } = await supabase
    .from('team_elo_snapshots')
    .select('season')
    .in('season', [2022, 2023, 2024]);

  const eloByYear: Record<number, number> = {};
  for (const row of eloCoverage || []) {
    eloByYear[row.season] = (eloByYear[row.season] || 0) + 1;
  }
  console.log('Elo snapshots by season:', eloByYear);

  // Check SP+ coverage by season
  const { data: spCoverage } = await supabase
    .from('advanced_team_ratings')
    .select('season')
    .not('sp_overall', 'is', null)
    .in('season', [2022, 2023, 2024]);

  const spByYear: Record<number, number> = {};
  for (const row of spCoverage || []) {
    spByYear[row.season] = (spByYear[row.season] || 0) + 1;
  }
  console.log('SP+ ratings by season:', spByYear);

  // Check PPA coverage by season
  const { data: ppaCoverage } = await supabase
    .from('advanced_team_ratings')
    .select('season')
    .not('off_ppa', 'is', null)
    .in('season', [2022, 2023, 2024]);

  const ppaByYear: Record<number, number> = {};
  for (const row of ppaCoverage || []) {
    ppaByYear[row.season] = (ppaByYear[row.season] || 0) + 1;
  }
  console.log('PPA ratings by season:', ppaByYear);

  // Check T-60 matches by season from file
  const t60Data = JSON.parse(fs.readFileSync('/home/wheel/cfb-market-edge/data/t60-spreads.json', 'utf-8'));

  // Get games to match seasons
  const { data: games } = await supabase
    .from('cfbd_betting_lines')
    .select('cfbd_game_id, season')
    .in('season', [2022, 2023, 2024]);

  const gameSeasons: Record<number, number> = {};
  for (const g of games || []) {
    gameSeasons[g.cfbd_game_id] = g.season;
  }

  const matchesBySeason: Record<number, number> = {};
  for (const t60 of t60Data) {
    if (t60.matched && t60.spread_t60 !== null) {
      const season = gameSeasons[t60.cfbd_game_id];
      if (season) {
        matchesBySeason[season] = (matchesBySeason[season] || 0) + 1;
      }
    }
  }
  console.log('T-60 matched games by season:', matchesBySeason);

  // Total games by season
  const gamesBySeason: Record<number, number> = {};
  for (const g of games || []) {
    gamesBySeason[g.season] = (gamesBySeason[g.season] || 0) + 1;
  }
  console.log('Total games by season:', gamesBySeason);
}

main().catch(console.error);
