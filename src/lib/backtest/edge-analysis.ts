/**
 * Detailed analysis of edge performance patterns
 * Goal: Understand why 3-5 point edges outperform larger edges
 */

import { HistoricalGame } from './historical-data';
import { calculateHistoricalEdges, DEFAULT_WEIGHTS } from './ensemble-model';

interface EdgeAnalysis {
  edgeRange: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  // Characteristics
  avgAbsMarketSpread: number;
  avgModelConfidence: number;
  homeVsAwayBreakdown: {
    homeBets: number;
    homeWins: number;
    homeWinRate: number;
    awayBets: number;
    awayWins: number;
    awayWinRate: number;
  };
  favoriteVsDogBreakdown: {
    favoriteBets: number;
    favoriteWins: number;
    favoriteWinRate: number;
    dogBets: number;
    dogWins: number;
    dogWinRate: number;
  };
  spreadRangeBreakdown: {
    smallSpread: { games: number; winRate: number }; // 0-7
    mediumSpread: { games: number; winRate: number }; // 7-14
    largeSpread: { games: number; winRate: number }; // 14+
  };
  modelAgreementBreakdown: {
    allAgree: { games: number; winRate: number };
    someDisagree: { games: number; winRate: number };
  };
}

export function analyzeEdgePerformance(
  games: HistoricalGame[]
): EdgeAnalysis[] {
  const results = calculateHistoricalEdges(games, DEFAULT_WEIGHTS);

  const edgeRanges = [
    { label: '0-1 pts', min: 0, max: 1 },
    { label: '1-2 pts', min: 1, max: 2 },
    { label: '2-3 pts', min: 2, max: 3 },
    { label: '3-4 pts', min: 3, max: 4 },
    { label: '4-5 pts', min: 4, max: 5 },
    { label: '5-7 pts', min: 5, max: 7 },
    { label: '7-10 pts', min: 7, max: 10 },
    { label: '10+ pts', min: 10, max: Infinity },
  ];

  const analyses: EdgeAnalysis[] = [];

  for (const range of edgeRanges) {
    const rangeResults = results.filter(r => {
      const absEdge = Math.abs(r.edge);
      return absEdge >= range.min && absEdge < range.max;
    });

    if (rangeResults.length === 0) continue;

    const decided = rangeResults.filter(r => r.actualResult !== 'push');
    const wins = decided.filter(r => r.actualResult === 'win').length;
    const losses = decided.filter(r => r.actualResult === 'loss').length;
    const winRate = decided.length > 0 ? wins / decided.length : 0;
    const roi = decided.length > 0
      ? ((wins * 100 - losses * 110) / (decided.length * 110)) * 100
      : 0;

    // Home vs Away breakdown
    const homeBets = rangeResults.filter(r => r.recommendedSide === 'home');
    const homeWins = homeBets.filter(r => r.actualResult === 'win').length;
    const awayBets = rangeResults.filter(r => r.recommendedSide === 'away');
    const awayWins = awayBets.filter(r => r.actualResult === 'win').length;

    // Favorite vs Dog breakdown (based on market spread)
    const favoriteBets = rangeResults.filter(r => {
      const isBettingFavorite = (r.recommendedSide === 'home' && r.game.closingSpread! < 0) ||
                                 (r.recommendedSide === 'away' && r.game.closingSpread! > 0);
      return isBettingFavorite;
    });
    const favoriteWins = favoriteBets.filter(r => r.actualResult === 'win').length;
    const dogBets = rangeResults.filter(r => {
      const isBettingDog = (r.recommendedSide === 'home' && r.game.closingSpread! >= 0) ||
                           (r.recommendedSide === 'away' && r.game.closingSpread! <= 0);
      return isBettingDog;
    });
    const dogWins = dogBets.filter(r => r.actualResult === 'win').length;

    // Spread range breakdown
    const smallSpreadGames = rangeResults.filter(r => Math.abs(r.game.closingSpread!) <= 7);
    const smallSpreadWins = smallSpreadGames.filter(r => r.actualResult === 'win').length;
    const mediumSpreadGames = rangeResults.filter(r =>
      Math.abs(r.game.closingSpread!) > 7 && Math.abs(r.game.closingSpread!) <= 14
    );
    const mediumSpreadWins = mediumSpreadGames.filter(r => r.actualResult === 'win').length;
    const largeSpreadGames = rangeResults.filter(r => Math.abs(r.game.closingSpread!) > 14);
    const largeSpreadWins = largeSpreadGames.filter(r => r.actualResult === 'win').length;

    // Model agreement breakdown
    const allAgree = rangeResults.filter(r => r.projection.confidence === 'high');
    const allAgreeWins = allAgree.filter(r => r.actualResult === 'win').length;
    const someDisagree = rangeResults.filter(r => r.projection.confidence !== 'high');
    const someDisagreeWins = someDisagree.filter(r => r.actualResult === 'win').length;

    // Calculate averages
    const avgAbsMarketSpread = rangeResults.reduce((sum, r) =>
      sum + Math.abs(r.game.closingSpread!), 0) / rangeResults.length;

    const confidenceScores = { high: 3, medium: 2, low: 1 };
    const avgModelConfidence = rangeResults.reduce((sum, r) =>
      sum + confidenceScores[r.projection.confidence], 0) / rangeResults.length;

    analyses.push({
      edgeRange: range.label,
      games: rangeResults.length,
      wins,
      losses,
      winRate: Math.round(winRate * 1000) / 10,
      roi: Math.round(roi * 100) / 100,
      avgAbsMarketSpread: Math.round(avgAbsMarketSpread * 10) / 10,
      avgModelConfidence: Math.round(avgModelConfidence * 100) / 100,
      homeVsAwayBreakdown: {
        homeBets: homeBets.length,
        homeWins,
        homeWinRate: homeBets.length > 0 ? Math.round((homeWins / homeBets.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0,
        awayBets: awayBets.length,
        awayWins,
        awayWinRate: awayBets.length > 0 ? Math.round((awayWins / awayBets.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0,
      },
      favoriteVsDogBreakdown: {
        favoriteBets: favoriteBets.length,
        favoriteWins,
        favoriteWinRate: favoriteBets.length > 0 ? Math.round((favoriteWins / favoriteBets.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0,
        dogBets: dogBets.length,
        dogWins,
        dogWinRate: dogBets.length > 0 ? Math.round((dogWins / dogBets.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0,
      },
      spreadRangeBreakdown: {
        smallSpread: {
          games: smallSpreadGames.length,
          winRate: smallSpreadGames.length > 0 ? Math.round((smallSpreadWins / smallSpreadGames.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0
        },
        mediumSpread: {
          games: mediumSpreadGames.length,
          winRate: mediumSpreadGames.length > 0 ? Math.round((mediumSpreadWins / mediumSpreadGames.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0
        },
        largeSpread: {
          games: largeSpreadGames.length,
          winRate: largeSpreadGames.length > 0 ? Math.round((largeSpreadWins / largeSpreadGames.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0
        },
      },
      modelAgreementBreakdown: {
        allAgree: {
          games: allAgree.length,
          winRate: allAgree.length > 0 ? Math.round((allAgreeWins / allAgree.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0
        },
        someDisagree: {
          games: someDisagree.length,
          winRate: someDisagree.length > 0 ? Math.round((someDisagreeWins / someDisagree.filter(r => r.actualResult !== 'push').length) * 1000) / 10 : 0
        },
      },
    });
  }

  return analyses;
}

/**
 * Analyze what component (Elo, SP+, PPA) is driving large edges
 */
export function analyzeEdgeComponents(games: HistoricalGame[]): {
  largeEdgeCharacteristics: {
    avgEloDiff: number;
    avgSpDiff: number;
    avgPpaDiff: number;
    missingDataRate: number;
  };
  smallEdgeCharacteristics: {
    avgEloDiff: number;
    avgSpDiff: number;
    avgPpaDiff: number;
    missingDataRate: number;
  };
} {
  const results = calculateHistoricalEdges(games, DEFAULT_WEIGHTS);

  const largeEdgeGames = results.filter(r => Math.abs(r.edge) >= 7);
  const smallEdgeGames = results.filter(r => Math.abs(r.edge) >= 2 && Math.abs(r.edge) < 5);

  const analyzeGroup = (group: typeof results) => {
    let totalEloDiff = 0;
    let totalSpDiff = 0;
    let totalPpaDiff = 0;
    let eloCount = 0;
    let spCount = 0;
    let ppaCount = 0;
    let missingCount = 0;

    for (const r of group) {
      const game = r.game;
      const comp = r.projection.components;

      if (comp.eloSpread !== null) {
        totalEloDiff += Math.abs(comp.eloSpread - (game.closingSpread || 0));
        eloCount++;
      }
      if (comp.spSpread !== null) {
        totalSpDiff += Math.abs(comp.spSpread - (game.closingSpread || 0));
        spCount++;
      }
      if (comp.ppaSpread !== null) {
        totalPpaDiff += Math.abs(comp.ppaSpread - (game.closingSpread || 0));
        ppaCount++;
      }

      // Check for missing data
      if (game.homeSpPlus === null || game.awaySpPlus === null ||
          game.homePPA === null || game.awayPPA === null) {
        missingCount++;
      }
    }

    return {
      avgEloDiff: eloCount > 0 ? Math.round((totalEloDiff / eloCount) * 10) / 10 : 0,
      avgSpDiff: spCount > 0 ? Math.round((totalSpDiff / spCount) * 10) / 10 : 0,
      avgPpaDiff: ppaCount > 0 ? Math.round((totalPpaDiff / ppaCount) * 10) / 10 : 0,
      missingDataRate: Math.round((missingCount / group.length) * 1000) / 10,
    };
  };

  return {
    largeEdgeCharacteristics: analyzeGroup(largeEdgeGames),
    smallEdgeCharacteristics: analyzeGroup(smallEdgeGames),
  };
}

/**
 * Format analysis for display
 */
export function formatEdgeAnalysis(analyses: EdgeAnalysis[]): string {
  let report = '## Edge Performance Analysis\n\n';

  report += '### Performance by Edge Range\n\n';
  report += '| Edge Range | Games | W-L | Win% | ROI | Avg Spread |\n';
  report += '|------------|-------|-----|------|-----|------------|\n';

  for (const a of analyses) {
    report += `| ${a.edgeRange} | ${a.games} | ${a.wins}-${a.losses} | ${a.winRate}% | ${a.roi}% | ${a.avgAbsMarketSpread} |\n`;
  }

  report += '\n### Home vs Away Performance\n\n';
  report += '| Edge Range | Home Bets | Home Win% | Away Bets | Away Win% |\n';
  report += '|------------|-----------|-----------|-----------|----------|\n';

  for (const a of analyses) {
    report += `| ${a.edgeRange} | ${a.homeVsAwayBreakdown.homeBets} | ${a.homeVsAwayBreakdown.homeWinRate}% | ${a.homeVsAwayBreakdown.awayBets} | ${a.homeVsAwayBreakdown.awayWinRate}% |\n`;
  }

  report += '\n### Favorite vs Dog Performance\n\n';
  report += '| Edge Range | Fav Bets | Fav Win% | Dog Bets | Dog Win% |\n';
  report += '|------------|----------|----------|----------|----------|\n';

  for (const a of analyses) {
    report += `| ${a.edgeRange} | ${a.favoriteVsDogBreakdown.favoriteBets} | ${a.favoriteVsDogBreakdown.favoriteWinRate}% | ${a.favoriteVsDogBreakdown.dogBets} | ${a.favoriteVsDogBreakdown.dogWinRate}% |\n`;
  }

  report += '\n### Performance by Market Spread Size\n\n';
  report += '| Edge Range | Small (0-7) | Medium (7-14) | Large (14+) |\n';
  report += '|------------|-------------|---------------|-------------|\n';

  for (const a of analyses) {
    report += `| ${a.edgeRange} | ${a.spreadRangeBreakdown.smallSpread.games} @ ${a.spreadRangeBreakdown.smallSpread.winRate}% | ${a.spreadRangeBreakdown.mediumSpread.games} @ ${a.spreadRangeBreakdown.mediumSpread.winRate}% | ${a.spreadRangeBreakdown.largeSpread.games} @ ${a.spreadRangeBreakdown.largeSpread.winRate}% |\n`;
  }

  report += '\n### Model Agreement\n\n';
  report += '| Edge Range | All Agree (Games/Win%) | Some Disagree (Games/Win%) |\n';
  report += '|------------|------------------------|----------------------------|\n';

  for (const a of analyses) {
    report += `| ${a.edgeRange} | ${a.modelAgreementBreakdown.allAgree.games} @ ${a.modelAgreementBreakdown.allAgree.winRate}% | ${a.modelAgreementBreakdown.someDisagree.games} @ ${a.modelAgreementBreakdown.someDisagree.winRate}% |\n`;
  }

  return report;
}
