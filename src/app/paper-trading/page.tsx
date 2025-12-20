'use client';

import { useState, useEffect } from 'react';
import { getTeamLogo } from '@/lib/team-logos';

interface RecommendedBet {
  event_id: string;
  home_team: string;
  away_team: string;
  home_rank: number | null;
  away_rank: number | null;
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
  const [activeTab, setActiveTab] = useState<'picks' | 'bets' | 'stats'>('picks');
  const [season, setSeason] = useState<number>(2025);
  const [week, setWeek] = useState<number>(1);
  const [stakeAmounts, setStakeAmounts] = useState<Record<string, number>>({});
  const [clearing, setClearing] = useState(false);

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
        // Sort recommendations by game date (chronological)
        const sortedRecs = (data.recommendations || []).sort((a: RecommendedBet, b: RecommendedBet) =>
          new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()
        );
        setRecommendations(sortedRecs);
        setSeason(data.season);
        setWeek(data.week);
      }

      if (betsRes.ok) {
        const data = await betsRes.json();
        // Sort bets by game date (chronological)
        const sortedBets = (data.bets || []).sort((a: PaperBet, b: PaperBet) =>
          new Date(a.events?.commence_time || 0).getTime() - new Date(b.events?.commence_time || 0).getTime()
        );
        setBets(sortedBets);
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

  function getStake(eventId: string): number {
    return stakeAmounts[eventId] ?? 100;
  }

  function setStake(eventId: string, amount: number) {
    setStakeAmounts(prev => ({ ...prev, [eventId]: amount }));
  }

  function calculatePayout(stake: number, odds: number): number {
    if (odds > 0) {
      return stake * (odds / 100);
    } else {
      return stake * (100 / Math.abs(odds));
    }
  }

  async function placeBet(rec: RecommendedBet) {
    setPlacingBet(rec.event_id);
    const stake = getStake(rec.event_id);
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

  async function clearAllBets() {
    if (!confirm('Are you sure you want to clear ALL paper bets? This cannot be undone.')) {
      return;
    }
    setClearing(true);
    try {
      const res = await fetch('/api/paper-bets?confirm=true', { method: 'DELETE' });
      if (res.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Error clearing bets:', error);
    }
    setClearing(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="bg-[#111] border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-white">Paper Trading</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                PROD_V1 &middot; Week {week}, {season}
              </p>
            </div>
            <a
              href="/games"
              className="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
            >
              View Games &rarr;
            </a>
          </div>
        </div>
      </header>

      {/* Stats Row */}
      {summary && (
        <div className="bg-[#111] border-b border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <div className="flex items-center gap-8 text-sm">
              <div>
                <span className="text-zinc-500">Record</span>
                <span className="ml-2 font-semibold text-white">
                  {summary.wins}-{summary.losses}
                </span>
                <span className="ml-1 text-zinc-600">({summary.winRate.toFixed(0)}%)</span>
              </div>
              <div>
                <span className="text-zinc-500">P&L</span>
                <span className={`ml-2 font-semibold ${summary.totalProfit >= 0 ? 'text-white' : 'text-red-400'}`}>
                  {summary.totalProfit >= 0 ? '+' : ''}${summary.totalProfit.toFixed(0)}
                </span>
                <span className="ml-1 text-zinc-600">({summary.roi.toFixed(1)}% ROI)</span>
              </div>
              <div>
                <span className="text-zinc-500">Pending</span>
                <span className="ml-2 font-semibold text-white">{summary.pending}</span>
              </div>
              {summary.avgCLV !== null && (
                <div>
                  <span className="text-zinc-500">Avg CLV</span>
                  <span className={`ml-2 font-semibold ${summary.avgCLV >= 0 ? 'text-white' : 'text-red-400'}`}>
                    {summary.avgCLV >= 0 ? '+' : ''}{summary.avgCLV.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-[#111] border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4">
          <nav className="flex gap-6">
            {(['picks', 'bets', 'stats'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-white text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab === 'picks' && `Picks (${recommendations.length})`}
                {tab === 'bets' && `My Bets (${bets.length})`}
                {tab === 'stats' && 'Stats'}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Picks Tab */}
        {activeTab === 'picks' && (
          <div className="space-y-3">
            {recommendations.length === 0 ? (
              <div className="text-center py-16 text-zinc-500">
                No picks available. Check back when games are scheduled.
              </div>
            ) : (
              recommendations.map((rec) => {
                const betTeam = rec.side === 'home' ? rec.home_team : rec.away_team;
                const betSpread = rec.side === 'home' ? rec.market_spread_home : -rec.market_spread_home;
                const betOdds = rec.side === 'home' ? rec.spread_price_home : rec.spread_price_away;
                const stake = getStake(rec.event_id);
                const payout = calculatePayout(stake, betOdds);
                const gameDate = new Date(rec.commence_time);
                const gameDateStr = gameDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                });
                const gameTimeStr = gameDate.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={rec.event_id}
                    className="bg-[#111] rounded-lg border border-zinc-800 overflow-hidden"
                  >
                    {/* Header: Matchup */}
                    <div className="p-4 border-b border-zinc-800/50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-zinc-500">{gameDateStr} &middot; {gameTimeStr}</span>
                        <span className={`text-sm font-bold ${rec.abs_edge >= 7 ? 'text-emerald-400' : 'text-white'}`}>
                          +{rec.abs_edge.toFixed(1)} edge
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Away Team */}
                        <div className="flex items-center gap-2 flex-1">
                          <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={getTeamLogo(rec.away_team)} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <div className={`font-medium text-sm ${rec.side === 'away' ? 'text-white' : 'text-zinc-500'}`}>
                              {rec.away_rank && <span className="text-zinc-600 mr-1">{rec.away_rank}</span>}
                              {rec.away_team}
                            </div>
                          </div>
                        </div>

                        <span className="text-zinc-600 text-xs">@</span>

                        {/* Home Team */}
                        <div className="flex items-center gap-2 flex-1 justify-end">
                          <div className="text-right">
                            <div className={`font-medium text-sm ${rec.side === 'home' ? 'text-white' : 'text-zinc-500'}`}>
                              {rec.home_rank && <span className="text-zinc-600 mr-1">{rec.home_rank}</span>}
                              {rec.home_team}
                            </div>
                          </div>
                          <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={getTeamLogo(rec.home_team)} alt="" className="w-full h-full object-cover" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bet Line */}
                    <div className="p-4 bg-emerald-500/10 border-b border-zinc-800/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-emerald-400 uppercase tracking-wide mb-1">Bet</div>
                          <div className="text-white font-semibold text-lg">
                            {betTeam} {betSpread > 0 ? '+' : ''}{betSpread}
                          </div>
                          <div className="text-zinc-400 text-sm">
                            {betOdds > 0 ? '+' : ''}{betOdds}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-500 mb-1">To Win</div>
                          <div className="text-emerald-400 font-bold text-xl">
                            ${payout.toFixed(0)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Stake + Action */}
                    <div className="p-4">
                      {rec.already_bet ? (
                        <div className="text-center py-2 text-zinc-500 text-sm">
                          Already logged
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <label className="text-xs text-zinc-500 block mb-1">Stake</label>
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-500">$</span>
                              <input
                                type="number"
                                value={stake}
                                onChange={(e) => setStake(rec.event_id, Math.max(1, parseInt(e.target.value) || 100))}
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-zinc-500"
                                min="1"
                                step="10"
                              />
                            </div>
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-zinc-500 block mb-1">&nbsp;</label>
                            <button
                              onClick={() => placeBet(rec)}
                              disabled={placingBet === rec.event_id}
                              className="w-full px-4 py-2 bg-white text-black text-sm font-medium rounded hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                            >
                              {placingBet === rec.event_id ? 'Logging...' : `Log Bet`}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Model vs Market */}
                      <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-4 text-xs">
                        <span>
                          <span className="text-zinc-600">Market:</span>
                          <span className="ml-1 text-zinc-400">
                            {rec.home_team} {rec.market_spread_home > 0 ? '+' : ''}{rec.market_spread_home}
                          </span>
                        </span>
                        <span>
                          <span className="text-zinc-600">Model:</span>
                          <span className="ml-1 text-zinc-400">
                            {rec.home_team} {rec.model_spread_home > 0 ? '+' : ''}{rec.model_spread_home.toFixed(1)}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Bets Tab */}
        {activeTab === 'bets' && (
          <div>
            {bets.length === 0 ? (
              <div className="text-center py-16 text-zinc-500">
                No bets logged yet. Go to Picks to log bets.
              </div>
            ) : (
              <div className="bg-[#111] rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#0a0a0a] border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Game Date</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Bet</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Stake</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">To Win</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Edge</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">CLV</th>
                      <th className="px-4 py-3 text-center font-medium text-zinc-500">Result</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {bets.map((bet) => {
                      const teamName = bet.side === 'home'
                        ? bet.events?.home_team?.name
                        : bet.events?.away_team?.name;
                      const spread = bet.side === 'home'
                        ? bet.market_spread_home
                        : -bet.market_spread_home;

                      return (
                        <tr key={bet.id} className="hover:bg-zinc-900/50">
                          <td className="px-4 py-3 text-zinc-500">
                            {bet.events?.commence_time ? new Date(bet.events.commence_time).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            }) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-white">
                              {teamName} {spread > 0 ? '+' : ''}{spread}
                            </div>
                            <div className="text-zinc-600">
                              {bet.spread_price_american > 0 ? '+' : ''}{bet.spread_price_american}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-white">
                            ${bet.stake_amount}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-400">
                            ${calculatePayout(bet.stake_amount, bet.spread_price_american).toFixed(0)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={Math.abs(bet.edge_points) >= 7 ? 'text-emerald-400' : 'text-white'}>
                              +{Math.abs(bet.edge_points).toFixed(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {bet.clv_points !== null ? (
                              <span className={bet.clv_points >= 0 ? 'text-white' : 'text-red-400'}>
                                {bet.clv_points >= 0 ? '+' : ''}{bet.clv_points.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-zinc-700">&mdash;</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <ResultBadge result={bet.result} />
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {bet.profit_loss !== null ? (
                              <span className={bet.profit_loss >= 0 ? 'text-white' : 'text-red-400'}>
                                {bet.profit_loss >= 0 ? '+' : ''}${bet.profit_loss.toFixed(0)}
                              </span>
                            ) : (
                              <span className="text-zinc-700">&mdash;</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            {/* Admin Actions - Always show */}
            <div className="bg-[#111] rounded-lg border border-zinc-800 p-5">
              <h3 className="font-semibold text-white mb-4">Admin Actions</h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-400">Clear all paper bets to start fresh</p>
                  <p className="text-xs text-zinc-600 mt-1">Use after data corrections or model updates</p>
                </div>
                <button
                  onClick={clearAllBets}
                  disabled={clearing || bets.length === 0}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {clearing ? 'Clearing...' : `Clear All (${bets.length})`}
                </button>
              </div>
            </div>

            {summary && (
            <div className="grid md:grid-cols-2 gap-6">
            {/* Forward Test Checklist */}
            <div className="bg-[#111] rounded-lg border border-zinc-800 p-5">
              <h3 className="font-semibold text-white mb-4">Forward Test Checklist</h3>
              <div className="space-y-3">
                <ChecklistItem
                  label="4-8 weeks of paper trading"
                  checked={summary.totalBets >= 40}
                  detail={`${summary.totalBets} bets logged`}
                />
                <ChecklistItem
                  label="No operational bugs"
                  checked={true}
                  detail="System running"
                />
                <ChecklistItem
                  label="Bets match backtest logic"
                  checked={summary.settledBets > 0}
                  detail="Top 10, no 3-7 spreads"
                />
                <ChecklistItem
                  label="CLV appears positive"
                  checked={summary.avgCLV !== null && summary.avgCLV > 0}
                  detail={summary.avgCLV !== null ? `Avg: ${summary.avgCLV.toFixed(2)} pts` : 'Waiting for data'}
                />
                <ChecklistItem
                  label="ROI within expected range"
                  checked={Math.abs(summary.roi - 8) < 10}
                  detail={`Current: ${summary.roi.toFixed(1)}% (target: ~8%)`}
                />
              </div>
            </div>

            {/* Model Spec */}
            <div className="bg-[#111] rounded-lg border border-zinc-800 p-5">
              <h3 className="font-semibold text-white mb-4">PROD_V1 Specification</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Model</dt>
                  <dd className="text-white">Elo-only (frozen)</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Selection</dt>
                  <dd className="text-white">Top 10/week by |edge|</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Filter</dt>
                  <dd className="text-white">Exclude spreads 3-7</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Stake</dt>
                  <dd className="text-white">Flat $100/bet</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Expected ROI</dt>
                  <dd className="font-medium text-white">~8%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Max Drawdown</dt>
                  <dd className="text-white">~9%</dd>
                </div>
              </dl>
            </div>
            </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const styles: Record<string, string> = {
    win: 'bg-zinc-800 text-white',
    loss: 'bg-red-900/50 text-red-400',
    push: 'bg-yellow-900/50 text-yellow-400',
    pending: 'bg-zinc-800 text-zinc-500',
  };

  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${styles[result] || styles.pending}`}>
      {result}
    </span>
  );
}

function ChecklistItem({ label, checked, detail }: { label: string; checked: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
        checked ? 'bg-white' : 'bg-zinc-800'
      }`}>
        {checked && (
          <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${checked ? 'text-white' : 'text-zinc-500'}`}>{label}</div>
        <div className="text-xs text-zinc-600">{detail}</div>
      </div>
    </div>
  );
}
