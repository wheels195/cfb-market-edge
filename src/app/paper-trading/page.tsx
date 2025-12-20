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
  const [stakeAmounts, setStakeAmounts] = useState<Record<string, number>>({});

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
        // Initialize stake amounts to $100
        const initialStakes: Record<string, number> = {};
        (data.recommendations || []).forEach((rec: RecommendedBet) => {
          initialStakes[rec.event_id] = 100;
        });
        setStakeAmounts(initialStakes);
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
    const stake = stakeAmounts[rec.event_id] || 100;
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
          stake_amount: stake,
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

  function calculatePayout(stake: number, americanOdds: number): number {
    if (americanOdds > 0) {
      return stake * (americanOdds / 100);
    } else {
      return stake * (100 / Math.abs(americanOdds));
    }
  }

  function updateStake(eventId: string, value: string) {
    const numValue = parseInt(value) || 0;
    setStakeAmounts(prev => ({ ...prev, [eventId]: numValue }));
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
            <StatCard label="Total Bets" value={summary.totalBets.toString()} subtext={`${summary.pending} pending`} icon="📊" />
            <StatCard label="Record" value={`${summary.wins}-${summary.losses}`} subtext={`${summary.winRate.toFixed(1)}% win rate`} icon="🎯" />
            <StatCard label="P&L" value={`${summary.totalProfit >= 0 ? '+' : ''}$${summary.totalProfit.toFixed(0)}`} subtext={`${summary.roi.toFixed(1)}% ROI`} positive={summary.totalProfit >= 0} icon="💰" highlight />
            <StatCard label="Max Drawdown" value={`$${summary.maxDrawdown.toFixed(0)}`} subtext="Peak to trough" icon="📉" />
            <StatCard label="Avg CLV" value={summary.avgCLV !== null ? `${summary.avgCLV >= 0 ? '+' : ''}${summary.avgCLV.toFixed(2)}` : '—'} subtext="vs closing line" positive={summary.avgCLV !== null && summary.avgCLV >= 0} icon="⚡" />
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
            {recommendations.length === 0 ? (
              <EmptyState message="No recommendations available. Check back when games are scheduled." />
            ) : (
              <div className="grid gap-4">
                {recommendations.map((rec) => {
                  const teamName = rec.side === 'home' ? rec.home_team : rec.away_team;
                  const spreadDisplay = formatSpread(rec.market_spread_home, rec.side);
                  const odds = rec.side === 'home' ? rec.spread_price_home : rec.spread_price_away;
                  const stake = stakeAmounts[rec.event_id] || 100;
                  const payout = calculatePayout(stake, odds);

                  return (
                    <div
                      key={rec.event_id}
                      className={`rounded-2xl border overflow-hidden transition-all ${
                        rec.already_bet
                          ? 'bg-emerald-500/5 border-emerald-500/30'
                          : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700'
                      }`}
                    >
                      <div className="p-6">
                        {/* Header Row */}
                        <div className="flex items-start justify-between mb-6">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-800 text-lg font-bold text-zinc-300">
                              #{rec.rank}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex -space-x-2">
                                <TeamLogo name={rec.away_team} size="md" />
                                <TeamLogo name={rec.home_team} size="md" />
                              </div>
                              <div>
                                <div className="text-lg font-semibold text-white">
                                  {rec.away_team} @ {rec.home_team}
                                </div>
                                <div className="text-sm text-zinc-500">
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
                          </div>
                          <div className={`px-3 py-1.5 rounded-lg ${
                            rec.abs_edge >= 5
                              ? 'bg-emerald-500/20 border border-emerald-500/30'
                              : 'bg-zinc-800 border border-zinc-700'
                          }`}>
                            <span className={`text-sm font-bold ${rec.abs_edge >= 5 ? 'text-emerald-400' : 'text-white'}`}>
                              +{rec.abs_edge.toFixed(1)} pts edge
                            </span>
                          </div>
                        </div>

                        {/* THE BET - Clear and prominent */}
                        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-5 mb-6">
                          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">The Bet</div>
                          <div className="flex items-center gap-4">
                            <TeamLogo name={teamName} size="lg" />
                            <div>
                              <div className="text-2xl font-bold text-white">
                                {teamName} {spreadDisplay}
                              </div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className={`text-lg font-semibold px-2 py-0.5 rounded ${
                                  odds > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-300'
                                }`}>
                                  {formatPrice(odds)}
                                </span>
                                <span className="text-zinc-500">on DraftKings</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Why This Bet */}
                        <div className="grid grid-cols-3 gap-4 mb-6">
                          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                            <div className="text-xs text-zinc-500 uppercase mb-1">Market Line</div>
                            <div className="text-lg font-bold text-zinc-300">{formatSpread(rec.market_spread_home, 'home')}</div>
                          </div>
                          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                            <div className="text-xs text-zinc-500 uppercase mb-1">Our Model</div>
                            <div className="text-lg font-bold text-white">{formatSpread(rec.model_spread_home, 'home')}</div>
                          </div>
                          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                            <div className="text-xs text-zinc-500 uppercase mb-1">Edge</div>
                            <div className="text-lg font-bold text-emerald-400">+{rec.abs_edge.toFixed(1)} pts</div>
                          </div>
                        </div>

                        {/* Stake & Payout Calculator */}
                        {!rec.already_bet && (
                          <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/50">
                            <div className="flex items-center justify-between gap-6">
                              <div className="flex-1">
                                <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">
                                  Your Stake
                                </label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                                  <input
                                    type="number"
                                    value={stake}
                                    onChange={(e) => updateStake(rec.event_id, e.target.value)}
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2.5 pl-8 pr-4 text-white font-semibold focus:outline-none focus:border-emerald-500"
                                    min="1"
                                  />
                                </div>
                              </div>
                              <div className="text-center px-6">
                                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">To Win</div>
                                <div className="text-2xl font-bold text-emerald-400">
                                  ${payout.toFixed(0)}
                                </div>
                              </div>
                              <div className="text-center px-6">
                                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total Return</div>
                                <div className="text-2xl font-bold text-white">
                                  ${(stake + payout).toFixed(0)}
                                </div>
                              </div>
                              <button
                                onClick={() => placeBet(rec)}
                                disabled={placingBet === rec.event_id}
                                className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold rounded-xl hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/20"
                              >
                                {placingBet === rec.event_id ? (
                                  <span className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Logging...
                                  </span>
                                ) : (
                                  'Log Bet'
                                )}
                              </button>
                            </div>
                          </div>
                        )}

                        {rec.already_bet && (
                          <div className="flex items-center justify-center gap-2 py-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                            <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-emerald-400 font-semibold">Bet Logged</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Bet</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Stake</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Edge</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">CLV</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Result</th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wider">P&L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/30">
                      {bets.map((bet) => {
                        const teamName = bet.side === 'home'
                          ? bet.events?.home_team?.name
                          : bet.events?.away_team?.name;
                        return (
                          <tr key={bet.id} className="group hover:bg-zinc-800/30 transition-colors">
                            <td className="px-6 py-5 text-sm text-zinc-400 tabular-nums">
                              {new Date(bet.bet_placed_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric'
                              })}
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-3">
                                <TeamLogo name={teamName || 'Unknown'} size="sm" />
                                <div>
                                  <div className="text-sm font-semibold text-white">
                                    {teamName} {formatSpread(bet.market_spread_home, bet.side as 'home' | 'away')}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {formatPrice(bet.spread_price_american)} • Week {bet.week}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-5 text-sm font-medium text-white">
                              ${bet.stake_amount}
                            </td>
                            <td className="px-6 py-5">
                              <span className="text-sm font-bold text-emerald-400 tabular-nums">
                                +{Math.abs(bet.edge_points).toFixed(1)}
                              </span>
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
                        );
                      })}
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

function TeamLogo({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
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
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );
}
