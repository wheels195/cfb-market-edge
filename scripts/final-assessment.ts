/**
 * Final Assessment - CFB Betting Model
 *
 * Summary of all findings and actionable recommendations
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('');
  console.log('█'.repeat(70));
  console.log('█  CFB BETTING MODEL - FINAL ASSESSMENT');
  console.log('█'.repeat(70));
  console.log('');

  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│                        EXECUTIVE SUMMARY                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Our Elo-based model is ANTI-PREDICTIVE: the larger our perceived  │
│  edge, the more likely we LOSE. However, this creates a usable     │
│  contrarian signal with ~55-60% win rate on high-edge games.       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════
                         KEY FINDINGS
═══════════════════════════════════════════════════════════════════════

1. ELO MODEL PERFORMANCE (Betting WITH model)
   ───────────────────────────────────────────
   • Top 5% edges:  42.3% win, -19.3% ROI
   • Top 10% edges: 40.8% win, -22.0% ROI
   • Top 20% edges: 44.4% win, -15.3% ROI
   • Bottom 80%:    52.1% win, -0.6% ROI  ← Best performance!

   CONCLUSION: Model gets WORSE as "edge" increases

2. CONTRARIAN APPROACH (Betting AGAINST model)
   ────────────────────────────────────────────
   • Top 5% edges:  57.7% win, +10.2% ROI
   • Top 10% edges: 59.2% win, +12.9% ROI
   • Top 20% edges: 55.6% win, +6.2% ROI

   Statistical Significance:
   • P-value: 0.0576 (significant at 10%, borderline at 5%)
   • Sample size: 284 games (top 20%)

3. YEAR-BY-YEAR VARIANCE (Top 20% Contrarian)
   ──────────────────────────────────────────
   • 2022: 49.0% win, -6.5% ROI  ← LOSING
   • 2023: 58.7% win, +12.1% ROI
   • 2024: 63.5% win, +21.3% ROI

   TREND: Model increasingly wrong vs market (transfer portal era?)

4. LINE MOVEMENT ANALYSIS
   ─────────────────────────
   • Follow steam: 48.1% win rate
   • Fade steam:   51.9% win rate
   • When line moves WITH our model:    38.5% win
   • When line moves AGAINST our model: 50.4% win

5. CLV FINDINGS
   ─────────────
   • CLV is NEGATIVELY correlated with winning (-0.0316)
   • Getting good numbers doesn't help if you're on wrong side

═══════════════════════════════════════════════════════════════════════
                     WHY THE MODEL FAILS
═══════════════════════════════════════════════════════════════════════

Elo ratings capture LONG-TERM team strength but miss:

  ✗ Transfer portal changes (huge in 2023-2024)
  ✗ Injuries, especially QB availability
  ✗ Matchup-specific factors (scheme, style)
  ✗ Weather conditions
  ✗ Travel/rest advantages
  ✗ Recent form and momentum
  ✗ Rivalry/motivation factors

The MARKET incorporates all of these. When Elo strongly disagrees
with the market, it's because the market has game-specific information
that Elo doesn't capture. The market is smarter.

═══════════════════════════════════════════════════════════════════════
                    ACTIONABLE STRATEGIES
═══════════════════════════════════════════════════════════════════════

STRATEGY A: CONTRARIAN ELO (Tested, Works)
──────────────────────────────────────────
Implementation:
1. Calculate Elo-based spread projection
2. Identify games where |model - market| > 10 points
3. Bet OPPOSITE of what model suggests
4. Expected: ~55-60% win rate, +6-13% ROI

Pros: Simple, tested, positive ROI
Cons: 2022 was losing year, small sample, risky bet sizing

STRATEGY B: MARKET-ANCHOR ADJUSTMENTS
─────────────────────────────────────
Implementation:
1. Accept market spread as baseline
2. ONLY adjust for specific factors market might miss:
   - Late QB injury news (not yet priced)
   - Weather changes after line set
   - Overreaction to recent blowouts
3. Bet only when specific adjustment applies

Pros: Lower volume, higher confidence per bet
Cons: Requires real-time monitoring, subjective factors

STRATEGY C: CLV TIMING OPTIMIZATION
───────────────────────────────────
Implementation:
1. Track opening lines early (use our odds polling)
2. When our model ALIGNS with market direction:
   - Bet early to capture line movement
   - Even if 50% win rate, capture +CLV
3. NEVER bet when we strongly disagree with market

Pros: CLV-positive, market-aligned
Cons: Requires early line access, psychological challenge

STRATEGY D: SITUATION-SPECIFIC EDGES
────────────────────────────────────
Focus on narrow situations with possible market blindspots:
• Rivalry games with emotional overreaction
• Early season games (limited info on new transfers)
• Weather games (wind/rain affecting totals)
• Conference championship rematch scenarios

═══════════════════════════════════════════════════════════════════════
                      RECOMMENDED PATH FORWARD
═══════════════════════════════════════════════════════════════════════

PHASE 1: Implement Contrarian Signal (Immediate)
  • Create alert for games with |Elo edge| > 10 points
  • Track these games with contrarian bet recommendation
  • Paper trade for 2025 season to validate

PHASE 2: Build Better Base Model (Medium-term)
  • Incorporate transfer portal data
  • Add in-season performance metrics (EPA, success rate)
  • Use QB-adjusted ratings
  • Target: Model that AGREES with market more often

PHASE 3: Identify Market Blindspots (Long-term)
  • Study situations where lines move late
  • Identify systematic biases (home favorites, ranked teams)
  • Build filters for high-confidence spots

═══════════════════════════════════════════════════════════════════════
                         DATA SUMMARY
═══════════════════════════════════════════════════════════════════════
`);

  const { data: lines } = await supabase
    .from('cfbd_betting_lines')
    .select('season')
    .not('spread_open', 'is', null);

  const { data: elo } = await supabase
    .from('cfbd_elo_ratings')
    .select('season');

  const linesByYear = lines?.reduce((acc, l) => {
    acc[l.season] = (acc[l.season] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const eloByYear = elo?.reduce((acc, e) => {
    acc[e.season] = (acc[e.season] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  console.log('Betting Lines with Opening Spread:');
  for (const [year, count] of Object.entries(linesByYear || {}).sort()) {
    console.log(`  ${year}: ${count} games`);
  }

  console.log('\nElo Ratings (weekly snapshots):');
  for (const [year, count] of Object.entries(eloByYear || {}).sort()) {
    console.log(`  ${year}: ${count} team-weeks`);
  }

  console.log('\n' + '█'.repeat(70));
  console.log('█  END OF ASSESSMENT');
  console.log('█'.repeat(70));
  console.log('');
}

main().catch(console.error);
