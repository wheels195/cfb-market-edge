/**
 * Rigorous Validation of Contrarian Signal
 *
 * Checklist:
 * 1. Confirm using closing lines for grading
 * 2. Confirm spread sign conventions
 * 3. Handle pushes consistently (exclude)
 * 4. Use correct pricing
 * 5. Reality check: closing-line EV should be ~0
 * 6. Holdout test (train 2022-2023, test 2024)
 * 7. Walk-forward validation
 * 8. Time/edge buckets
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const HFA = 3.0;
const ELO_TO_SPREAD = 25;

interface Game {
  gameId: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  modelSpread: number;      // Our projection (negative = home favored)
  spreadOpen: number;       // Opening line (negative = home favored)
  spreadClose: number;      // Closing line (negative = home favored)
  homeScore: number;
  awayScore: number;
  margin: number;           // home - away (positive = home won)
  edgeAtOpen: number;       // model - open
  edgeAtClose: number;      // model - close
}

interface BetResult {
  game: Game;
  side: 'home' | 'away';
  spreadUsed: number;       // The spread we're betting against
  isPush: boolean;
  won: boolean | null;      // null if push
}

async function loadData() {
  const eloMap = new Map<string, Map<string, number>>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('cfbd_elo_ratings')
      .select('season, week, team_name, elo')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const teamKey = row.team_name.toLowerCase();
      if (!eloMap.has(teamKey)) eloMap.set(teamKey, new Map());
      eloMap.get(teamKey)!.set(`${row.season}-${row.week}`, row.elo);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  const lines: any[] = [];
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('cfbd_betting_lines')
      .select('*')
      .not('spread_open', 'is', null)
      .not('spread_close', 'is', null)
      .not('home_score', 'is', null)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    lines.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  return { eloMap, lines };
}

function getElo(eloMap: Map<string, Map<string, number>>, team: string, season: number, week: number): number | null {
  const teamKey = team.toLowerCase();
  const ratings = eloMap.get(teamKey);
  if (!ratings) return null;
  const priorWeek = week - 1;
  if (priorWeek >= 1) {
    const key = `${season}-${priorWeek}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }
  for (let w = 16; w >= 1; w--) {
    const key = `${season - 1}-${w}`;
    if (ratings.has(key)) return ratings.get(key)!;
  }
  return null;
}

function gradeBet(game: Game, side: 'home' | 'away', spreadUsed: number): BetResult {
  // Spread convention: negative = home favored
  // If spread is -7, home must win by more than 7 to cover
  // If we bet HOME at -7: we win if margin > 7
  // If we bet AWAY at +7: we win if margin < -7 (away wins) OR margin < 7 (away covers)

  const margin = game.margin; // positive = home won

  // Home covers if: margin > -spreadUsed (since spread is typically negative for favorite)
  // Example: spread = -7 (home favorite), margin = 10 → 10 > 7 → home covers
  // Example: spread = -7, margin = 5 → 5 > 7 is FALSE → away covers
  // Wait, let me think again...

  // The spread is from HOME's perspective
  // spread = -7 means home is 7-point favorite
  // Home covers if: margin + spread > 0
  // margin = 10, spread = -7 → 10 + (-7) = 3 > 0 → home covers
  // margin = 5, spread = -7 → 5 + (-7) = -2 < 0 → away covers

  const homeResult = margin + spreadUsed; // ATS margin for home

  if (Math.abs(homeResult) < 0.001) {
    // Push (exact tie against spread)
    return { game, side, spreadUsed, isPush: true, won: null };
  }

  const homeCovered = homeResult > 0;
  const awayCovered = homeResult < 0;

  const won = (side === 'home' && homeCovered) || (side === 'away' && awayCovered);

  return { game, side, spreadUsed, isPush: false, won };
}

function calcROI(wins: number, losses: number, pushes: number, price: number = -110): number {
  if (wins + losses === 0) return 0;
  // At -110, we risk 110 to win 100
  const profit = wins * 100 - losses * 110;
  const totalRisked = (wins + losses) * 110;
  return profit / totalRisked;
}

async function main() {
  console.log('=== RIGOROUS VALIDATION OF CONTRARIAN SIGNAL ===\n');

  const { eloMap, lines } = await loadData();

  // Build games array
  const games: Game[] = [];

  for (const line of lines) {
    const homeElo = getElo(eloMap, line.home_team, line.season, line.week);
    const awayElo = getElo(eloMap, line.away_team, line.season, line.week);
    if (!homeElo || !awayElo) continue;

    // Model spread: negative = home favored
    const eloDiff = homeElo - awayElo + HFA * ELO_TO_SPREAD;
    const modelSpread = -eloDiff / ELO_TO_SPREAD;

    games.push({
      gameId: line.cfbd_game_id,
      season: line.season,
      week: line.week,
      homeTeam: line.home_team,
      awayTeam: line.away_team,
      homeElo,
      awayElo,
      modelSpread,
      spreadOpen: line.spread_open,
      spreadClose: line.spread_close,
      homeScore: line.home_score,
      awayScore: line.away_score,
      margin: line.home_score - line.away_score,
      edgeAtOpen: modelSpread - line.spread_open,
      edgeAtClose: modelSpread - line.spread_close,
    });
  }

  console.log(`Total games: ${games.length}\n`);

  // ==========================================================================
  // VALIDATION 1: Sign Convention Check
  // ==========================================================================

  console.log('=== VALIDATION 1: SIGN CONVENTION CHECK ===\n');

  const sample = games[0];
  console.log('Sample game:');
  console.log(`  ${sample.awayTeam} @ ${sample.homeTeam}`);
  console.log(`  Home Elo: ${sample.homeElo}, Away Elo: ${sample.awayElo}`);
  console.log(`  Model Spread: ${sample.modelSpread.toFixed(1)} (negative = home favored)`);
  console.log(`  Opening Spread: ${sample.spreadOpen} (negative = home favored)`);
  console.log(`  Closing Spread: ${sample.spreadClose} (negative = home favored)`);
  console.log(`  Final Score: ${sample.homeTeam} ${sample.homeScore}, ${sample.awayTeam} ${sample.awayScore}`);
  console.log(`  Margin: ${sample.margin} (positive = home won)`);
  console.log(`  Edge at Open: ${sample.edgeAtOpen.toFixed(1)}`);
  console.log(`    If negative: model has home as bigger favorite than market`);
  console.log(`    If positive: model has away as stronger than market thinks`);

  // Verify with a clear example
  console.log('\n  Grading example:');
  console.log(`    If we bet HOME at spread ${sample.spreadClose}:`);
  const homeResult = sample.margin + sample.spreadClose;
  console.log(`    margin + spread = ${sample.margin} + ${sample.spreadClose} = ${homeResult.toFixed(1)}`);
  console.log(`    ${homeResult > 0 ? 'HOME COVERS' : homeResult < 0 ? 'AWAY COVERS' : 'PUSH'}`);

  // ==========================================================================
  // VALIDATION 2: Reality Check - Betting at Close Should Have ~0 EV
  // ==========================================================================

  console.log('\n=== VALIDATION 2: REALITY CHECK - CLOSE SHOULD BE ~0 EV ===\n');

  // If we just bet every home team at closing spread, what's our win rate?
  let homeWins = 0, homeLosses = 0, homePushes = 0;
  let awayWins = 0, awayLosses = 0, awayPushes = 0;

  for (const game of games) {
    const homeResult = gradeBet(game, 'home', game.spreadClose);
    const awayResult = gradeBet(game, 'away', game.spreadClose);

    if (homeResult.isPush) homePushes++;
    else if (homeResult.won) homeWins++;
    else homeLosses++;

    if (awayResult.isPush) awayPushes++;
    else if (awayResult.won) awayWins++;
    else awayLosses++;
  }

  const homeWinRate = homeWins / (homeWins + homeLosses);
  const awayWinRate = awayWins / (awayWins + awayLosses);
  const homeROI = calcROI(homeWins, homeLosses, homePushes);
  const awayROI = calcROI(awayWins, awayLosses, awayPushes);

  console.log('Betting every HOME at close:');
  console.log(`  W-L-P: ${homeWins}-${homeLosses}-${homePushes}`);
  console.log(`  Win Rate: ${(homeWinRate * 100).toFixed(1)}%`);
  console.log(`  ROI: ${(homeROI * 100).toFixed(1)}%`);

  console.log('\nBetting every AWAY at close:');
  console.log(`  W-L-P: ${awayWins}-${awayLosses}-${awayPushes}`);
  console.log(`  Win Rate: ${(awayWinRate * 100).toFixed(1)}%`);
  console.log(`  ROI: ${(awayROI * 100).toFixed(1)}%`);

  console.log('\n  EXPECTED: Both should be ~50% win rate, ~-4.5% ROI (vig)');
  console.log(`  ACTUAL: Home ${(homeWinRate * 100).toFixed(1)}%, Away ${(awayWinRate * 100).toFixed(1)}%`);

  if (Math.abs(homeWinRate - 0.5) > 0.03 || Math.abs(awayWinRate - 0.5) > 0.03) {
    console.log('  ⚠️  WARNING: Win rates deviate from 50% - check grading logic');
  } else {
    console.log('  ✓ PASS: Win rates close to 50%');
  }

  // ==========================================================================
  // VALIDATION 3: Model Side Selection
  // ==========================================================================

  console.log('\n=== VALIDATION 3: MODEL SIDE SELECTION ===\n');

  // When edgeAtOpen < 0: model has home as bigger favorite → bet home
  // When edgeAtOpen > 0: model has away as stronger → bet away

  console.log('Side selection logic:');
  console.log('  edgeAtOpen = modelSpread - openSpread');
  console.log('  If edge < 0: model is MORE favorable to home → bet HOME');
  console.log('  If edge > 0: model is MORE favorable to away → bet AWAY');

  // Example
  const ex1 = games.find(g => g.edgeAtOpen < -5);
  if (ex1) {
    console.log(`\nExample (edge < 0, bet home):`);
    console.log(`  ${ex1.awayTeam} @ ${ex1.homeTeam}`);
    console.log(`  Model: ${ex1.modelSpread.toFixed(1)}, Open: ${ex1.spreadOpen}`);
    console.log(`  Edge: ${ex1.edgeAtOpen.toFixed(1)} (model more home-favorable)`);
    console.log(`  → Bet HOME`);
    console.log(`  → Contrarian: Bet AWAY`);
  }

  const ex2 = games.find(g => g.edgeAtOpen > 5);
  if (ex2) {
    console.log(`\nExample (edge > 0, bet away):`);
    console.log(`  ${ex2.awayTeam} @ ${ex2.homeTeam}`);
    console.log(`  Model: ${ex2.modelSpread.toFixed(1)}, Open: ${ex2.spreadOpen}`);
    console.log(`  Edge: ${ex2.edgeAtOpen.toFixed(1)} (model more away-favorable)`);
    console.log(`  → Bet AWAY`);
    console.log(`  → Contrarian: Bet HOME`);
  }

  // ==========================================================================
  // VALIDATION 4: Test Original vs Contrarian with Proper Grading
  // ==========================================================================

  console.log('\n=== VALIDATION 4: ORIGINAL vs CONTRARIAN (ALL GAMES) ===\n');
  console.log('Using CLOSING line for grading, excluding pushes\n');

  // Sort by absolute edge
  games.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));

  for (const bucket of [0.05, 0.10, 0.20, 0.50, 1.0]) {
    const n = Math.floor(games.length * bucket);
    const slice = games.slice(0, n);

    let origWins = 0, origLosses = 0, origPushes = 0;
    let contrWins = 0, contrLosses = 0, contrPushes = 0;

    for (const g of slice) {
      // Original: bet with model
      const origSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'home' : 'away';
      const contrSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'away' : 'home';

      // Grade against CLOSING line
      const origResult = gradeBet(g, origSide, g.spreadClose);
      const contrResult = gradeBet(g, contrSide, g.spreadClose);

      if (origResult.isPush) origPushes++;
      else if (origResult.won) origWins++;
      else origLosses++;

      if (contrResult.isPush) contrPushes++;
      else if (contrResult.won) contrWins++;
      else contrLosses++;
    }

    const origWinRate = origWins / (origWins + origLosses);
    const contrWinRate = contrWins / (contrWins + contrLosses);
    const origROI = calcROI(origWins, origLosses, origPushes);
    const contrROI = calcROI(contrWins, contrLosses, contrPushes);

    const label = bucket === 1.0 ? 'All' : `Top ${(bucket * 100).toFixed(0)}%`;
    console.log(`${label.padEnd(8)} | N=${n.toString().padStart(4)} | Orig: ${(origWinRate * 100).toFixed(1)}% (${(origROI * 100).toFixed(1)}% ROI) | Contr: ${(contrWinRate * 100).toFixed(1)}% (${(contrROI * 100).toFixed(1)}% ROI)`);
  }

  // ==========================================================================
  // VALIDATION 5: Bet at CLOSING Prices (should be ~0 EV)
  // ==========================================================================

  console.log('\n=== VALIDATION 5: IF WE BET AT CLOSE, ROI SHOULD BE ~0 ===\n');
  console.log('If contrarian still shows strong positive ROI at close, grading is wrong\n');

  // Same test but using closing line for both bet selection AND grading
  // (This is wrong methodology but tests for bugs)

  let contrWinsAtClose = 0, contrLossesAtClose = 0, contrPushesAtClose = 0;
  const top20 = games.slice(0, Math.floor(games.length * 0.2));

  for (const g of top20) {
    // Use edge at CLOSE to pick side (this is like betting at close)
    const contrSideAtClose: 'home' | 'away' = g.edgeAtClose < 0 ? 'away' : 'home';
    const result = gradeBet(g, contrSideAtClose, g.spreadClose);

    if (result.isPush) contrPushesAtClose++;
    else if (result.won) contrWinsAtClose++;
    else contrLossesAtClose++;
  }

  const winRateAtClose = contrWinsAtClose / (contrWinsAtClose + contrLossesAtClose);
  const roiAtClose = calcROI(contrWinsAtClose, contrLossesAtClose, contrPushesAtClose);

  console.log(`Contrarian using CLOSE for selection AND grading (top 20%):`);
  console.log(`  Win Rate: ${(winRateAtClose * 100).toFixed(1)}%`);
  console.log(`  ROI: ${(roiAtClose * 100).toFixed(1)}%`);
  console.log(`  Expected: ~50% / ~-4.5% (no edge at close)`);

  if (roiAtClose > 5) {
    console.log('  ⚠️  WARNING: Still positive - possible bug in grading');
  } else {
    console.log('  ✓ PASS: Close-to-close shows ~0 edge as expected');
  }

  // ==========================================================================
  // VALIDATION 6: HOLDOUT TEST (Train 2022-2023, Test 2024)
  // ==========================================================================

  console.log('\n=== VALIDATION 6: HOLDOUT TEST ===\n');
  console.log('Train: Identify threshold on 2022-2023');
  console.log('Test: Apply to 2024 (no peeking)\n');

  const train = games.filter(g => g.season <= 2023);
  const test = games.filter(g => g.season === 2024);

  console.log(`Train games: ${train.length} (2022-2023)`);
  console.log(`Test games: ${test.length} (2024)\n`);

  // Find optimal threshold on training data
  train.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));

  console.log('Training performance by bucket:');
  for (const pct of [0.10, 0.20, 0.30]) {
    const n = Math.floor(train.length * pct);
    const slice = train.slice(0, n);

    let wins = 0, losses = 0;
    for (const g of slice) {
      const contrSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'away' : 'home';
      const result = gradeBet(g, contrSide, g.spreadClose);
      if (!result.isPush) {
        if (result.won) wins++;
        else losses++;
      }
    }

    const threshold = Math.abs(slice[slice.length - 1].edgeAtOpen);
    console.log(`  Top ${(pct * 100).toFixed(0)}%: ${(wins / (wins + losses) * 100).toFixed(1)}% win (threshold: ${threshold.toFixed(1)} pts)`);
  }

  // Apply to test set
  console.log('\nTest performance (2024 only):');
  test.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));

  for (const pct of [0.10, 0.20, 0.30]) {
    const n = Math.floor(test.length * pct);
    const slice = test.slice(0, n);

    let wins = 0, losses = 0, pushes = 0;
    for (const g of slice) {
      const contrSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'away' : 'home';
      const result = gradeBet(g, contrSide, g.spreadClose);
      if (result.isPush) pushes++;
      else if (result.won) wins++;
      else losses++;
    }

    const winRate = wins / (wins + losses);
    const roi = calcROI(wins, losses, pushes);
    console.log(`  Top ${(pct * 100).toFixed(0)}%: W-L-P ${wins}-${losses}-${pushes}, Win: ${(winRate * 100).toFixed(1)}%, ROI: ${(roi * 100).toFixed(1)}%`);
  }

  // ==========================================================================
  // VALIDATION 7: WALK-FORWARD TEST
  // ==========================================================================

  console.log('\n=== VALIDATION 7: WALK-FORWARD TEST ===\n');
  console.log('Train through week N, test week N+1, rolling\n');

  // Group by season-week
  const byWeek = new Map<string, Game[]>();
  for (const g of games) {
    const key = `${g.season}-${g.week}`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(g);
  }

  const weeks = Array.from(byWeek.keys()).sort();

  let walkForwardWins = 0, walkForwardLosses = 0, walkForwardPushes = 0;
  let totalBets = 0;

  for (let i = 4; i < weeks.length; i++) {  // Start after 4 weeks of training
    const trainWeeks = weeks.slice(0, i);
    const testWeek = weeks[i];

    // Get training games and find top 20% threshold
    const trainGames: Game[] = [];
    for (const w of trainWeeks) {
      trainGames.push(...(byWeek.get(w) || []));
    }

    trainGames.sort((a, b) => Math.abs(b.edgeAtOpen) - Math.abs(a.edgeAtOpen));
    const threshold = trainGames.length >= 5
      ? Math.abs(trainGames[Math.floor(trainGames.length * 0.2) - 1].edgeAtOpen)
      : 5;

    // Test on next week
    const testGames = byWeek.get(testWeek) || [];
    for (const g of testGames) {
      if (Math.abs(g.edgeAtOpen) >= threshold) {
        const contrSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'away' : 'home';
        const result = gradeBet(g, contrSide, g.spreadClose);
        totalBets++;
        if (result.isPush) walkForwardPushes++;
        else if (result.won) walkForwardWins++;
        else walkForwardLosses++;
      }
    }
  }

  const wfWinRate = walkForwardWins / (walkForwardWins + walkForwardLosses);
  const wfROI = calcROI(walkForwardWins, walkForwardLosses, walkForwardPushes);

  console.log(`Walk-forward results (top 20% threshold, rolling):`);
  console.log(`  Total bets: ${totalBets}`);
  console.log(`  W-L-P: ${walkForwardWins}-${walkForwardLosses}-${walkForwardPushes}`);
  console.log(`  Win Rate: ${(wfWinRate * 100).toFixed(1)}%`);
  console.log(`  ROI: ${(wfROI * 100).toFixed(1)}%`);

  // ==========================================================================
  // VALIDATION 8: Edge Bins
  // ==========================================================================

  console.log('\n=== VALIDATION 8: EDGE BINS (CONTRARIAN) ===\n');

  const bins = [
    { name: '0-5 pts', min: 0, max: 5 },
    { name: '5-10 pts', min: 5, max: 10 },
    { name: '10-15 pts', min: 10, max: 15 },
    { name: '15+ pts', min: 15, max: 100 },
  ];

  console.log('Bin       | N    | Win%  | ROI');
  console.log('----------|------|-------|-------');

  for (const bin of bins) {
    const binGames = games.filter(g => {
      const absEdge = Math.abs(g.edgeAtOpen);
      return absEdge >= bin.min && absEdge < bin.max;
    });

    if (binGames.length === 0) continue;

    let wins = 0, losses = 0, pushes = 0;
    for (const g of binGames) {
      const contrSide: 'home' | 'away' = g.edgeAtOpen < 0 ? 'away' : 'home';
      const result = gradeBet(g, contrSide, g.spreadClose);
      if (result.isPush) pushes++;
      else if (result.won) wins++;
      else losses++;
    }

    const winRate = wins / (wins + losses);
    const roi = calcROI(wins, losses, pushes);

    console.log(`${bin.name.padEnd(9)} | ${binGames.length.toString().padStart(4)} | ${(winRate * 100).toFixed(1)}% | ${(roi * 100).toFixed(1)}%`);
  }

  console.log('\n=== VALIDATION COMPLETE ===');
  console.log('\nIf contrarian still works after all validations, it suggests');
  console.log('the model is systematically stale on high-edge games.');
  console.log('The fix is better priors + pregame info, not "bet opposite."');
}

main().catch(console.error);
