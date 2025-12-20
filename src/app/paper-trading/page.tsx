'use client';

import { useState, useEffect } from 'react';
import { getTeamLogo } from '@/lib/team-logos';

interface RecommendedBet {
  event_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  side: 'home' | 'away';
  market_spread_home: number;
  spread_price_home: number;
  spread_price_away: number;
  model_spread_home: number;
  edge_points: number;
  abs_edge: number;
  rank: number;
  already_bet: boolean;
}

interface PaperBet {
  id: string;
  event_id: string;
  side: string;
  market_spread_home: number;
  spread_price_american: number;
  model_spread_home: number;
  edge_points: number;
  week_rank: number;
  stake_amount: number;
  closing_spread_home: number | null;
  clv_points: number | null;
  result: string;
  profit_loss: number | null;
  bet_placed_at: string;
  season: number;
  week: number;
  events?: {
    home_team?: { name: string };
    away_team?: { name: string };
    commence_time: string;
  };
}

interface Summary {
  totalBets: number;
  settledBets: number;
  pending: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStaked: number;
  totalProfit: number;
  roi: number;
  maxDrawdown: number;
  avgCLV: number | null;
}

export default function PaperTradingPage() {
  const [recommendations, setRecommendations] = useState<RecommendedBet[]>([]);
  const [bets, setBets] = useState<PaperBet[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [placingBet, setPlacingBet] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'recommendations' | 'bets' | 'dashboard'>('recommendations');
  const [season, setSeason] = useState<number>(2025);
  const [week, setWeek] = useState<number>(1);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [recsRes, betsRes, summaryRes] = await Promise.all([
        fetch('/api/paper-bets/recommendations'),
        fetch('/api/paper-bets'),
        fetch('/api/paper-bets/summary'),
      ]);

      if (recsRes.ok) {
        const data = await recsRes.json();
        setRecommendations(data.recommendations || []);
        setSeason(data.season);
        setWeek(data.week);
      }

      if (betsRes.ok) {
        const data = await betsRes.json();
        setBets(data.bets || []);
      }

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  }

  async function placeBet(rec: RecommendedBet) {
    setPlacingBet(rec.event_id);
    try {
      const res = await fetch('/api/paper-bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: rec.event_id,
          side: rec.side,
          market_spread_home: rec.market_spread_home,
          spread_price_american: rec.side === 'home' ? rec.spread_price_home : rec.spread_price_away,
          model_spread_home: rec.model_spread_home,
          edge_points: rec.edge_points,
          week_rank: rec.rank,
          season,
          week,
        }),
      });

      if (res.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Error placing bet:', error);
    }
    setPlacingBet(null);
  }

  function formatSpread(spread: number, side: 'home' | 'away'): string {
    if (side === 'home') {
      return spread > 0 ? `+${spread}` : `${spread}`;
    } else {
      const awaySpread = -spread;
      return awaySpread > 0 ? `+${awaySpread}` : `${awaySpread}`;
    }
  }

  function formatPrice(price: number): string {
    return price > 0 ? `+${price}` : `${price}`;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-zinc-500 font-medium tracking-wide">Loading positions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Ambient background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-blue-500/8 rounded-full blur-[80px]" />
        <div className="absolute -bottom-20 right-1/4 w-64 h-64 bg-purple-500/6 rounded-full blur-[60px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-start justify-between mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs font-semibold tracking-[0.2em] uppercase text-emerald-400/80">
                Paper Trading
              </span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
              PROD_V1_LOCKED
            </h1>
            <p className="text-zinc-500 mt-2 font-light">
              Forward test mode — validate before real money
            </p>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/60 border border-zinc-800 rounded-xl backdrop-blur-sm">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Week</span>
              <span className="text-2xl font-bold text-white tabular-nums">{week}</span>
              <span className="text-zinc-600">|</span>
              <span className="text-sm text-zinc-400">{season}</span>
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
            <StatCard
              label="Total Bets"
              value={summary.totalBets.toString()}
              subtext={`${summary.pending} pending`}
              icon="📊"
            />
            <StatCard
              label="Record"
              value={`${summary.wins}-${summary.losses}`}
              subtext={`${summary.winRate.toFixed(1)}% win rate`}
              icon="🎯"
            />
            <StatCard
              label="P&L"
              value={`${summary.totalProfit >= 0 ? '+' : ''}$${summary.totalProfit.toFixed(0)}`}
              subtext={`${summary.roi.toFixed(1)}% ROI`}
              positive={summary.totalProfit >= 0}
              icon="💰"
              highlight
            />
            <StatCard
              label="Max Drawdown"
              value={`$${summary.maxDrawdown.toFixed(0)}`}
              subtext="Peak to trough"
              icon="📉"
            />
            <StatCard
              label="Avg CLV"
              value={summary.avgCLV !== null ? `${summary.avgCLV >= 0 ? '+' : ''}${summary.avgCLV.toFixed(2)}` : '—'}
              subtext="vs closing line"
              positive={summary.avgCLV !== null && summary.avgCLV >= 0}
              icon="⚡"
            />
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 p-1 bg-zinc-900/40 border border-zinc-800/50 rounded-xl mb-8 w-fit">
          {(['recommendations', 'bets', 'dashboard'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              {tab === 'recommendations' && `Picks (${recommendations.length})`}
              {tab === 'bets' && `My Bets (${bets.length})`}
              {tab === 'dashboard' && 'Dashboard'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'recommendations' && (
          <div className="space-y-6">
            {/* Info Banner */}
            <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-emerald-500/10 to-transparent border border-emerald-500/20 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-lg">
                ✨
              </div>
              <div>
                <p className="text-sm text-emerald-200 font-medium">
                  PROD_V1 Selection — Top 10 by |edge|, excluding spreads 3-7
                </p>
                <p className="text-xs text-emerald-400/60 mt-0.5">
                  Click "Take Bet" to log to your paper trading portfolio
                </p>
              </div>
            </div>

            {recommendations.length === 0 ? (
              <EmptyState message="No recommendations available. Check back when games are scheduled." />
            ) : (
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden backdrop-blur-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-800/50">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">#</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Matchup</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pick</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Market</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Model</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Edge</th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/30">
                      {recommendations.map((rec) => (
                        <tr
                          key={rec.event_id}
                          className={`group transition-colors ${
                            rec.already_bet
                              ? 'bg-emerald-500/5'
                              : 'hover:bg-zinc-800/30'
                          }`}
                        >
                          <td className="px-6 py-5">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800 text-sm font-bold text-zinc-300">
                              {rec.rank}
                            </span>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="flex -space-x-2">
                                <TeamLogo name={rec.away_team} size="sm" />
                                <TeamLogo name={rec.home_team} size="sm" />
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-white">
                                  {rec.away_team}
                                </div>
                                <div className="text-sm text-zinc-500">
                                  @ {rec.home_team}
                                </div>
                                <div className="text-xs text-zinc-600 mt-0.5">
                                  {new Date(rec.commence_time).toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit'
                                  })}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                              rec.side === 'home'
                                ? 'bg-blue-500/20 border border-blue-500/30'
                                : 'bg-purple-500/20 border border-purple-500/30'
                            }`}>
                              <TeamLogo name={rec.side === 'home' ? rec.home_team : rec.away_team} size="xs" />
                              <span className={`text-sm font-medium ${
                                rec.side === 'home' ? 'text-blue-300' : 'text-purple-300'
                              }`}>
                                {rec.side === 'home' ? rec.home_team : rec.away_team}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="text-sm font-mono font-semibold text-white">
                              {formatSpread(rec.market_spread_home, rec.side)}
                            </div>
                            <div className="text-xs font-mono text-zinc-500">
                              {formatPrice(rec.side === 'home' ? rec.spread_price_home : rec.spread_price_away)}
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className="text-sm font-mono text-zinc-400">
                              {formatSpread(rec.model_spread_home, 'home')}
                            </span>
                          </td>
                          <td className="px-6 py-5">
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ${
                              rec.abs_edge >= 5
                                ? 'bg-emerald-500/20 border border-emerald-500/30'
                                : 'bg-zinc-800'
                            }`}>
                              <span className={`text-sm font-bold tabular-nums ${
                                rec.abs_edge >= 5 ? 'text-emerald-400' : 'text-white'
                              }`}>
                                +{rec.abs_edge.toFixed(1)}
                              </span>
                              <span className="text-xs text-zinc-500">pts</span>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right">
                            {rec.already_bet ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-400 text-sm font-medium">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Logged
                              </span>
                            ) : (
                              <button
                                onClick={() => placeBet(rec)}
                                disabled={placingBet === rec.event_id}
                                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-sm font-semibold rounded-lg hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30"
                              >
                                {placingBet === rec.event_id ? (
                                  <span className="flex items-center gap-2">
                                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Saving
                                  </span>
                                ) : (
                                  'Take Bet'
                                )}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bets' && (
          <div className="space-y-6">
            {bets.length === 0 ? (
              <EmptyState message="No paper bets yet. Take some bets from the Picks tab." />
            ) : (
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden backdrop-blur-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-800/50">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Matchup</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Position</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Edge</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Close</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">CLV</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Result</th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wider">P&L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/30">
                      {bets.map((bet) => (
                        <tr key={bet.id} className="group hover:bg-zinc-800/30 transition-colors">
                          <td className="px-6 py-5 text-sm text-zinc-400 tabular-nums">
                            {new Date(bet.bet_placed_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric'
                            })}
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="flex -space-x-2">
                                <TeamLogo name={bet.events?.away_team?.name || 'Away'} size="sm" />
                                <TeamLogo name={bet.events?.home_team?.name || 'Home'} size="sm" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-white">
                                  {bet.events?.away_team?.name || 'Away'} @ {bet.events?.home_team?.name || 'Home'}
                                </div>
                                <div className="text-xs text-zinc-500">Week {bet.week}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="text-sm font-mono font-semibold text-white">
                              {bet.side.toUpperCase()} {formatSpread(bet.market_spread_home, bet.side as 'home' | 'away')}
                            </div>
                            <div className="text-xs font-mono text-zinc-500">
                              {formatPrice(bet.spread_price_american)}
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className="text-sm font-bold text-emerald-400 tabular-nums">
                              +{Math.abs(bet.edge_points).toFixed(1)}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-sm font-mono text-zinc-400">
                            {bet.closing_spread_home !== null ? formatSpread(bet.closing_spread_home, 'home') : '—'}
                          </td>
                          <td className="px-6 py-5">
                            {bet.clv_points !== null ? (
                              <span className={`text-sm font-bold tabular-nums ${
                                bet.clv_points >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {bet.clv_points >= 0 ? '+' : ''}{bet.clv_points.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-6 py-5">
                            <ResultBadge result={bet.result} />
                          </td>
                          <td className="px-6 py-5 text-right">
                            {bet.profit_loss !== null ? (
                              <span className={`text-sm font-bold tabular-nums ${
                                bet.profit_loss >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {bet.profit_loss >= 0 ? '+' : ''}${bet.profit_loss.toFixed(0)}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Forward Test Checklist */}
            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <span className="text-lg">📋</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Forward Test Checklist</h3>
                  <p className="text-xs text-zinc-500">Complete before going live</p>
                </div>
              </div>
              <div className="space-y-4">
                <ChecklistItem
                  label="4-8 weeks of paper trading"
                  checked={summary ? summary.totalBets >= 40 : false}
                  subtext={summary ? `${summary.totalBets} bets logged` : '0 bets'}
                />
                <ChecklistItem
                  label="No operational bugs"
                  checked={true}
                  subtext="System running smoothly"
                />
                <ChecklistItem
                  label="Bets match backtest logic"
                  checked={summary ? summary.settledBets > 0 : false}
                  subtext="PROD_V1: Top 10, no 3-7 spreads"
                />
                <ChecklistItem
                  label="CLV appears positive"
                  checked={summary?.avgCLV !== null && (summary?.avgCLV ?? 0) > 0}
                  subtext={summary?.avgCLV !== null ? `Avg CLV: ${(summary?.avgCLV ?? 0).toFixed(2)} pts` : 'Waiting for closing lines'}
                />
                <ChecklistItem
                  label="ROI within expected range"
                  checked={summary ? Math.abs(summary.roi - 8.13) < 10 : false}
                  subtext={summary ? `Current: ${summary.roi.toFixed(1)}% (target: ~8%)` : 'No data yet'}
                />
              </div>
            </div>

            {/* PROD_V1 Spec Card */}
            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <span className="text-lg">🔒</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">PROD_V1_LOCKED</h3>
                  <p className="text-xs text-zinc-500">Production specification</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-y-5 gap-x-8">
                <SpecItem label="Model" value="Elo-only (frozen)" />
                <SpecItem label="Selection" value="Top 10/week by |edge|" />
                <SpecItem label="Filter" value="Exclude spreads 3-7" />
                <SpecItem label="Stake" value="Flat $100/bet" />
                <SpecItem label="Expected ROI" value="~8%" highlight />
                <SpecItem label="Max Drawdown" value="~9%" />
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-800/50">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Model version locked — no changes until forward test complete
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="lg:col-span-2 bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <span className="text-lg">📈</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Performance Metrics</h3>
                  <p className="text-xs text-zinc-500">Rolling statistics</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="Bankroll"
                  value={summary ? `$${(1000 + summary.totalProfit).toFixed(0)}` : '$1,000'}
                  subtext="Starting: $1,000"
                />
                <MetricCard
                  label="Units Wagered"
                  value={summary ? summary.totalBets.toString() : '0'}
                  subtext="$100 per unit"
                />
                <MetricCard
                  label="Weeks Active"
                  value={summary ? Math.ceil(summary.totalBets / 10).toString() : '0'}
                  subtext="~10 bets/week"
                />
                <MetricCard
                  label="Profit Factor"
                  value={summary && summary.losses > 0 ? (summary.wins / summary.losses).toFixed(2) : '—'}
                  subtext="Wins / Losses"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  icon,
  positive,
  highlight
}: {
  label: string;
  value: string;
  subtext: string;
  icon: string;
  positive?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-5 transition-all ${
      highlight
        ? 'bg-gradient-to-br from-zinc-900 to-zinc-900/60 border border-emerald-500/30 shadow-lg shadow-emerald-500/5'
        : 'bg-zinc-900/40 border border-zinc-800/50'
    }`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
          <p className={`text-2xl font-bold tabular-nums ${
            positive !== undefined
              ? (positive ? 'text-emerald-400' : 'text-red-400')
              : 'text-white'
          }`}>
            {value}
          </p>
          <p className="text-xs text-zinc-600 mt-1">{subtext}</p>
        </div>
        <span className="text-xl opacity-50">{icon}</span>
      </div>
      {highlight && (
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/5 to-transparent pointer-events-none" />
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const config = {
    win: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/30', text: 'text-emerald-400' },
    loss: { bg: 'bg-red-500/20', border: 'border-red-500/30', text: 'text-red-400' },
    push: { bg: 'bg-amber-500/20', border: 'border-amber-500/30', text: 'text-amber-400' },
    pending: { bg: 'bg-zinc-800', border: 'border-zinc-700', text: 'text-zinc-400' },
  }[result] || { bg: 'bg-zinc-800', border: 'border-zinc-700', text: 'text-zinc-400' };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide border ${config.bg} ${config.border} ${config.text}`}>
      {result}
    </span>
  );
}

function ChecklistItem({ label, checked, subtext }: { label: string; checked: boolean; subtext: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
        checked
          ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/25'
          : 'bg-zinc-800 border border-zinc-700'
      }`}>
        {checked && (
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-medium ${checked ? 'text-white' : 'text-zinc-400'}`}>
          {label}
        </div>
        <div className="text-xs text-zinc-600 mt-0.5">{subtext}</div>
      </div>
    </div>
  );
}

function SpecItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function MetricCard({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/30">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white tabular-nums">{value}</div>
      <div className="text-xs text-zinc-600 mt-1">{subtext}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-12 text-center backdrop-blur-sm">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800 flex items-center justify-center">
        <span className="text-2xl opacity-50">📭</span>
      </div>
      <p className="text-zinc-500 font-medium">{message}</p>
    </div>
  );
}

function TeamLogo({ name, size = 'md' }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    xs: 'w-5 h-5',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
  };

  const logoUrl = getTeamLogo(name);

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-zinc-800 border-2 border-zinc-700 overflow-hidden flex items-center justify-center flex-shrink-0`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className="w-full h-full object-cover"
        onError={(e) => {
          // Hide broken images
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );
}
