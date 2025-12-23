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
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Production Model</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight mb-4">
            T-60 Ensemble Model
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl">
            Three-signal ensemble for college football spread prediction. Validated on 758 bets with +20.6% ROI.
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">

        {/* Backtest Results - First! */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">Backtest Results (2022-2024)</h2>

          <div className="bg-gradient-to-br from-emerald-950/30 to-zinc-900/50 border border-emerald-500/20 rounded-xl p-6 mb-6">
            <div className="grid grid-cols-3 gap-6 text-center mb-6">
              <div>
                <div className="text-3xl font-bold text-white">758</div>
                <div className="text-sm text-zinc-400">Total Bets</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-emerald-400">63.2%</div>
                <div className="text-sm text-zinc-400">Win Rate</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-emerald-400">+20.6%</div>
                <div className="text-sm text-zinc-400">ROI</div>
              </div>
            </div>
            <div className="text-xs text-zinc-500 text-center">
              FBS games only • 2.5-5 point edge filter • T-60 execution timing
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">Year-by-Year Performance</h3>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-zinc-400 font-medium">Season</th>
                  <th className="px-4 py-3 text-right text-zinc-400 font-medium">Bets</th>
                  <th className="px-4 py-3 text-right text-zinc-400 font-medium">Win%</th>
                  <th className="px-4 py-3 text-right text-zinc-400 font-medium">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2022</td>
                  <td className="px-4 py-3 text-right text-zinc-300">350</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">65.7%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">+25.5%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2023</td>
                  <td className="px-4 py-3 text-right text-zinc-300">187</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">63.1%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">+20.5%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2024</td>
                  <td className="px-4 py-3 text-right text-zinc-300">221</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">59.3%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">+13.2%</td>
                </tr>
                <tr className="bg-emerald-500/10">
                  <td className="px-4 py-3 text-white font-bold">Total</td>
                  <td className="px-4 py-3 text-right text-white font-bold">758</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-bold">63.2%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-bold">+20.6%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-zinc-300">
                <strong className="text-blue-400">Chronological Holdout:</strong> Model was trained on 2022-2023 (537 bets, +23.7% ROI) and validated on 2024 holdout (221 bets, +13.2% ROI). All individual years profitable.
              </div>
            </div>
          </div>
        </section>

        {/* Model Overview */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">1. Model Overview</h2>
          <div className="text-zinc-300 space-y-4">
            <p>
              The T-60 Ensemble combines three independent rating systems to generate spread projections. Each system captures different aspects of team strength:
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mt-6">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-400 font-bold">50%</div>
                <div className="font-semibold text-white">Elo</div>
              </div>
              <p className="text-sm text-zinc-400">
                Game-by-game results with margin of victory adjustment. Updates weekly.
              </p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400 font-bold">30%</div>
                <div className="font-semibold text-white">SP+</div>
              </div>
              <p className="text-sm text-zinc-400">
                Efficiency + explosiveness ratings from CollegeFootballData. Season-level.
              </p>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center text-purple-400 font-bold">20%</div>
                <div className="font-semibold text-white">PPA</div>
              </div>
              <p className="text-sm text-zinc-400">
                Points Per Play (EPA-based). Captures offensive/defensive efficiency per snap.
              </p>
            </div>
          </div>
        </section>

        {/* Ensemble Formula */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">2. Ensemble Projection</h2>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.1 Component Spreads</h3>
          <p className="text-zinc-400 mb-4">
            Each rating system produces an independent spread projection:
          </p>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6 font-mono text-sm">
            <div className="space-y-3">
              <div>
                <span className="text-zinc-500">// Elo spread</span>
                <div className="text-white">Spread<sub>elo</sub> = (Elo<sub>home</sub> - Elo<sub>away</sub>) / 25 + HFA</div>
              </div>
              <div>
                <span className="text-zinc-500">// SP+ spread</span>
                <div className="text-white">Spread<sub>sp</sub> = SP+<sub>home</sub> - SP+<sub>away</sub> + HFA</div>
              </div>
              <div>
                <span className="text-zinc-500">// PPA spread (scaled to game level)</span>
                <div className="text-white">Spread<sub>ppa</sub> = (PPA<sub>home</sub> - PPA<sub>away</sub>) × 35 + HFA</div>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">2.2 Weighted Ensemble</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                Spread<sub>model</sub> = 0.50 × Spread<sub>elo</sub> + 0.30 × Spread<sub>sp</sub> + 0.20 × Spread<sub>ppa</sub>
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Home field advantage (HFA) = 2.0 points (optimized from backtest)
              </div>
            </div>
          </div>
        </section>

        {/* Elo Details */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">3. Elo Rating System</h2>

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

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">Rating Update Formula</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                R'<sub>A</sub> = R<sub>A</sub> + K × ln(|MOV| + 1) × (S<sub>A</sub> - E<sub>A</sub>)
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                K-factor scaled by margin of victory (MOV) to weight blowouts more heavily
              </div>
            </div>
          </div>
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

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.2 Edge Filter (Calibrated)</h3>
          <p className="text-zinc-400 mb-4">
            Only edges between 2.5-5 points are actionable. This filter was derived from backtest calibration:
          </p>
          <div className="overflow-hidden rounded-lg border border-zinc-800 mb-6">
            <table className="w-full text-sm">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-zinc-400 font-medium">Edge Range</th>
                  <th className="px-4 py-3 text-right text-zinc-400 font-medium">Win Rate</th>
                  <th className="px-4 py-3 text-right text-zinc-400 font-medium">ROI</th>
                  <th className="px-4 py-3 text-right text-zinc-400 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-400">{'<'} 2.5 pts</td>
                  <td className="px-4 py-3 text-right text-zinc-400">~49%</td>
                  <td className="px-4 py-3 text-right text-red-400">-7%</td>
                  <td className="px-4 py-3 text-right text-zinc-500">SKIP</td>
                </tr>
                <tr className="bg-emerald-500/5">
                  <td className="px-4 py-3 text-emerald-400 font-medium">2.5-3 pts</td>
                  <td className="px-4 py-3 text-right text-emerald-400">59.5%</td>
                  <td className="px-4 py-3 text-right text-emerald-400">+13.6%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">BET</td>
                </tr>
                <tr className="bg-emerald-500/5">
                  <td className="px-4 py-3 text-emerald-400 font-medium">3-4 pts</td>
                  <td className="px-4 py-3 text-right text-emerald-400">55.8%</td>
                  <td className="px-4 py-3 text-right text-emerald-400">+6.6%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">BET</td>
                </tr>
                <tr className="bg-emerald-500/5">
                  <td className="px-4 py-3 text-emerald-400 font-medium">4-5 pts</td>
                  <td className="px-4 py-3 text-right text-emerald-400">54.8%</td>
                  <td className="px-4 py-3 text-right text-emerald-400">+4.5%</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">BET</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-400">5+ pts</td>
                  <td className="px-4 py-3 text-right text-zinc-400">~46%</td>
                  <td className="px-4 py-3 text-right text-red-400">-11%</td>
                  <td className="px-4 py-3 text-right text-zinc-500">SKIP</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">4.3 Side Selection</h3>
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
        </section>

        {/* Execution Timing */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">5. Execution: T-60 Timing</h2>

          <p className="text-zinc-400 mb-4">
            The model is validated on <strong className="text-white">T-60</strong> execution timing: the DraftKings spread available 60 minutes before kickoff. This represents a realistic betting window.
          </p>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 mb-6">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Odds Source</span>
                <span className="text-white">DraftKings (primary)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Execution Window</span>
                <span className="text-white">T-60 (60 min before kickoff)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">T-60 Coverage</span>
                <span className="text-white">94.5% of FBS games (2920 of 3091)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Assumed Juice</span>
                <span className="text-white">-110 standard</span>
              </div>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-zinc-300">
                <strong className="text-amber-400">Why T-60?</strong> Closing lines are unrealistic for execution since they represent the final number right before kickoff. T-60 captures lines you can actually bet while still having high coverage.
              </div>
            </div>
          </div>
        </section>

        {/* Scope */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">6. Scope & Limitations</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="font-semibold text-white mb-2">Coverage</div>
              <ul className="text-sm text-zinc-400 space-y-1">
                <li>• FBS (Division I-A) games only</li>
                <li>• FCS games excluded</li>
                <li>• Spreads only (no totals)</li>
                <li>• Regular season + bowl games</li>
              </ul>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="font-semibold text-white mb-2">Not Used</div>
              <ul className="text-sm text-zinc-400 space-y-1">
                <li>• Contrarian betting logic</li>
                <li>• Confidence filters</li>
                <li>• Line movement signals</li>
                <li>• QB injury adjustments</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Data Sources */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">7. Data Sources</h2>

          <div className="space-y-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="font-semibold text-white mb-1">CollegeFootballData.com API</div>
              <p className="text-sm text-zinc-400 mb-2">Game results, Elo ratings, SP+ ratings, PPA/EPA metrics</p>
              <code className="text-xs text-emerald-400 bg-zinc-800 px-2 py-1 rounded">apinext.collegefootballdata.com</code>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="font-semibold text-white mb-1">The Odds API</div>
              <p className="text-sm text-zinc-400 mb-2">Live betting lines from DraftKings, Bovada</p>
              <code className="text-xs text-emerald-400 bg-zinc-800 px-2 py-1 rounded">api.the-odds-api.com/v4</code>
            </div>
          </div>
        </section>

        {/* Update Schedule */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">8. Update Schedule</h2>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 font-mono text-sm">
            <div className="space-y-2 text-zinc-400">
              <div className="flex justify-between">
                <span>Odds polling</span>
                <span className="text-white">Every 10 minutes</span>
              </div>
              <div className="flex justify-between">
                <span>Edge materialization</span>
                <span className="text-white">Every 15 minutes</span>
              </div>
              <div className="flex justify-between">
                <span>Elo updates</span>
                <span className="text-white">Daily (6:30 AM)</span>
              </div>
              <div className="flex justify-between">
                <span>Results sync</span>
                <span className="text-white">Daily (6:00 AM)</span>
              </div>
              <div className="flex justify-between">
                <span>Bet grading</span>
                <span className="text-white">Daily (7:00 AM)</span>
              </div>
            </div>
          </div>
        </section>

        {/* CBB Section Divider */}
        <div className="relative my-16">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-700"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-[#050505] px-4 text-lg font-bold text-orange-400">College Basketball</span>
          </div>
        </div>

        {/* CBB Hero */}
        <section className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full mb-6">
            <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-orange-400 uppercase tracking-wider">CBB Conference Rating Model v2.1 - Dual Strategy</span>
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight mb-4">
            Dual Strategy: Favorites + Underdogs
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl">
            Conference-aware rating model running two simultaneous strategies. High-volume favorites play (+4% ROI) combined with low-volume, high-ROI underdog plays (+48.7% ROI).
          </p>
        </section>

        {/* CBB Backtest Results */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">CBB Backtest Results (2022-2025)</h2>

          {/* Two Strategy Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Favorites Strategy */}
            <div className="bg-gradient-to-br from-emerald-950/30 to-zinc-900/50 border border-emerald-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-bold">FAV</span>
                <span className="text-white font-semibold">Favorites Strategy</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div>
                  <div className="text-2xl font-bold text-white">857</div>
                  <div className="text-xs text-zinc-400">Bets</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-400">54.5%</div>
                  <div className="text-xs text-zinc-400">Win Rate</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-400">+4.0%</div>
                  <div className="text-xs text-zinc-400">ROI</div>
                </div>
              </div>
              <div className="text-xs text-zinc-500">High volume • Consistent returns</div>
            </div>

            {/* Underdogs Strategy */}
            <div className="bg-gradient-to-br from-amber-950/30 to-zinc-900/50 border border-amber-500/20 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-xs font-bold">DOG</span>
                <span className="text-white font-semibold">Underdogs Strategy</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div>
                  <div className="text-2xl font-bold text-white">86</div>
                  <div className="text-xs text-zinc-400">Bets</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-400">77.9%</div>
                  <div className="text-xs text-zinc-400">Win Rate</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-400">+48.7%</div>
                  <div className="text-xs text-zinc-400">ROI</div>
                </div>
              </div>
              <div className="text-xs text-zinc-500">Low volume • Exceptional ROI</div>
            </div>
          </div>

          {/* Combined Stats */}
          <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">Combined (Both Strategies)</span>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-white"><strong>943</strong> total bets</span>
                <span className="text-orange-400">~<strong>+8.1%</strong> weighted ROI</span>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">Year-by-Year: Underdogs Strategy</h3>
          <div className="overflow-hidden rounded-lg border border-amber-500/20 mb-6">
            <table className="w-full text-sm">
              <thead className="bg-amber-900/20">
                <tr>
                  <th className="px-4 py-3 text-left text-amber-400 font-medium">Season</th>
                  <th className="px-4 py-3 text-right text-amber-400 font-medium">Bets</th>
                  <th className="px-4 py-3 text-right text-amber-400 font-medium">Win%</th>
                  <th className="px-4 py-3 text-right text-amber-400 font-medium">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2022</td>
                  <td className="px-4 py-3 text-right text-zinc-300">30</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">70.0%</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">+33.6%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2023</td>
                  <td className="px-4 py-3 text-right text-zinc-300">29</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">79.3%</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">+51.4%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2024</td>
                  <td className="px-4 py-3 text-right text-zinc-300">16</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">87.5%</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">+67.0%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-white">2025</td>
                  <td className="px-4 py-3 text-right text-zinc-300">11</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">81.8%</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">+56.2%</td>
                </tr>
                <tr className="bg-amber-500/10">
                  <td className="px-4 py-3 text-white font-bold">Total</td>
                  <td className="px-4 py-3 text-right text-white font-bold">86</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-bold">77.9%</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-bold">+48.7%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-zinc-300">
                <strong className="text-blue-400">Key Insight:</strong> The underdog strategy shows remarkably consistent profitability across all 4 seasons (no losing years). Every year has 70%+ win rate.
              </div>
            </div>
          </div>
        </section>

        {/* CBB Strategy */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">CBB Bet Qualification Criteria</h2>

          <p className="text-zinc-400 mb-4">
            Two strategies run simultaneously with shared base criteria but opposite side selection:
          </p>

          {/* Two columns for strategies */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Favorites */}
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-bold">FAV</span>
                <span className="text-white font-semibold">Favorites Strategy</span>
              </div>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-zinc-400">Spread:</span>
                  <span className="text-white">7-14 points</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-zinc-400">Edge:</span>
                  <span className="text-white">≥ 3.0 points</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-zinc-400">Side:</span>
                  <span className="text-white">Bet the favorite</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="text-zinc-400">Filter:</span>
                  <span className="text-white">Favorite must be Elite/High tier</span>
                </div>
              </div>
            </div>

            {/* Underdogs */}
            <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-xs font-bold">DOG</span>
                <span className="text-white font-semibold">Underdogs Strategy</span>
              </div>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400">✓</span>
                  <span className="text-zinc-400">Spread:</span>
                  <span className="text-white">7-14 points</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400">✓</span>
                  <span className="text-zinc-400">Edge:</span>
                  <span className="text-white">≥ 3.0 points</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400">✓</span>
                  <span className="text-zinc-400">Side:</span>
                  <span className="text-white">Bet the underdog</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400">✓</span>
                  <span className="text-zinc-400">Filter:</span>
                  <span className="text-white">Favorite must be Elite/High tier</span>
                </div>
              </div>
            </div>
          </div>

          {/* Shared criteria */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 mb-6">
            <div className="text-sm font-medium text-zinc-400 mb-3">Elite/High Tier Conferences (for both strategies):</div>
            <div className="flex flex-wrap gap-2">
              {['Big 12', 'SEC', 'Big Ten', 'Big East', 'ACC', 'Mountain West'].map(conf => (
                <span key={conf} className="px-2 py-1 bg-zinc-800 text-white text-xs rounded">{conf}</span>
              ))}
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-zinc-300">
                <strong className="text-amber-400">Why Both Sides?</strong> The model identifies when the market has mispriced power conference games. Sometimes the favorite is undervalued (bet FAV), sometimes the underdog is undervalued (bet DOG). The underdog strategy has exceptional 77.9% win rate but lower volume.
              </div>
            </div>
          </div>
        </section>

        {/* CBB Rating Model */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">CBB Conference-Aware Rating System</h2>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 font-mono text-sm mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-zinc-500">HOME_ADVANTAGE</span>
                <span className="text-white ml-4">= 7.4 pts</span>
              </div>
              <div>
                <span className="text-zinc-500">LEARNING_RATE</span>
                <span className="text-white ml-4">= 0.08</span>
              </div>
              <div>
                <span className="text-zinc-500">SEASON_DECAY</span>
                <span className="text-white ml-4">= 70%</span>
              </div>
              <div>
                <span className="text-zinc-500">D1 TEAMS</span>
                <span className="text-white ml-4">= 364</span>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">Conference Ratings</h3>
          <p className="text-zinc-400 mb-4">
            Derived from analysis of 9,600 cross-conference games:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
              <div className="text-xs text-emerald-400 uppercase mb-1">Elite Tier</div>
              <div className="text-sm text-white">Big 12 (+12), SEC (+11), Big Ten (+9)</div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="text-xs text-blue-400 uppercase mb-1">High Tier</div>
              <div className="text-sm text-white">Big East (+7), ACC (+5), MWC (+5)</div>
            </div>
            <div className="bg-zinc-700/30 border border-zinc-600 rounded-lg p-3">
              <div className="text-xs text-zinc-400 uppercase mb-1">Mid Tier</div>
              <div className="text-sm text-white">A-10, WCC, AAC, MVC, MAC...</div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">Spread Projection</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                Spread<sub>model</sub> = (Rating<sub>away</sub> + Conf<sub>away</sub>) - (Rating<sub>home</sub> + Conf<sub>home</sub>) - 7.4
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Team rating + Conference bonus, with 7.4 point home advantage
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-white mt-6 mb-3">Live Updates</h3>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 mb-6">
            <div className="text-center font-mono">
              <div className="text-lg text-white mb-2">
                Rating<sub>new</sub> = Rating<sub>old</sub> + 0.08 × (Actual - Predicted)
              </div>
              <div className="text-sm text-zinc-500 mt-4">
                Ratings update after every completed game
              </div>
            </div>
          </div>
        </section>

        {/* CBB vs CFB Comparison */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-zinc-800">CFB vs CBB Model Comparison</h2>

          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-zinc-400 font-medium">Aspect</th>
                  <th className="px-4 py-3 text-center text-emerald-400 font-medium">CFB</th>
                  <th className="px-4 py-3 text-center text-emerald-400 font-medium">CBB FAV</th>
                  <th className="px-4 py-3 text-center text-amber-400 font-medium">CBB DOG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">Model Type</td>
                  <td className="px-4 py-3 text-center text-white">T-60 Ensemble</td>
                  <td className="px-4 py-3 text-center text-white" colSpan={2}>Conference-Aware Rating</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">Bet Side</td>
                  <td className="px-4 py-3 text-center text-white">Both</td>
                  <td className="px-4 py-3 text-center text-white">Favorites</td>
                  <td className="px-4 py-3 text-center text-white">Underdogs</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">Spread Filter</td>
                  <td className="px-4 py-3 text-center text-white">None</td>
                  <td className="px-4 py-3 text-center text-white">7-14 pts</td>
                  <td className="px-4 py-3 text-center text-white">7-14 pts</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">Edge Filter</td>
                  <td className="px-4 py-3 text-center text-white">2.5-5 pts</td>
                  <td className="px-4 py-3 text-center text-white">≥ 3 pts</td>
                  <td className="px-4 py-3 text-center text-white">≥ 3 pts</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">Win Rate</td>
                  <td className="px-4 py-3 text-center text-emerald-400">63.2%</td>
                  <td className="px-4 py-3 text-center text-emerald-400">54.5%</td>
                  <td className="px-4 py-3 text-center text-amber-400 font-bold">77.9%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">ROI</td>
                  <td className="px-4 py-3 text-center text-emerald-400">+20.6%</td>
                  <td className="px-4 py-3 text-center text-emerald-400">+4.0%</td>
                  <td className="px-4 py-3 text-center text-amber-400 font-bold">+48.7%</td>
                </tr>
                <tr className="bg-zinc-900/30">
                  <td className="px-4 py-3 text-zinc-300">Total Bets</td>
                  <td className="px-4 py-3 text-center text-white">758</td>
                  <td className="px-4 py-3 text-center text-white">857</td>
                  <td className="px-4 py-3 text-center text-white">86</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="border-t border-zinc-800/50 pt-8">
          <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-5">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Disclaimer</div>
            <p className="text-sm text-zinc-400">
              These models are provided for informational and research purposes. Past performance does not guarantee future results. Sports betting involves significant risk of loss. The backtest results shown use historical data with T-60 execution timing and -110 juice assumptions. Actual results may vary.
            </p>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span>CFB Edge</span>
            </div>
            <div>CFB: T-60 Ensemble v1.0 • CBB: Conference Rating v2.1 Dual • December 2025</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
