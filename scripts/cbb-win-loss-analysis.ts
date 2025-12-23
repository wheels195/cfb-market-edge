/**
 * Deep analysis of WINS vs LOSSES
 * Find patterns that predict successful bets
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Model parameters
const HOME_ADV = 7.4;
const LEARNING_RATE = 0.08;
const SEASON_DECAY = 0.7;

const CONF_RATING: Record<string, number> = {
  "Big 12": 12, "SEC": 11, "Big Ten": 9, "Big East": 7,
  "ACC": 5, "Mountain West": 5, "Atlantic 10": 4,
  "WCC": 3, "American Athletic": 3, "Missouri Valley": 2,
  "MAC": 1, "Sun Belt": 0, "Pac-12": 0,
  "Conference USA": -1, "WAC": -2, "Big West": -3,
  "Ohio Valley": -4, "Horizon League": -4, "Southern": -5,
  "CAA": -5, "Patriot League": -6, "Ivy League": -6,
  "Big South": -7, "Summit League": -8, "ASUN": -8,
  "Northeast": -10, "Southland": -11, "MEAC": -14, "SWAC": -16,
};

const teamRatings: Map<string, { rating: number; games: number }> = new Map();

function getConfRating(conf: string | null): number {
  if (!conf) return 0;
  return CONF_RATING[conf] ?? 0;
}

function getTeamRating(teamId: string): number {
  return teamRatings.get(teamId)?.rating ?? 0;
}

function getGamesPlayed(teamId: string): number {
  return teamRatings.get(teamId)?.games ?? 0;
}

function getTotalRating(teamId: string, conf: string | null): number {
  return getTeamRating(teamId) + getConfRating(conf);
}

function predictSpread(homeTeamId: string, awayTeamId: string, homeConf: string | null, awayConf: string | null): number {
  const homeRating = getTotalRating(homeTeamId, homeConf);
  const awayRating = getTotalRating(awayTeamId, awayConf);
  return awayRating - homeRating - HOME_ADV;
}

function updateRatings(homeTeamId: string, awayTeamId: string, homeConf: string | null, awayConf: string | null, homeScore: number, awayScore: number): void {
  const predicted = predictSpread(homeTeamId, awayTeamId, homeConf, awayConf);
  const actual = awayScore - homeScore;
  const error = actual - predicted;

  const homeData = teamRatings.get(homeTeamId) || { rating: 0, games: 0 };
  homeData.rating -= error * LEARNING_RATE;
  homeData.games += 1;
  teamRatings.set(homeTeamId, homeData);

  const awayData = teamRatings.get(awayTeamId) || { rating: 0, games: 0 };
  awayData.rating += error * LEARNING_RATE;
  awayData.games += 1;
  teamRatings.set(awayTeamId, awayData);
}

function resetSeason(): void {
  for (const [teamId, data] of teamRatings) {
    data.rating *= SEASON_DECAY;
    data.games = 0;
  }
}

// Conference tier
function getConfTier(conf: string | null): string {
  const rating = getConfRating(conf);
  if (rating >= 9) return 'elite';      // Big 12, SEC, Big Ten
  if (rating >= 5) return 'high';       // Big East, ACC, Mountain West
  if (rating >= 0) return 'mid';        // A-10, WCC, American, MVC, MAC, Sun Belt
  if (rating >= -6) return 'low';       // C-USA, WAC, Big West, OVC, etc.
  return 'bottom';                       // MEAC, SWAC, etc.
}

interface BetRecord {
  season: number;
  gameId: string;
  modelSpread: number;
  marketSpread: number;
  edge: number;
  absEdge: number;
  betSide: 'home' | 'away';
  isUnderdog: boolean;
  spreadSize: number;
  homeGames: number;
  awayGames: number;
  homeConf: string | null;
  awayConf: string | null;
  homeConfTier: string;
  awayConfTier: string;
  homeRating: number;
  awayRating: number;
  ratingDiff: number;
  confMatch: string;  // same, cross-tier, etc.
  actualMargin: number;
  covered: boolean;
  profit: number;
  weekOfSeason: number;
}

async function main() {
  console.log('=== CBB Win/Loss Deep Analysis ===\n');

  // Load teams
  const { data: teams } = await supabase
    .from('cbb_teams')
    .select('id, name, conference');

  const teamConf = new Map<string, string>();
  const teamName = new Map<string, string>();
  for (const t of teams || []) {
    teamConf.set(t.id, t.conference);
    teamName.set(t.id, t.name);
  }

  // Load games
  const { data: allGames } = await supabase
    .from('cbb_games')
    .select(`
      id, season, start_date,
      home_team_id, away_team_id,
      home_score, away_score,
      cbb_betting_lines (spread_home)
    `)
    .in('season', [2022, 2023, 2024, 2025])
    .or('home_score.neq.0,away_score.neq.0')
    .not('home_team_id', 'is', null)
    .not('away_team_id', 'is', null)
    .order('start_date', { ascending: true });

  console.log(`Loaded ${allGames?.length} games\n`);

  const records: BetRecord[] = [];
  let currentSeason = 0;
  let seasonStartDate: Date | null = null;

  for (const game of allGames || []) {
    if (game.season !== currentSeason) {
      if (currentSeason !== 0) resetSeason();
      currentSeason = game.season;
      seasonStartDate = new Date(game.start_date);
    }

    const lines = game.cbb_betting_lines as any;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const marketSpread = line?.spread_home;

    const homeConf = teamConf.get(game.home_team_id) || null;
    const awayConf = teamConf.get(game.away_team_id) || null;
    const homeGames = getGamesPlayed(game.home_team_id);
    const awayGames = getGamesPlayed(game.away_team_id);

    if (marketSpread !== null && marketSpread !== undefined) {
      const modelSpread = predictSpread(game.home_team_id, game.away_team_id, homeConf, awayConf);
      const edge = marketSpread - modelSpread;
      const absEdge = Math.abs(edge);
      const spreadSize = Math.abs(marketSpread);
      const betSide: 'home' | 'away' = edge > 0 ? 'home' : 'away';
      const isUnderdog = (betSide === 'home' && marketSpread > 0) || (betSide === 'away' && marketSpread < 0);

      const actualMargin = game.home_score - game.away_score;
      let covered: boolean;
      if (betSide === 'home') {
        covered = actualMargin + marketSpread > 0;
      } else {
        covered = -actualMargin - marketSpread > 0;
      }

      const homeConfTier = getConfTier(homeConf);
      const awayConfTier = getConfTier(awayConf);
      const homeRating = getTotalRating(game.home_team_id, homeConf);
      const awayRating = getTotalRating(game.away_team_id, awayConf);

      // Conference matchup type
      let confMatch: string;
      if (homeConf === awayConf) {
        confMatch = 'same-conf';
      } else if (homeConfTier === awayConfTier) {
        confMatch = 'same-tier';
      } else {
        confMatch = 'cross-tier';
      }

      // Week of season
      const gameDate = new Date(game.start_date);
      const weekOfSeason = Math.floor((gameDate.getTime() - (seasonStartDate?.getTime() || 0)) / (7 * 24 * 60 * 60 * 1000));

      records.push({
        season: game.season,
        gameId: game.id,
        modelSpread,
        marketSpread,
        edge,
        absEdge,
        betSide,
        isUnderdog,
        spreadSize,
        homeGames,
        awayGames,
        homeConf,
        awayConf,
        homeConfTier,
        awayConfTier,
        homeRating,
        awayRating,
        ratingDiff: Math.abs(homeRating - awayRating),
        confMatch,
        actualMargin,
        covered,
        profit: covered ? 0.91 : -1.0,
        weekOfSeason,
      });
    }

    updateRatings(game.home_team_id, game.away_team_id, homeConf, awayConf, game.home_score, game.away_score);
  }

  console.log(`Total bets to analyze: ${records.length}\n`);

  // Analysis helper
  function analyze(bets: BetRecord[], label: string, minBets = 30) {
    if (bets.length < minBets) return null;
    const wins = bets.filter(b => b.covered).length;
    const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0);
    const winRate = wins / bets.length;
    const roi = totalProfit / bets.length;
    return { label, bets: bets.length, wins, winRate, roi, profit: totalProfit };
  }

  function printAnalysis(result: ReturnType<typeof analyze>) {
    if (!result) return;
    const { label, bets, winRate, roi, profit } = result;
    const roiStr = roi >= 0 ? `+${(roi * 100).toFixed(1)}%` : `${(roi * 100).toFixed(1)}%`;
    const profitStr = profit >= 0 ? `+${profit.toFixed(1)}u` : `${profit.toFixed(1)}u`;
    console.log(`${label}: ${bets} bets, ${(winRate * 100).toFixed(1)}% win, ${roiStr} ROI, ${profitStr}`);
  }

  // ============================================
  // CONFERENCE MATCHUP ANALYSIS
  // ============================================
  console.log('=== BY CONFERENCE MATCHUP TYPE ===\n');

  const edge3 = records.filter(r => r.absEdge >= 3);

  printAnalysis(analyze(edge3.filter(r => r.confMatch === 'same-conf'), 'Same conference'));
  printAnalysis(analyze(edge3.filter(r => r.confMatch === 'same-tier'), 'Same tier (diff conf)'));
  printAnalysis(analyze(edge3.filter(r => r.confMatch === 'cross-tier'), 'Cross tier'));

  // ============================================
  // BETTING ELITE VS LOW TIER
  // ============================================
  console.log('\n=== WHEN BETTING TEAM BY TIER (edge 3+) ===\n');

  const betTeamTier = (r: BetRecord) => r.betSide === 'home' ? r.homeConfTier : r.awayConfTier;
  const oppTeamTier = (r: BetRecord) => r.betSide === 'home' ? r.awayConfTier : r.homeConfTier;

  for (const tier of ['elite', 'high', 'mid', 'low', 'bottom']) {
    printAnalysis(analyze(edge3.filter(r => betTeamTier(r) === tier), `Betting ${tier} tier team`));
  }

  console.log('\n=== TIER MATCHUPS (edge 3+) ===\n');

  // Elite vs lower tiers
  printAnalysis(analyze(edge3.filter(r => betTeamTier(r) === 'elite' && ['low', 'bottom'].includes(oppTeamTier(r))), 'Elite vs low/bottom'));
  printAnalysis(analyze(edge3.filter(r => betTeamTier(r) === 'high' && ['low', 'bottom'].includes(oppTeamTier(r))), 'High vs low/bottom'));
  printAnalysis(analyze(edge3.filter(r => ['low', 'bottom'].includes(betTeamTier(r)) && ['elite', 'high'].includes(oppTeamTier(r))), 'Low/bottom vs elite/high'));

  // ============================================
  // RATING DIFFERENCE ANALYSIS
  // ============================================
  console.log('\n=== BY RATING DIFFERENCE (edge 3+) ===\n');

  for (const [min, max] of [[0, 5], [5, 10], [10, 15], [15, 20], [20, 30], [30, 100]]) {
    printAnalysis(analyze(edge3.filter(r => r.ratingDiff >= min && r.ratingDiff < max), `Rating diff ${min}-${max}`));
  }

  // ============================================
  // WEEK OF SEASON
  // ============================================
  console.log('\n=== BY WEEK OF SEASON (edge 3+) ===\n');

  for (const [minWeek, maxWeek, label] of [
    [0, 4, 'Early (weeks 0-3)'],
    [4, 8, 'Nov-Dec (weeks 4-7)'],
    [8, 12, 'December (weeks 8-11)'],
    [12, 16, 'January (weeks 12-15)'],
    [16, 20, 'February (weeks 16-19)'],
    [20, 30, 'March+ (weeks 20+)'],
  ] as const) {
    printAnalysis(analyze(edge3.filter(r => r.weekOfSeason >= minWeek && r.weekOfSeason < maxWeek), label as string));
  }

  // ============================================
  // GAMES PLAYED COMBINATIONS
  // ============================================
  console.log('\n=== GAMES PLAYED ANALYSIS (edge 3+) ===\n');

  const minGames = (r: BetRecord) => Math.min(r.homeGames, r.awayGames);
  const maxGames = (r: BetRecord) => Math.max(r.homeGames, r.awayGames);

  printAnalysis(analyze(edge3.filter(r => minGames(r) < 5), 'One team <5 games'));
  printAnalysis(analyze(edge3.filter(r => minGames(r) >= 5 && minGames(r) < 10), 'Both 5-9 games'));
  printAnalysis(analyze(edge3.filter(r => minGames(r) >= 10 && minGames(r) < 15), 'Both 10-14 games'));
  printAnalysis(analyze(edge3.filter(r => minGames(r) >= 15), 'Both 15+ games'));

  // ============================================
  // MODEL CONFIDENCE (how far from 0 is model spread)
  // ============================================
  console.log('\n=== MODEL CONFIDENCE - ABS MODEL SPREAD (edge 3+) ===\n');

  for (const [min, max] of [[0, 5], [5, 10], [10, 15], [15, 20], [20, 100]]) {
    const modelConf = edge3.filter(r => Math.abs(r.modelSpread) >= min && Math.abs(r.modelSpread) < max);
    printAnalysis(analyze(modelConf, `Model spread ${min}-${max} pts`));
  }

  // ============================================
  // EDGE DIRECTION ANALYSIS
  // ============================================
  console.log('\n=== EDGE DIRECTION (model vs market) ===\n');

  // When model says team is better than market thinks
  printAnalysis(analyze(edge3.filter(r => r.betSide === 'home'), 'Betting home (model likes home more)'));
  printAnalysis(analyze(edge3.filter(r => r.betSide === 'away'), 'Betting away (model likes away more)'));

  // ============================================
  // COMBINED FILTERS - FIND THE EDGE
  // ============================================
  console.log('\n=== COMBINED FILTERS - SEARCHING FOR EDGE ===\n');

  const combos = [
    // Cross-tier games
    { name: 'Cross-tier, edge 5+', filter: (r: BetRecord) => r.confMatch === 'cross-tier' && r.absEdge >= 5 },
    { name: 'Cross-tier, edge 5+, underdog', filter: (r: BetRecord) => r.confMatch === 'cross-tier' && r.absEdge >= 5 && r.isUnderdog },
    { name: 'Cross-tier, edge 5+, favorite', filter: (r: BetRecord) => r.confMatch === 'cross-tier' && r.absEdge >= 5 && !r.isUnderdog },

    // Same conference
    { name: 'Same conf, edge 5+', filter: (r: BetRecord) => r.confMatch === 'same-conf' && r.absEdge >= 5 },
    { name: 'Same conf, edge 5+, underdog', filter: (r: BetRecord) => r.confMatch === 'same-conf' && r.absEdge >= 5 && r.isUnderdog },

    // Big mismatches where model disagrees
    { name: 'Rating diff 20+, edge 5+', filter: (r: BetRecord) => r.ratingDiff >= 20 && r.absEdge >= 5 },
    { name: 'Rating diff 20+, edge 5+, dog', filter: (r: BetRecord) => r.ratingDiff >= 20 && r.absEdge >= 5 && r.isUnderdog },

    // Later in season (more data)
    { name: 'Week 12+, edge 5+', filter: (r: BetRecord) => r.weekOfSeason >= 12 && r.absEdge >= 5 },
    { name: 'Week 12+, edge 5+, 10+ games', filter: (r: BetRecord) => r.weekOfSeason >= 12 && r.absEdge >= 5 && minGames(r) >= 10 },
    { name: 'Week 16+, edge 4+', filter: (r: BetRecord) => r.weekOfSeason >= 16 && r.absEdge >= 4 },

    // High model confidence
    { name: 'Model spread 15+, edge 4+', filter: (r: BetRecord) => Math.abs(r.modelSpread) >= 15 && r.absEdge >= 4 },
    { name: 'Model spread 15+, edge 5+', filter: (r: BetRecord) => Math.abs(r.modelSpread) >= 15 && r.absEdge >= 5 },

    // Small spreads (closer games)
    { name: 'Spread <7, edge 4+', filter: (r: BetRecord) => r.spreadSize < 7 && r.absEdge >= 4 },
    { name: 'Spread <7, edge 5+', filter: (r: BetRecord) => r.spreadSize < 7 && r.absEdge >= 5 },

    // Mid spreads
    { name: 'Spread 7-14, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= 3 },
    { name: 'Spread 7-14, edge 4+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= 4 },
    { name: 'Spread 7-14, edge 5+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= 5 },

    // Betting lower tier teams
    { name: 'Bet low/bottom tier, edge 5+', filter: (r: BetRecord) => ['low', 'bottom'].includes(betTeamTier(r)) && r.absEdge >= 5 },
    { name: 'Bet elite/high tier, edge 5+', filter: (r: BetRecord) => ['elite', 'high'].includes(betTeamTier(r)) && r.absEdge >= 5 },

    // Conference specific
    { name: 'One team elite conf, edge 5+', filter: (r: BetRecord) => (r.homeConfTier === 'elite' || r.awayConfTier === 'elite') && r.absEdge >= 5 },
    { name: 'No elite conf teams, edge 5+', filter: (r: BetRecord) => r.homeConfTier !== 'elite' && r.awayConfTier !== 'elite' && r.absEdge >= 5 },

    // Extreme edges
    { name: 'Edge 7+', filter: (r: BetRecord) => r.absEdge >= 7 },
    { name: 'Edge 8+', filter: (r: BetRecord) => r.absEdge >= 8 },
    { name: 'Edge 7+, week 8+', filter: (r: BetRecord) => r.absEdge >= 7 && r.weekOfSeason >= 8 },
    { name: 'Edge 7+, both 10+ games', filter: (r: BetRecord) => r.absEdge >= 7 && minGames(r) >= 10 },
  ];

  const results: Array<{ name: string; bets: number; winRate: number; roi: number; profit: number }> = [];

  for (const combo of combos) {
    const bets = records.filter(combo.filter);
    const result = analyze(bets, combo.name, 20);
    if (result) {
      results.push(result);
      printAnalysis(result);
    }
  }

  // ============================================
  // TOP STRATEGIES RANKED
  // ============================================
  console.log('\n=== TOP 15 STRATEGIES BY ROI (min 50 bets) ===\n');

  const ranked = results.filter(r => r.bets >= 50).sort((a, b) => b.roi - a.roi);
  for (const r of ranked.slice(0, 15)) {
    printAnalysis(r);
  }

  // ============================================
  // YEAR-BY-YEAR FOR TOP STRATEGIES
  // ============================================
  console.log('\n=== YEAR-BY-YEAR FOR PROMISING STRATEGIES ===\n');

  const promising = [
    { name: 'Spread 7-14, edge 3+', filter: (r: BetRecord) => r.spreadSize >= 7 && r.spreadSize < 14 && r.absEdge >= 3 },
    { name: 'Edge 7+', filter: (r: BetRecord) => r.absEdge >= 7 },
    { name: 'Week 12+, edge 5+', filter: (r: BetRecord) => r.weekOfSeason >= 12 && r.absEdge >= 5 },
  ];

  for (const strat of promising) {
    console.log(`\n${strat.name}:`);
    for (const season of [2022, 2023, 2024, 2025]) {
      const bets = records.filter(r => r.season === season && strat.filter(r));
      const result = analyze(bets, `  ${season}`, 10);
      if (result) printAnalysis(result);
    }
  }
}

main().catch(console.error);
