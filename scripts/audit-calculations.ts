/**
 * Audit Script for CLV and MAE Calculations
 *
 * Verifies:
 * 1. Spread sign conventions are consistent
 * 2. CLV calculation is correct (positive = got value)
 * 3. MAE compares apples to apples (spread vs margin)
 * 4. Data joins are correct (closing lines match events)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('=== CALCULATION AUDIT ===\n');

  // 1. Check closing_lines data format
  console.log('1. CLOSING LINES FORMAT CHECK');
  console.log('─'.repeat(50));

  const { data: sampleClosing } = await supabase
    .from('closing_lines')
    .select('event_id, market_type, side, spread_points_home, price')
    .eq('market_type', 'spread')
    .limit(10);

  console.log('Sample closing lines:');
  for (const cl of sampleClosing || []) {
    console.log(`  Event ${cl.event_id.slice(0,8)}: side=${cl.side}, spread_points_home=${cl.spread_points_home}, price=${cl.price}`);
  }

  // Check if we have both home and away sides
  const { data: homeSide } = await supabase
    .from('closing_lines')
    .select('event_id, spread_points_home')
    .eq('market_type', 'spread')
    .eq('side', 'home')
    .limit(1)
    .single();

  const { data: awaySide } = await supabase
    .from('closing_lines')
    .select('event_id, spread_points_home')
    .eq('market_type', 'spread')
    .eq('side', 'away')
    .eq('event_id', homeSide?.event_id || '')
    .single();

  if (homeSide && awaySide) {
    console.log(`\nFor same event ${homeSide.event_id.slice(0,8)}:`);
    console.log(`  Home side spread_points_home: ${homeSide.spread_points_home}`);
    console.log(`  Away side spread_points_home: ${awaySide.spread_points_home}`);
    console.log(`  Sum (should be 0): ${(homeSide.spread_points_home || 0) + (awaySide.spread_points_home || 0)}`);
  }

  // 2. Check a specific game with known result
  console.log('\n2. SPECIFIC GAME CHECK');
  console.log('─'.repeat(50));

  // Find a game with closing line and result
  const { data: sampleEvent } = await supabase
    .from('events')
    .select(`
      id,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name),
      results(home_score, away_score)
    `)
    .eq('status', 'final')
    .not('results', 'is', null)
    .limit(1)
    .single();

  if (sampleEvent) {
    const homeTeam = (sampleEvent.home_team as any)?.name;
    const awayTeam = (sampleEvent.away_team as any)?.name;
    const results = sampleEvent.results as any;

    console.log(`Game: ${awayTeam} @ ${homeTeam}`);
    console.log(`Score: Home ${results?.home_score}, Away ${results?.away_score}`);
    console.log(`Actual Margin (home_score - away_score): ${results?.home_score - results?.away_score}`);

    // Get closing line
    const { data: closing } = await supabase
      .from('closing_lines')
      .select('spread_points_home')
      .eq('event_id', sampleEvent.id)
      .eq('market_type', 'spread')
      .eq('side', 'home')
      .single();

    if (closing) {
      console.log(`Closing spread (home): ${closing.spread_points_home}`);
      console.log(`\nInterpretation:`);
      if (closing.spread_points_home < 0) {
        console.log(`  Home was favored by ${Math.abs(closing.spread_points_home)} points`);
      } else {
        console.log(`  Away was favored by ${closing.spread_points_home} points`);
      }

      const actualMargin = results?.home_score - results?.away_score;
      const spread = closing.spread_points_home;
      const homeCovered = actualMargin > -spread;
      console.log(`  Home covered: ${homeCovered} (margin ${actualMargin} > -spread ${-spread})`);
    }
  }

  // 3. CLV Sign Convention
  console.log('\n3. CLV SIGN CONVENTION');
  console.log('─'.repeat(50));
  console.log(`
STANDARD CLV DEFINITION:
- CLV measures value obtained vs closing line
- Positive CLV = bet at better number than close
- If betting HOME at spread X and close is Y:
  - CLV = Y - X (more negative close = more value for home bet)

EXAMPLE:
- Model says: Home -10 (predicts home wins by 10)
- Market at bet time: Home -7
- Closing line: Home -9

If we bet HOME at -7 because model likes home:
- CLV = Close - Bet = (-9) - (-7) = -2 points
- We got WORSE number than close (negative CLV, bad)

Wait, that doesn't match intuition. Let me reconsider...

If close moved from -7 to -9 (home became MORE favored):
- We bet home at -7, close was -9
- We got 2 points of value (close is 2 points worse for home bettors)
- CLV should be POSITIVE

So: CLV = BetSpread - CloseSpread = -7 - (-9) = +2 ✓

If our MODEL says -10 and we compare to close:
- MODEL_CLV = ModelSpread - CloseSpread = -10 - (-9) = -1
- This says model was 1 point more aggressive than close

For EDGE detection:
- Model -10, Market -7: Edge = Model - Market = -10 - (-7) = -3
- Negative edge means model thinks home is better than market
- We would bet HOME

Current code: clv = projectedSpread - closingSpread
This measures: "how much more did model favor home than close"
`);

  // 4. MAE Calculation Check
  console.log('\n4. MAE SIGN CHECK');
  console.log('─'.repeat(50));
  console.log(`
SPREAD vs MARGIN CONVERSION:
- Spread: negative = home favored (home needs to win by X)
- Margin: positive = home won (home_score - away_score)

To predict margin from spread:
- Spread of -7 predicts margin of +7 (home wins by 7)
- So: predicted_margin = -spread

Current MAE code: error = projectedSpread - actualMargin
If spread = -10, margin = +14:
  error = -10 - 14 = -24 (WRONG)

Should be: error = (-spread) - margin = 10 - 14 = -4 (correct)
Or equivalently: error = -(spread + margin)

BUG CONFIRMED: MAE calculation has sign error
`);

  // 5. Verify with real data
  console.log('\n5. REAL DATA VERIFICATION');
  console.log('─'.repeat(50));

  // Get 5 games with closing lines and results
  const { data: verifyEvents } = await supabase
    .from('events')
    .select(`
      id,
      home_team:teams!events_home_team_id_fkey(name),
      away_team:teams!events_away_team_id_fkey(name),
      results(home_score, away_score)
    `)
    .eq('status', 'final')
    .limit(50);

  const eventIds = (verifyEvents || []).map(e => e.id);

  const { data: closingLines } = await supabase
    .from('closing_lines')
    .select('event_id, spread_points_home')
    .in('event_id', eventIds)
    .eq('market_type', 'spread')
    .eq('side', 'home');

  const closeMap = new Map((closingLines || []).map(c => [c.event_id, c.spread_points_home]));

  console.log('Game                                    | Close | Margin | Cover?');
  console.log('─'.repeat(70));

  let covers = 0;
  let total = 0;

  for (const event of (verifyEvents || []).slice(0, 10)) {
    const close = closeMap.get(event.id);
    if (close === undefined) continue;

    const homeTeam = (event.home_team as any)?.name || '?';
    const awayTeam = (event.away_team as any)?.name || '?';
    const results = event.results as any;
    if (!results) continue;

    const margin = results.home_score - results.away_score;
    const homeCovered = margin + close > 0;

    const matchup = `${awayTeam} @ ${homeTeam}`.substring(0, 38).padEnd(38);
    const closeStr = close >= 0 ? `+${close.toFixed(1)}` : close.toFixed(1);
    const marginStr = margin >= 0 ? `+${margin}` : margin.toString();

    console.log(`${matchup} | ${closeStr.padStart(5)} | ${marginStr.padStart(6)} | ${homeCovered ? 'HOME' : 'AWAY'}`);

    if (homeCovered) covers++;
    total++;
  }

  console.log(`\nHome cover rate: ${covers}/${total} = ${(covers/total*100).toFixed(1)}%`);

  // 6. Summary
  console.log('\n6. SUMMARY OF FINDINGS');
  console.log('─'.repeat(50));
  console.log(`
BUGS FOUND:

1. MAE/RMSE CALCULATION:
   - Current: error = projectedSpread - actualMargin
   - Correct: error = -projectedSpread - actualMargin
   - Impact: Errors are shifted by 2x the spread magnitude

2. CORRELATION CALCULATION:
   - Same issue: comparing spread (sign inverted) to margin directly
   - This would cause negative correlation when model is actually working

3. CLV INTERPRETATION:
   - Current: clv = projectedSpread - closingSpread
   - This is MODEL_CLV: how much more aggressive is model than close
   - For betting: positive CLV means model favors home more than close
   - If you bet with model when edge exists, this IS correct
   - But interpretation matters: +CLV means model was MORE negative (more home-favored)

   To measure ACTUAL CLV (value of bets taken):
   - Need to track which side we bet
   - CLV = CloseSpread - BetSpread (for home bets)
   - CLV = -CloseSpread - (-BetSpread) (for away bets)

RECOMMENDATIONS:
1. Fix MAE: use -projectedSpread to get predicted margin
2. Fix correlation: same fix
3. Clarify CLV: current calc is fine for "model vs market" comparison
4. Add betting simulation to measure actual CLV on bets taken
`);
}

main().catch(console.error);
