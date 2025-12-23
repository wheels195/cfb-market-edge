/**
 * CBB Quick Backtest - Test Various Criteria
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ELITE = ['Big 12', 'SEC', 'Big Ten'];
const HIGH = ['Big East', 'ACC', 'Mountain West'];
const MID = ['Atlantic 10', 'West Coast', 'American Athletic', 'Missouri Valley', 'Mid-American', 'Sun Belt', 'Pac-12'];

const CONF_BONUS: Record<string, number> = {
  'Big 12': 12, 'SEC': 11, 'Big Ten': 9,
  'Big East': 7, 'ACC': 5, 'Mountain West': 5,
  'Atlantic 10': 4, 'West Coast': 3, 'American Athletic': 2,
  'Missouri Valley': 1, 'Mid-American': 0, 'Sun Belt': 0, 'Pac-12': 2,
};

interface Game {
  homeConf: string | null;
  awayConf: string | null;
  homeRating: number;
  awayRating: number;
  marketSpread: number;
  homeScore: number;
  awayScore: number;
  season: number;
}

async function loadGames(): Promise<Game[]> {
  const { data: teams } = await supabase.from('cbb_teams').select('id, conference');
  const teamConf = new Map<string, string>();
  for (const t of teams || []) {
    if (t.conference) teamConf.set(t.id, t.conference);
  }

  const { data: ratings } = await supabase.from('cbb_elo_snapshots').select('team_id, season, elo');
  const ratingMap = new Map<string, number>();
  for (const r of ratings || []) {
    ratingMap.set(`${r.team_id}-${r.season}`, r.elo);
  }

  const { data: games } = await supabase
    .from('cbb_games')
    .select(`id, season, home_team_id, away_team_id, home_score, away_score, cbb_betting_lines(spread_home)`)
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .gte('season', 2022)
    .lte('season', 2025);

  const result: Game[] = [];
  for (const g of games || []) {
    const lines = g.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    if (!line?.spread_home) continue;

    const hc = teamConf.get(g.home_team_id) || null;
    const ac = teamConf.get(g.away_team_id) || null;
    const hr = (ratingMap.get(`${g.home_team_id}-${g.season}`) || 0) + (CONF_BONUS[hc || ''] || 0);
    const ar = (ratingMap.get(`${g.away_team_id}-${g.season}`) || 0) + (CONF_BONUS[ac || ''] || 0);

    result.push({
      homeConf: hc, awayConf: ac,
      homeRating: hr, awayRating: ar,
      marketSpread: line.spread_home,
      homeScore: g.home_score, awayScore: g.away_score,
      season: g.season,
    });
  }
  return result;
}

function backtest(games: Game[], cfg: {
  minSpread: number; maxSpread: number;
  minEdge: number; maxEdge?: number;
  confs: string[];
  favOnly: boolean; dogOnly: boolean;
}): { bets: number; wins: number; roi: number } {
  let wins = 0, losses = 0;

  for (const g of games) {
    const modelSpread = g.awayRating - g.homeRating - 7.4;
    const spreadSize = Math.abs(g.marketSpread);
    if (spreadSize < cfg.minSpread || spreadSize > cfg.maxSpread) continue;

    const homeFav = g.marketSpread < 0;
    const favConf = homeFav ? g.homeConf : g.awayConf;
    if (!cfg.confs.includes(favConf || '')) continue;

    const edge = g.marketSpread - modelSpread;
    const absEdge = Math.abs(edge);
    if (absEdge < cfg.minEdge) continue;
    if (cfg.maxEdge && absEdge > cfg.maxEdge) continue;

    const betHome = edge > 0;
    const bettingFav = (betHome && homeFav) || (!betHome && !homeFav);
    if (cfg.favOnly && !bettingFav) continue;
    if (cfg.dogOnly && bettingFav) continue;

    const margin = g.homeScore - g.awayScore;
    const cover = betHome ? margin + g.marketSpread : -margin - g.marketSpread;
    if (cover > 0) wins++;
    else if (cover < 0) losses++;
  }

  const total = wins + losses;
  const profit = wins * 0.909 - losses;
  return { bets: total, wins, roi: total > 0 ? profit / total : 0 };
}

async function main() {
  console.log('Loading games...');
  const games = await loadGames();
  console.log(`Loaded ${games.length} games with lines\n`);

  const allConfs = [...ELITE, ...HIGH];
  const withMid = [...allConfs, ...MID];

  const tests = [
    // Current
    { name: 'CURRENT: Fav 7-14 Edge≥3', minSpread: 7, maxSpread: 14, minEdge: 3, confs: allConfs, favOnly: true, dogOnly: false },

    // Spread variations
    { name: 'Fav 5-14 Edge≥3', minSpread: 5, maxSpread: 14, minEdge: 3, confs: allConfs, favOnly: true, dogOnly: false },
    { name: 'Fav 5-18 Edge≥3', minSpread: 5, maxSpread: 18, minEdge: 3, confs: allConfs, favOnly: true, dogOnly: false },
    { name: 'Fav 5-20 Edge≥3', minSpread: 5, maxSpread: 20, minEdge: 3, confs: allConfs, favOnly: true, dogOnly: false },
    { name: 'Fav 3-20 Edge≥3', minSpread: 3, maxSpread: 20, minEdge: 3, confs: allConfs, favOnly: true, dogOnly: false },

    // Edge variations
    { name: 'Fav 7-14 Edge≥2.5', minSpread: 7, maxSpread: 14, minEdge: 2.5, confs: allConfs, favOnly: true, dogOnly: false },
    { name: 'Fav 7-14 Edge≥2', minSpread: 7, maxSpread: 14, minEdge: 2, confs: allConfs, favOnly: true, dogOnly: false },
    { name: 'Fav 5-18 Edge≥2.5', minSpread: 5, maxSpread: 18, minEdge: 2.5, confs: allConfs, favOnly: true, dogOnly: false },
    { name: 'Fav 5-18 Edge≥2', minSpread: 5, maxSpread: 18, minEdge: 2, confs: allConfs, favOnly: true, dogOnly: false },

    // +Mid tier
    { name: '+Mid: Fav 7-14 Edge≥3', minSpread: 7, maxSpread: 14, minEdge: 3, confs: withMid, favOnly: true, dogOnly: false },
    { name: '+Mid: Fav 5-18 Edge≥2.5', minSpread: 5, maxSpread: 18, minEdge: 2.5, confs: withMid, favOnly: true, dogOnly: false },

    // Underdog strategies
    { name: 'DOG: 7-14 Edge≥3', minSpread: 7, maxSpread: 14, minEdge: 3, confs: allConfs, favOnly: false, dogOnly: true },
    { name: 'DOG: 10+ Edge≥3', minSpread: 10, maxSpread: 40, minEdge: 3, confs: allConfs, favOnly: false, dogOnly: true },
    { name: 'DOG: 10+ Edge 2.5-5', minSpread: 10, maxSpread: 40, minEdge: 2.5, maxEdge: 5, confs: allConfs, favOnly: false, dogOnly: true },

    // Both sides
    { name: 'BOTH: 5-18 Edge≥3', minSpread: 5, maxSpread: 18, minEdge: 3, confs: allConfs, favOnly: false, dogOnly: false },
    { name: 'BOTH: 5-18 Edge≥2.5', minSpread: 5, maxSpread: 18, minEdge: 2.5, confs: allConfs, favOnly: false, dogOnly: false },
  ];

  const results: { name: string; bets: number; wins: number; winPct: number; roi: number }[] = [];

  for (const t of tests) {
    const r = backtest(games, t);
    const winPct = r.bets > 0 ? (r.wins / r.bets) * 100 : 0;
    results.push({ name: t.name, bets: r.bets, wins: r.wins, winPct, roi: r.roi * 100 });
  }

  results.sort((a, b) => b.roi - a.roi);

  console.log('=== Results by ROI ===\n');
  console.log('Strategy'.padEnd(35) + 'Bets'.padStart(7) + 'Wins'.padStart(7) + 'Win%'.padStart(8) + 'ROI'.padStart(9));
  console.log('-'.repeat(66));

  for (const r of results) {
    const roiStr = (r.roi >= 0 ? '+' : '') + r.roi.toFixed(1) + '%';
    console.log(
      r.name.padEnd(35) +
      r.bets.toString().padStart(7) +
      r.wins.toString().padStart(7) +
      (r.winPct.toFixed(1) + '%').padStart(8) +
      roiStr.padStart(9)
    );
  }

  // Year-by-year for top 3
  console.log('\n=== Year-by-Year for Top 3 ===\n');
  const top3Names = results.slice(0, 3).map(r => r.name);
  const top3Configs = tests.filter(t => top3Names.includes(t.name));

  for (const cfg of top3Configs) {
    console.log(cfg.name + ':');
    for (const season of [2022, 2023, 2024, 2025]) {
      const seasonGames = games.filter(g => g.season === season);
      const r = backtest(seasonGames, cfg);
      const winPct = r.bets > 0 ? ((r.wins / r.bets) * 100).toFixed(1) : '0.0';
      const roiPct = (r.roi * 100).toFixed(1);
      console.log(`  ${season}: ${r.bets} bets, ${winPct}% win, ${r.roi >= 0 ? '+' : ''}${roiPct}% ROI`);
    }
    console.log('');
  }
}

main().catch(console.error);
