/**
 * Model Findings Summary
 *
 * This script summarizes the key findings from our analysis
 * and identifies the path forward.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function main() {
  console.log('='.repeat(70));
  console.log('CFB BETTING MODEL - FINDINGS SUMMARY');
  console.log('='.repeat(70));

  console.log(`
CRITICAL FINDING: The Elo model is ANTI-CORRELATED with winning

When our model disagrees MOST with the market, we are MOST LIKELY to lose.
This is the opposite of what we need for a profitable betting model.

EVIDENCE:
┌─────────────────────────────────────────────────────────────────────┐
│ Edge Bucket    │ Win Rate  │ ROI      │ If REVERSED Win Rate       │
├─────────────────────────────────────────────────────────────────────┤
│ Top 5%         │ 42.3%     │ -19.3%   │ (Not tested)               │
│ Top 10%        │ 40.8%     │ -22.0%   │ (Not tested)               │
│ Top 20%        │ 44.4%     │ -15.3%   │ 55.6% (profitable!)        │
│ Bottom 80%     │ 52.1%     │ -0.6%    │ 47.9%                      │
└─────────────────────────────────────────────────────────────────────┘

KEY INSIGHT: Bottom 80% (smallest edges) performs BEST at 52.1%

CORRELATION WITH WINNING:
  - Model edge size:      -0.0599 (NEGATIVE - bigger edge = more likely to LOSE)
  - CLV from open:        -0.0316 (NEGATIVE)
  - Line move magnitude:  +0.0074 (essentially zero)

WHAT THIS MEANS:
  1. The market is more accurate than our Elo model
  2. When we strongly disagree with the market, the market is usually right
  3. Our "edge" is actually a signal to bet the OPPOSITE direction

LINE MOVEMENT ANALYSIS:
┌─────────────────────────────────────────────────────────────────────┐
│ When line moves WITH our model:    38.5% win rate (terrible)       │
│ When line moves AGAINST our model: 50.4% win rate (neutral)        │
└─────────────────────────────────────────────────────────────────────┘

This suggests informed money (which moves lines) disagrees with our model,
and they're correct.

FOLLOW vs FADE STEAM:
  - Follow steam (bet with line movement): 48.1% win rate
  - Fade steam (bet against movement):     51.9% win rate
  Slight edge to fading, but not significant.

ROOT CAUSE ANALYSIS:
═══════════════════

Elo ratings capture long-term team strength but miss:
  - Injuries (especially QB)
  - Matchup specifics (scheme, style)
  - Weather conditions
  - Travel/rest factors
  - Recent form trends
  - Motivation/rivalry factors

The market incorporates ALL of these. When our Elo-only model disagrees
with the market, it's because the market has game-specific information
that Elo doesn't capture.

WHAT WE'VE LEARNED WORKS AND DOESN'T WORK:
══════════════════════════════════════════

DOESN'T WORK:
  ✗ Using Elo as primary predictor and betting against market
  ✗ Bigger edge = better bet (it's actually worse)
  ✗ Opening-line filter alone (gives CLV but wrong side)

MARGINAL/NEUTRAL:
  ~ Fading steam (51.9% vs 48.1%)
  ~ Smaller disagreements with market (~52%)

NOT YET TESTED:
  ? QB availability as filter
  ? Game-specific factors
  ? Market as anchor with adjustments

RECOMMENDED PATH FORWARD:
═════════════════════════

OPTION A: Market-Anchor Approach
  1. Accept market spread as baseline (don't try to beat it overall)
  2. Identify specific situations where market may be wrong:
     - QB injury announced late
     - Weather changes after line set
     - Overreaction to recent results
  3. Only bet when we have game-specific edge the market hasn't priced

OPTION B: Contrarian Elo
  1. Since Elo anti-predicts winning...
  2. Bet OPPOSITE of what Elo suggests on top edges
  3. This would give ~55% win rate on top 20%
  4. BUT: This is essentially fading our own model, risky

OPTION C: CLV Capture Focus
  1. We get positive CLV (+1.13) when line moves with us
  2. Focus on capturing CLV by:
     - Betting early when model aligns with market
     - NOT when we disagree strongly
  3. Win rate may be ~50% but CLV is positive

OPTION D: Abandon Pure Elo
  1. Build more sophisticated model incorporating:
     - Game-level PPA/EPA
     - Returning production
     - Recruiting ratings
     - QB quality metrics
  2. Requires more data and feature engineering
  3. Still may not beat market

NEXT STEPS:
═══════════

1. Test QB availability impact on game outcomes
2. Identify high-variance situations (rivalry games, weather, etc.)
3. Consider market-anchor approach with specific adjustments
4. Evaluate if any subset of games has genuine edge
`);

  // Check data availability
  const { data: lines } = await supabase
    .from('cfbd_betting_lines')
    .select('cfbd_game_id')
    .not('spread_open', 'is', null)
    .not('spread_close', 'is', null);

  const { data: elo } = await supabase
    .from('cfbd_elo_ratings')
    .select('id')
    .limit(1);

  console.log('\nDATA AVAILABLE:');
  console.log(`  Games with open & close spreads: ${lines?.length || 0}`);
  console.log(`  Elo ratings loaded: ${elo?.length ? 'Yes' : 'No'}`);
  console.log();
  console.log('='.repeat(70));
}

main().catch(console.error);
