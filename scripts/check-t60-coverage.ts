import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface T60Entry {
  cfbd_game_id: number;
  spread_t60: number | null;
  matched: boolean;
}

async function main() {
  // Load T-60 spreads
  const t60Data: T60Entry[] = JSON.parse(
    fs.readFileSync('/home/wheel/cfb-market-edge/data/t60-spreads.json', 'utf-8')
  );

  const matchedT60 = t60Data.filter(t => t.matched && t.spread_t60 !== null);
  console.log('Total T-60 spreads matched:', matchedT60.length);

  // Get all games by season
  const { data: games } = await supabase
    .from('cfbd_betting_lines')
    .select('cfbd_game_id, season, spread_close')
    .in('season', [2022, 2023, 2024])
    .not('spread_close', 'is', null);

  const gameSeasonMap = new Map<number, number>();
  for (const g of games || []) {
    gameSeasonMap.set(g.cfbd_game_id, g.season);
  }

  const t60BySeason = { 2022: 0, 2023: 0, 2024: 0 };
  const totalBySeason = { 2022: 0, 2023: 0, 2024: 0 };

  for (const g of games || []) {
    totalBySeason[g.season as keyof typeof totalBySeason]++;
  }

  for (const t of matchedT60) {
    const season = gameSeasonMap.get(t.cfbd_game_id);
    if (season && season in t60BySeason) {
      t60BySeason[season as keyof typeof t60BySeason]++;
    }
  }

  console.log('\n=== T-60 Coverage by Season ===');
  console.log('| Season | Total Games | T-60 Matched | Coverage |');
  console.log('|--------|-------------|--------------|----------|');
  for (const s of [2022, 2023, 2024] as const) {
    const pct = totalBySeason[s] > 0 ? (t60BySeason[s] / totalBySeason[s] * 100).toFixed(1) : '0.0';
    console.log(`| ${s}   | ${String(totalBySeason[s]).padStart(11)} | ${String(t60BySeason[s]).padStart(12)} | ${pct.padStart(7)}% |`);
  }

  console.log('\nThis explains why bet counts differ by season.');
}

main().catch(console.error);
