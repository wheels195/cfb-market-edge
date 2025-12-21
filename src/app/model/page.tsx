'use client';

import Link from 'next/link';

export default function ModelPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Header */}
      <header className="border-b border-zinc-800/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-8 h-16">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <span className="text-lg font-bold text-white tracking-tight">CFB Edge</span>
            </Link>
            <Link href="/games" className="text-sm text-zinc-400 hover:text-white transition-colors">
              View All Games
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/5 rounded-full blur-[100px]" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full mb-6">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Technical Documentation</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight mb-4">
            Model Specification
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl">
            Market-anchored Elo model for college football spread prediction. v1.0
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">

        {/* Model Overview */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">1. Model Overview</h2>
          <div className="text-zinc-300 space-y-4">
            <p>
              The model combines an <strong className="text-white">Elo rating system</strong> with a <strong className="text-white">market-anchored projection</strong> approach. Rather than generating independent spread predictions, we compute an adjustment to the current market line based on Elo-derived team strength differentials.
            </p>
            <p className="text-zinc-400">
              This approach acknowledges market efficiency while exploiting systematic biases the Elo signal can detect.
            </p>
          </div>
        </section>

        {/* Elo Rating System */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">2. Elo Rating System</h2>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.1 Base Parameters</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 font-mono text-sm mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-zinc-500">INITIAL_RATING</span>
                <span className="text-white ml-4">= 1500</span>
              </div>
              <div>
                <span className="text-zinc-500">K_FACTOR</span>
                <span className="text-white ml-4">= 20</span>
              </div>
              <div>
                <span className="text-zinc-500">HOME_ADVANTAGE</span>
                <span className="text-white ml-4">= 2.5 pts</span>
              </div>
              <div>
                <span className="text-zinc-500">ELO_TO_SPREAD_DIVISOR</span>
                <span className="text-white ml-4">= 25</span>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.2 Expected Score Calculation</h3>
          <p className="text-zinc-400 mb-4">
            The expected outcome probability for team A against team B:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                E<sub>A</sub> = 1 / (1 + 10<sup>(R<sub>B</sub> - R<sub>A</sub>) / 400</sup>)
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Where R<sub>A</sub> and R<sub>B</sub> are the current Elo ratings of teams A and B
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.3 Rating Update Formula</h3>
          <p className="text-zinc-400 mb-4">
            After each game, ratings are updated based on the actual vs expected outcome:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                R'<sub>A</sub> = R<sub>A</sub> + K × (S<sub>A</sub> - E<sub>A</sub>)
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Where S<sub>A</sub> = 1 (win), 0.5 (tie), or 0 (loss)
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.4 Margin of Victory Adjustment</h3>
          <p className="text-zinc-400 mb-4">
            K-factor is scaled by margin of victory to weight blowouts more heavily:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                K<sub>adj</sub> = K × ln(|MOV| + 1)
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Where MOV = winner's score - loser's score
              </div>
            </div>
          </div>
        </section>

        {/* Spread Projection */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">3. Spread Projection</h2>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.1 Raw Elo Spread</h3>
          <p className="text-zinc-400 mb-4">
            Convert Elo differential to a point spread:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                Spread<sub>elo</sub> = (Elo<sub>home</sub> - Elo<sub>away</sub>) / 25 + HFA
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Where HFA = 2.5 (home field advantage in points)
              </div>
            </div>
          </div>
          <p className="text-zinc-400 mb-4">
            Negative values favor the home team. A spread of -7 means the home team is projected to win by 7 points.
          </p>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">3.2 Market-Anchored Adjustment</h3>
          <p className="text-zinc-400 mb-4">
            Rather than using raw Elo spread directly, we compute an adjustment to the market line:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="space-y-4 font-mono text-center">
              <div>
                <div className="text-zinc-500 text-sm mb-1">// Elo-based adjustment (capped)</div>
                <div className="text-lg text-white">
                  Δ = clamp(Spread<sub>elo</sub> - Spread<sub>market</sub>, -5, +5)
                </div>
              </div>
              <div>
                <div className="text-zinc-500 text-sm mb-1">// Final model spread</div>
                <div className="text-lg text-white">
                  Spread<sub>model</sub> = Spread<sub>market</sub> + Δ
                </div>
              </div>
            </div>
          </div>
          <p className="text-zinc-400">
            The ±5 point cap prevents the model from deviating too far from market consensus, acknowledging that extreme disagreements with the market are more likely to be model error than genuine edge.
          </p>
        </section>

        {/* Edge Calculation */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">4. Edge Calculation</h2>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.1 Edge Formula</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                Edge = Spread<sub>market</sub> - Spread<sub>model</sub>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.2 Side Selection</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 font-mono text-sm mb-6">
            <div className="space-y-2">
              <div className="text-zinc-400">
                <span className="text-emerald-400">if</span> Edge {'>'} 0:
                <span className="text-zinc-300 ml-4">→ Bet HOME (market undervalues home team)</span>
              </div>
              <div className="text-zinc-400">
                <span className="text-emerald-400">if</span> Edge {'<'} 0:
                <span className="text-zinc-300 ml-4">→ Bet AWAY (market undervalues away team)</span>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.3 Worked Example</h3>
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/50 overflow-hidden">
            <div className="bg-zinc-800/50 px-4 py-2 border-b border-zinc-700/50">
              <span className="text-sm text-zinc-400">Ohio State (Home) vs Michigan (Away)</span>
            </div>
            <div className="p-4 font-mono text-sm space-y-3">
              <div className="grid grid-cols-2 gap-4 text-zinc-400">
                <div>Elo<sub>OSU</sub> = 1680</div>
                <div>Elo<sub>MICH</sub> = 1620</div>
              </div>
              <div className="border-t border-zinc-700/50 pt-3">
                <div className="text-zinc-500 mb-1">// Raw Elo spread</div>
                <div className="text-white">Spread<sub>elo</sub> = (1680 - 1620) / 25 + 2.5 = <span className="text-blue-400">-4.9</span></div>
              </div>
              <div className="border-t border-zinc-700/50 pt-3">
                <div className="text-zinc-500 mb-1">// Market spread (from DraftKings)</div>
                <div className="text-white">Spread<sub>market</sub> = <span className="text-amber-400">-7.5</span></div>
              </div>
              <div className="border-t border-zinc-700/50 pt-3">
                <div className="text-zinc-500 mb-1">// Adjustment (capped at ±5)</div>
                <div className="text-white">Δ = clamp(-4.9 - (-7.5), -5, +5) = clamp(2.6, -5, +5) = <span className="text-emerald-400">+2.6</span></div>
              </div>
              <div className="border-t border-zinc-700/50 pt-3">
                <div className="text-zinc-500 mb-1">// Model spread</div>
                <div className="text-white">Spread<sub>model</sub> = -7.5 + 2.6 = <span className="text-blue-400">-4.9</span></div>
              </div>
              <div className="border-t border-zinc-700/50 pt-3">
                <div className="text-zinc-500 mb-1">// Edge calculation</div>
                <div className="text-white">Edge = -7.5 - (-4.9) = <span className="text-emerald-400">-2.6</span></div>
              </div>
              <div className="border-t border-zinc-700/50 pt-3 bg-emerald-500/10 -mx-4 -mb-4 px-4 py-3">
                <div className="text-emerald-400 font-semibold">
                  → Edge {'<'} 0: BET MICHIGAN +7.5
                </div>
                <div className="text-zinc-400 text-xs mt-1">
                  Model thinks OSU should only be -4.9, but market has them at -7.5. Michigan is getting too many points.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bet Grading */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">5. Bet Grading</h2>

          <p className="text-zinc-400 mb-4">
            Results are graded against the closing line (last available spread before kickoff):
          </p>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 font-mono text-sm mb-6">
            <div className="space-y-2">
              <div className="text-zinc-400">
                <span className="text-zinc-500">// Betting on home team at spread S</span>
              </div>
              <div className="text-zinc-400">
                <span className="text-emerald-400">WIN</span>: (Home Score - Away Score) {'>'} -S
              </div>
              <div className="text-zinc-400">
                <span className="text-red-400">LOSS</span>: (Home Score - Away Score) {'<'} -S
              </div>
              <div className="text-zinc-400">
                <span className="text-zinc-500">PUSH</span>: (Home Score - Away Score) = -S
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">5.1 CLV (Closing Line Value)</h3>
          <p className="text-zinc-400 mb-4">
            We track CLV as a proxy for long-term edge:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-4">
            <div className="text-center font-mono">
              <div className="text-lg text-white">
                CLV = Spread<sub>bet</sub> - Spread<sub>close</sub>
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Positive CLV indicates the line moved in our favor after bet placement
              </div>
            </div>
          </div>
        </section>

        {/* Rating Updates */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">6. Rating Update Schedule</h2>

          <div className="text-zinc-300 space-y-4">
            <p>
              Elo ratings are updated weekly after games complete:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-zinc-400">
              <li>Fetch final scores from CollegeFootballData API</li>
              <li>Calculate new ratings using MOV-adjusted K-factor</li>
              <li>Store weekly snapshot in <code className="text-emerald-400 bg-zinc-800 px-1.5 py-0.5 rounded">team_elo_snapshots</code> table</li>
              <li>Point-in-time lookups use the snapshot from week N-1 for week N games</li>
            </ol>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-zinc-300">
                <strong className="text-amber-400">Bowl Season Note:</strong> For bowl games (week {'>'} 13), we cap Elo lookups at week 13 to use end-of-regular-season ratings, as CFBD's data reverts to preseason values during bowl season.
              </div>
            </div>
          </div>
        </section>

        {/* Why No Totals */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">7. Scope Limitations</h2>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">7.1 Spreads Only (No Totals)</h3>
          <p className="text-zinc-400 mb-4">
            The model is designed exclusively for spread betting. Totals (over/unders) require fundamentally different features:
          </p>
          <ul className="space-y-2 text-zinc-400 mb-4">
            <li className="flex items-start gap-2">
              <span className="text-zinc-600 mt-1">•</span>
              <span><strong className="text-zinc-300">Pace metrics:</strong> Plays per game, time of possession, tempo</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-zinc-600 mt-1">•</span>
              <span><strong className="text-zinc-300">Efficiency splits:</strong> Offensive/defensive EPA, success rates by down</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-zinc-600 mt-1">•</span>
              <span><strong className="text-zinc-300">Situational factors:</strong> Weather, altitude, indoor/outdoor</span>
            </li>
          </ul>
          <p className="text-zinc-400">
            Elo captures relative team strength but not scoring environment. A separate totals model using SP+ pace/efficiency data is under consideration.
          </p>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">7.2 FBS Only</h3>
          <p className="text-zinc-400">
            Model coverage is limited to FBS (Division I-A) games where sufficient historical data and market liquidity exist.
          </p>
        </section>

        {/* Data Sources */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">8. Data Sources</h2>

          <div className="space-y-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="font-semibold text-white mb-1">CollegeFootballData.com API</div>
              <p className="text-sm text-zinc-400 mb-2">Game results, team statistics, Elo ratings, rankings</p>
              <code className="text-xs text-emerald-400 bg-zinc-800 px-2 py-1 rounded">apinext.collegefootballdata.com</code>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="font-semibold text-white mb-1">The Odds API</div>
              <p className="text-sm text-zinc-400 mb-2">Live betting lines from DraftKings, Bovada</p>
              <code className="text-xs text-emerald-400 bg-zinc-800 px-2 py-1 rounded">api.the-odds-api.com/v4</code>
            </div>
          </div>
        </section>

        {/* Implementation */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">9. Implementation Details</h2>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 font-mono text-sm">
            <div className="space-y-1 text-zinc-400">
              <div><span className="text-zinc-500">Stack:</span> Next.js 14, TypeScript, Supabase (Postgres)</div>
              <div><span className="text-zinc-500">Deployment:</span> Vercel</div>
              <div><span className="text-zinc-500">Update Frequency:</span> Odds polled every 10min, Elo updated daily</div>
              <div><span className="text-zinc-500">Edge Materialization:</span> Every 15min via cron</div>
            </div>
          </div>
        </section>

        {/* Performance */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">10. Performance Metrics</h2>

          <p className="text-zinc-400 mb-4">
            Key metrics tracked for model evaluation:
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Win Rate</div>
              <div className="text-white">Wins / (Wins + Losses)</div>
              <div className="text-zinc-500 text-sm mt-2">Break-even at -110: 52.4%</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">ROI</div>
              <div className="text-white">Profit / Total Wagered × 100</div>
              <div className="text-zinc-500 text-sm mt-2">Target: {'>'} 0% (positive expectation)</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Units</div>
              <div className="text-white">Σ (Win × 0.91 - Loss × 1.0)</div>
              <div className="text-zinc-500 text-sm mt-2">Assuming -110 standard juice</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Average CLV</div>
              <div className="text-white">Mean(Spread<sub>bet</sub> - Spread<sub>close</sub>)</div>
              <div className="text-zinc-500 text-sm mt-2">Leading indicator of edge</div>
            </div>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="border-t border-zinc-800/50 pt-8">
          <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-5">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Disclaimer</div>
            <p className="text-sm text-zinc-400">
              This model is provided for informational and research purposes. Past performance does not guarantee future results. Sports betting involves significant risk of loss. No guarantee of profitability is implied or should be inferred.
            </p>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span>CFB Edge</span>
            </div>
            <div>Model: Market-Anchored Elo v1.0</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
