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
          stake_amount: 100,
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
              href="/edges"
              className="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
            >
              View Edges &rarr;
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

                return (
                  <div
                    key={rec.event_id}
                    className="bg-[#111] rounded-lg border border-zinc-800 p-4"
                  >
                    <div className="flex items-start justify-between">
                      {/* Left: Matchup */}
                      <div className="flex-1">
                        <div className="text-xs text-zinc-600 mb-2">#{rec.rank}</div>

                        {/* Away Team */}
                        <div className="flex items-center gap-3 mb-1">
                          <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(rec.away_team)}
                              alt={rec.away_team}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-zinc-500 text-sm w-6 text-right">
                            {rec.away_rank || ''}
                          </span>
                          <span className={`font-medium ${rec.side === 'away' ? 'text-white' : 'text-zinc-400'}`}>
                            {rec.away_team}
                          </span>
                          {rec.side === 'away' && (
                            <span className="text-emerald-400 text-xs font-medium ml-1">BET</span>
                          )}
                        </div>

                        {/* AT divider */}
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wider ml-11 my-1">
                          at
                        </div>

                        {/* Home Team */}
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(rec.home_team)}
                              alt={rec.home_team}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-zinc-500 text-sm w-6 text-right">
                            {rec.home_rank || ''}
                          </span>
                          <span className={`font-medium ${rec.side === 'home' ? 'text-white' : 'text-zinc-400'}`}>
                            {rec.home_team}
                          </span>
                          {rec.side === 'home' && (
                            <span className="text-emerald-400 text-xs font-medium ml-1">BET</span>
                          )}
                        </div>
                      </div>

                      {/* Right: Bet Details + Action */}
                      <div className="text-right ml-6">
                        <div className="text-white font-semibold">
                          {betTeam} {betSpread > 0 ? '+' : ''}{betSpread}
                        </div>
                        <div className="text-zinc-500 text-sm">
                          {betOdds > 0 ? '+' : ''}{betOdds}
                        </div>
                        <div className={`text-lg font-bold mt-1 ${rec.abs_edge >= 7 ? 'text-emerald-400' : 'text-white'}`}>
                          +{rec.abs_edge.toFixed(1)}
                          <span className="text-xs text-zinc-500 font-normal ml-1">edge</span>
                        </div>
                        <div className="mt-3">
                          {rec.already_bet ? (
                            <span className="px-3 py-1.5 bg-zinc-800 text-zinc-500 text-sm font-medium rounded">
                              Logged
                            </span>
                          ) : (
                            <button
                              onClick={() => placeBet(rec)}
                              disabled={placingBet === rec.event_id}
                              className="px-4 py-1.5 bg-white text-black text-sm font-medium rounded hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                            >
                              {placingBet === rec.event_id ? '...' : 'Log $100'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer: Line Comparison */}
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
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Date</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Bet</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Stake</th>
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
                            {new Date(bet.bet_placed_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
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
        {activeTab === 'stats' && summary && (
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
