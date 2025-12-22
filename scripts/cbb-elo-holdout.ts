/**
 * CBB Elo Holdout Test
 *
 * PROPER METHODOLOGY:
 * - Grid search parameters ONLY on 2022-2023 (train)
 * - Test ONLY on 2024 (holdout)
 * - This reveals true out-of-sample performance
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

interface Game {
  id: string;
  season: number;
  start_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  spread_t60: number | null;
}

// ============ ELO SYSTEM ============

class CbbEloSystem {
  private ratings: Map<string, number> = new Map();
  private gamesPlayed: Map<string, number> = new Map();
  private seasonGames: Map<string, number> = new Map();

  private readonly BASE_ELO = 1500;
  private readonly K_FACTOR = 20;
  private readonly MARGIN_MULTIPLIER = 0.8;
  private readonly SEASON_CARRYOVER = 0.6;

  public ELO_DIVISOR = 25;
  public HOME_ADVANTAGE = 3.5;

  resetSeason(season: number) {
    for (const [team, elo] of this.ratings) {
      const regressed = this.BASE_ELO + (elo - this.BASE_ELO) * this.SEASON_CARRYOVER;
      this.ratings.set(team, regressed);
    }
    this.seasonGames.clear();
  }

  getElo(team: string): number {
    if (!this.ratings.has(team)) {
      this.ratings.set(team, this.BASE_ELO);
      this.gamesPlayed.set(team, 0);
      this.seasonGames.set(team, 0);
    }
    return this.ratings.get(team)!;
  }

  getSeasonGames(team: string): number {
    return this.seasonGames.get(team) || 0;
  }

  getSpread(homeTeam: string, awayTeam: string): number {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);
    return (awayElo - homeElo) / this.ELO_DIVISOR - this.HOME_ADVANTAGE;
  }

  update(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number) {
    const homeElo = this.getElo(homeTeam);
    const awayElo = this.getElo(awayTeam);

    const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo - this.HOME_ADVANTAGE * this.ELO_DIVISOR / 10) / 400));
    const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
    const margin = Math.abs(homeScore - awayScore);
    const marginMult = Math.log(margin + 1) * this.MARGIN_MULTIPLIER;
    const change = this.K_FACTOR * marginMult * (actualHome - expectedHome);

    this.ratings.set(homeTeam, homeElo + change);
    this.ratings.set(awayTeam, awayElo - change);

    this.gamesPlayed.set(homeTeam, (this.gamesPlayed.get(homeTeam) || 0) + 1);
    this.gamesPlayed.set(awayTeam, (this.gamesPlayed.get(awayTeam) || 0) + 1);
    this.seasonGames.set(homeTeam, (this.seasonGames.get(homeTeam) || 0) + 1);
    this.seasonGames.set(awayTeam, (this.seasonGames.get(awayTeam) || 0) + 1);
  }
}

// ============ DATA LOADING ============

async function fetchAllRows<T>(
  table: string,
  select: string,
  filters?: { column: string; op: string; value: any }[]
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (filters) {
      for (const f of filters) {
        if (f.op === 'not.is') query = query.not(f.column, 'is', f.value);
      }
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      hasMore = false;
    } else {
      allData = allData.concat(data as T[]);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }
  return allData;
}

async function loadGames(): Promise<Game[]> {
  const games = await fetchAllRows<any>(
    'cbb_games',
    'id, season, start_date, home_team_id, away_team_id, home_score, away_score',
    [{ column: 'home_score', op: 'not.is', value: null }]
  );

  const lines = await fetchAllRows<any>(
    'cbb_betting_lines',
    'game_id, spread_t60',
    [{ column: 'spread_t60', op: 'not.is', value: null }]
  );

  const lineMap = new Map<string, number>();
  for (const l of lines) lineMap.set(l.game_id, l.spread_t60);

  return games
    .filter((g: any) => g.away_team_id)
    .map((g: any) => ({
      id: g.id,
      season: g.season,
      start_date: g.start_date,
      home_team_id: g.home_team_id,
      away_team_id: g.away_team_id,
      home_score: g.home_score,
      away_score: g.away_score,
      spread_t60: lineMap.get(g.id) ?? null,
    }))
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
}

// ============ BACKTEST ============

interface BetResult {
  won: boolean;
  profit: number;
  edge: number;
}

interface Config {
  minEdge: number;
  maxEdge: number;
  minGames: number;
  eloDivisor: number;
  hfa: number;
}

function runBacktest(games: Game[], config: Config): BetResult[] {
  const elo = new CbbEloSystem();
  elo.ELO_DIVISOR = config.eloDivisor;
  elo.HOME_ADVANTAGE = config.hfa;

  const results: BetResult[] = [];
  let currentSeason = 0;

  for (const game of games) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) elo.resetSeason(game.season);
      currentSeason = game.season;
    }

    if (game.spread_t60 !== null) {
      const homeGames = elo.getSeasonGames(game.home_team_id);
      const awayGames = elo.getSeasonGames(game.away_team_id);

      if (homeGames >= config.minGames && awayGames >= config.minGames) {
        const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_t60;
        const edge = marketSpread - modelSpread;
        const absEdge = Math.abs(edge);

        if (absEdge >= config.minEdge && absEdge <= config.maxEdge) {
          const betSide = edge > 0 ? 'home' : 'away';
          const actualMargin = game.home_score - game.away_score;

          let won: boolean;
          if (betSide === 'home') {
            won = actualMargin > -marketSpread;
          } else {
            won = actualMargin < -marketSpread;
          }

          if (actualMargin !== -marketSpread) {
            results.push({
              won,
              profit: won ? 0.91 : -1.0,
              edge: absEdge,
            });
          }
        }
      }
    }

    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  return results;
}

// Run on subset of games (train or test years only)
function runOnYears(allGames: Game[], years: number[], config: Config): BetResult[] {
  const elo = new CbbEloSystem();
  elo.ELO_DIVISOR = config.eloDivisor;
  elo.HOME_ADVANTAGE = config.hfa;

  const results: BetResult[] = [];
  let currentSeason = 0;

  for (const game of allGames) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) elo.resetSeason(game.season);
      currentSeason = game.season;
    }

    // Only collect bets for specified years
    const collectBets = years.includes(game.season);

    if (collectBets && game.spread_t60 !== null) {
      const homeGames = elo.getSeasonGames(game.home_team_id);
      const awayGames = elo.getSeasonGames(game.away_team_id);

      if (homeGames >= config.minGames && awayGames >= config.minGames) {
        const modelSpread = elo.getSpread(game.home_team_id, game.away_team_id);
        const marketSpread = game.spread_t60;
        const edge = marketSpread - modelSpread;
        const absEdge = Math.abs(edge);

        if (absEdge >= config.minEdge && absEdge <= config.maxEdge) {
          const betSide = edge > 0 ? 'home' : 'away';
          const actualMargin = game.home_score - game.away_score;

          let won: boolean;
          if (betSide === 'home') {
            won = actualMargin > -marketSpread;
          } else {
            won = actualMargin < -marketSpread;
          }

          if (actualMargin !== -marketSpread) {
            results.push({
              won,
              profit: won ? 0.91 : -1.0,
              edge: absEdge,
            });
          }
        }
      }
    }

    // Always update Elo (to build ratings even for holdout period)
    elo.update(game.home_team_id, game.away_team_id, game.home_score, game.away_score);
  }

  return results;
}

function summarize(results: BetResult[]): { bets: number; winRate: number; roi: number } {
  if (results.length === 0) return { bets: 0, winRate: 0, roi: 0 };
  const wins = results.filter(r => r.won).length;
  const profit = results.reduce((sum, r) => sum + r.profit, 0);
  return {
    bets: results.length,
    winRate: wins / results.length,
    roi: profit / results.length,
  };
}

// ============ MAIN ============

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            CBB ELO HOLDOUT TEST                                    ║');
  console.log('║  Train: 2022-2023 | Holdout: 2024                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const games = await loadGames();
  const testGames = games.filter(g => g.season >= 2022 && g.season <= 2024);

  console.log(`Total games: ${testGames.length}`);
  console.log(`With T-60 spreads: ${testGames.filter(g => g.spread_t60 !== null).length}\n`);

  // Grid search ONLY on training data (2022-2023)
  console.log('=== GRID SEARCH ON TRAIN DATA (2022-2023 ONLY) ===\n');

  const divisors = [20, 25, 30, 35];
  const hfas = [2.5, 3.0, 3.5, 4.0];
  const minGamesOptions = [5, 7, 10];
  const edgeRanges = [
    { min: 2, max: 5 },
    { min: 2.5, max: 5 },
    { min: 3, max: 6 },
    { min: 3, max: 7 },
  ];

  interface SearchResult {
    config: Config;
    trainBets: number;
    trainWinRate: number;
    trainRoi: number;
  }

  const searchResults: SearchResult[] = [];

  for (const divisor of divisors) {
    for (const hfa of hfas) {
      for (const minGames of minGamesOptions) {
        for (const edge of edgeRanges) {
          const config: Config = {
            minEdge: edge.min,
            maxEdge: edge.max,
            minGames,
            eloDivisor: divisor,
            hfa,
          };

          // Run ONLY on 2022-2023
          const trainResults = runOnYears(testGames, [2022, 2023], config);
          const train = summarize(trainResults);

          if (train.bets >= 100) {
            searchResults.push({
              config,
              trainBets: train.bets,
              trainWinRate: train.winRate,
              trainRoi: train.roi,
            });
          }
        }
      }
    }
  }

  // Sort by train ROI
  searchResults.sort((a, b) => b.trainRoi - a.trainRoi);

  console.log('Top 5 Configs (by Train ROI):\n');
  console.log('  Divisor  HFA  MinGm  Edge    TrainBets  TrainWin%  TrainROI');
  console.log('  ' + '─'.repeat(60));

  for (let i = 0; i < Math.min(5, searchResults.length); i++) {
    const r = searchResults[i];
    const edgeStr = `${r.config.minEdge}-${r.config.maxEdge}`.padEnd(5);
    console.log(
      `  ${r.config.eloDivisor.toString().padStart(5)}  ` +
      `${r.config.hfa.toFixed(1).padStart(4)}  ` +
      `${r.config.minGames.toString().padStart(5)}  ` +
      `${edgeStr}  ` +
      `${r.trainBets.toString().padStart(8)}  ` +
      `${(r.trainWinRate * 100).toFixed(1).padStart(9)}%  ` +
      `${(r.trainRoi * 100).toFixed(1).padStart(7)}%`
    );
  }

  // Now test the TOP config on holdout (2024)
  console.log('\n\n' + '═'.repeat(70));
  console.log('                    HOLDOUT TEST (2024)');
  console.log('═'.repeat(70) + '\n');

  const best = searchResults[0];
  console.log(`Testing best config: Divisor=${best.config.eloDivisor}, HFA=${best.config.hfa}, MinGames=${best.config.minGames}, Edge=${best.config.minEdge}-${best.config.maxEdge}\n`);

  // Run on holdout (2024 only)
  const holdoutResults = runOnYears(testGames, [2024], best.config);
  const holdout = summarize(holdoutResults);

  console.log('Results:');
  console.log(`  Train (2022-2023): ${best.trainBets} bets, ${(best.trainWinRate * 100).toFixed(1)}% win, ${(best.trainRoi * 100).toFixed(1)}% ROI`);
  console.log(`  Holdout (2024):    ${holdout.bets} bets, ${(holdout.winRate * 100).toFixed(1)}% win, ${(holdout.roi * 100).toFixed(1)}% ROI`);

  const decay = best.trainRoi - holdout.roi;
  console.log(`\n  Performance Decay: ${(decay * 100).toFixed(1)} percentage points`);

  // Test multiple configs on holdout
  console.log('\n\nAll Top 5 Configs on Holdout:\n');
  console.log('  Rank  TrainROI  HoldoutROI  Decay');
  console.log('  ' + '─'.repeat(40));

  for (let i = 0; i < Math.min(5, searchResults.length); i++) {
    const r = searchResults[i];
    const holdout = summarize(runOnYears(testGames, [2024], r.config));
    const decay = r.trainRoi - holdout.roi;
    console.log(
      `  ${(i + 1).toString().padStart(4)}  ` +
      `${(r.trainRoi * 100).toFixed(1).padStart(7)}%  ` +
      `${(holdout.roi * 100).toFixed(1).padStart(10)}%  ` +
      `${(decay * 100).toFixed(1).padStart(5)}pp`
    );
  }

  // Assessment
  console.log('\n\n' + '═'.repeat(70));
  console.log('                        ASSESSMENT');
  console.log('═'.repeat(70) + '\n');

  const holdoutRoi = holdout.roi;

  if (holdoutRoi > 0.02) {
    console.log('✅ REAL EDGE: Holdout shows > +2% ROI');
    console.log('   The in-season Elo model has predictive value!');
  } else if (holdoutRoi > -0.02) {
    console.log('⚠️ MARGINAL: Holdout near break-even');
    console.log('   Some signal exists but may not overcome friction.');
  } else if (holdoutRoi > -0.045) {
    console.log('⚠️ NO EDGE: Holdout shows loss but better than random');
    console.log('   Train performance was likely overfitting.');
  } else {
    console.log('❌ OVERFIT: Holdout significantly worse than train');
    console.log('   The train "edge" was noise, not signal.');
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
