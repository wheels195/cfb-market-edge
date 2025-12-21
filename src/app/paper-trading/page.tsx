'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
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

function getShortName(fullName: string): string {
  const suffixes = ['Crimson Tide', 'Buckeyes', 'Fighting Irish', 'Longhorns', 'Bulldogs',
    'Wolverines', 'Nittany Lions', 'Ducks', 'Volunteers', 'Aggies', 'Rebels', 'Hurricanes',
    'Tigers', 'Trojans', 'Seminoles', 'Sooners', 'Sun Devils', 'Cyclones', 'Broncos',
    'Mustangs', 'Gamecocks', 'Black Knights', 'Midshipmen', 'Golden Gophers', 'Hawkeyes',
    'Badgers', 'Cornhuskers', 'Hoosiers', 'Boilermakers', 'Scarlet Knights', 'Terrapins',
    'Spartans', 'Wildcats', 'Blue Devils', 'Tar Heels', 'Cavaliers', 'Hokies', 'Cardinals',
    'Yellow Jackets', 'Orange', 'Panthers', 'Eagles', 'Demon Deacons', 'Wolfpack', 'Cougars',
    'Beavers', 'Huskies', 'Utes', 'Buffaloes', 'Red Raiders', 'Bears', 'Horned Frogs',
    'Jayhawks', 'Mountaineers', 'Bearcats', 'Knights', 'Bulls', 'Owls', 'Green Wave',
    'Thundering Herd', 'Mean Green', 'Roadrunners', 'Miners', 'Lobos', 'Aztecs', 'Falcons',
    'Rainbow Warriors', 'Wolf Pack', 'Ragin Cajuns', 'Jaguars', 'Blazers', 'Pirates',
    'Chanticleers', 'RedHawks', 'Chippewas', 'Bobcats', 'Rockets', 'Hilltoppers', 'Dukes'];

  for (const suffix of suffixes) {
    if (fullName.endsWith(suffix)) {
      return fullName.replace(suffix, '').trim();
    }
  }
  return fullName;
}

function TeamName({ name, rank }: { name: string; rank: number | null }) {
  const shortName = getShortName(name);
  if (rank) {
    return (
      <>
        <span className="text-amber-400 font-bold text-[10px] mr-0.5">#{rank}</span>
        {shortName}
      </>
    );
  }
  return <>{shortName}</>;
}

function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`;
  if (spread === 0) return 'PK';
  return `${spread}`;
}

function formatGameTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'Live';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function calculatePayout(stake: number, odds: number): number {
  if (odds > 0) {
    return stake * (odds / 100);
  } else {
    return stake * (100 / Math.abs(odds));
  }
}

export default function PaperTradingPage() {
  const [recommendations, setRecommendations] = useState<RecommendedBet[]>([]);
  const [bets, setBets] = useState<PaperBet[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [placingBet, setPlacingBet] = useState<string | null>(null);
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
        const sortedRecs = (data.recommendations || []).sort((a: RecommendedBet, b: RecommendedBet) =>
          new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()
        );
        setRecommendations(sortedRecs);
        setSeason(data.season);
        setWeek(data.week);
      }

      if (betsRes.ok) {
        const data = await betsRes.json();
        const sortedBets = (data.bets || []).sort((a: PaperBet, b: PaperBet) =>
          new Date(b.events?.commence_time || 0).getTime() - new Date(a.events?.commence_time || 0).getTime()
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

  const stats = useMemo(() => {
    if (!summary) return null;
    const units = summary.totalProfit / 100; // Convert $ to units (assuming $100/unit)
    return {
      ...summary,
      units: units.toFixed(2),
    };
  }, [summary]);

  const settledBets = useMemo(() =>
    bets.filter(b => b.result !== 'pending'),
    [bets]
  );

  const pendingBets = useMemo(() =>
    bets.filter(b => b.result === 'pending'),
    [bets]
  );

  const availablePicks = useMemo(() =>
    recommendations.filter(r => !r.already_bet),
    [recommendations]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-zinc-800 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-zinc-600 text-sm tracking-wide">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/40 via-[#050505] to-[#050505]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
          {/* Nav */}
          <nav className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Paper Trading</h1>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Week {week}, {season}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/games"
                className="px-4 py-2 text-sm font-medium bg-zinc-800/50 text-white rounded-lg hover:bg-zinc-800 transition-colors"
              >
                All Games
              </Link>
            </div>
          </nav>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
              <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Record</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl md:text-3xl font-bold text-white">{stats.wins}-{stats.losses}</span>
                </div>
                <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-1000"
                    style={{ width: `${stats.winRate}%` }}
                  />
                </div>
              </div>

              <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Win Rate</div>
                <div className="text-2xl md:text-3xl font-bold text-white">{stats.winRate.toFixed(1)}%</div>
                <div className="text-xs text-zinc-500 mt-1">
                  {stats.settledBets} settled
                </div>
              </div>

              <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Profit/Loss</div>
                <div className={`text-2xl md:text-3xl font-bold ${stats.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(0)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {stats.units} units
                </div>
              </div>

              <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
                <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">ROI</div>
                <div className={`text-2xl md:text-3xl font-bold ${stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {stats.pending} pending
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* Two Column Layout */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Available Picks */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-indigo-500 rounded-full" />
              <h2 className="text-lg font-bold text-white">Available Picks</h2>
              <span className="text-xs text-zinc-500">{availablePicks.length} picks</span>
            </div>

            <div className="space-y-3">
              {availablePicks.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-8 text-center text-zinc-500">
                  No picks available. Check back when games are scheduled.
                </div>
              ) : (
                availablePicks.map((rec) => {
                  const betTeam = rec.side === 'home' ? rec.home_team : rec.away_team;
                  const betSpread = rec.side === 'home' ? rec.market_spread_home : -rec.market_spread_home;
                  const betOdds = rec.side === 'home' ? rec.spread_price_home : rec.spread_price_away;
                  const stake = getStake(rec.event_id);
                  const payout = calculatePayout(stake, betOdds);

                  return (
                    <div
                      key={rec.event_id}
                      className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden hover:border-blue-500/30 transition-all"
                    >
                      <div className="p-4">
                        {/* Matchup Header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                              <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900 z-10">
                                <img src={getTeamLogo(rec.away_team)} alt="" className="w-full h-full object-contain" />
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900">
                                <img src={getTeamLogo(rec.home_team)} alt="" className="w-full h-full object-contain" />
                              </div>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white">
                                <TeamName name={rec.away_team} rank={rec.away_rank} /> @ <TeamName name={rec.home_team} rank={rec.home_rank} />
                              </div>
                              <div className="text-xs text-zinc-500">{formatGameTime(rec.commence_time)}</div>
                            </div>
                          </div>
                          <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold rounded-lg">
                            +{rec.abs_edge.toFixed(1)}
                          </span>
                        </div>

                        {/* Pick Details */}
                        <div className="bg-zinc-800/50 rounded-xl p-3 mb-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-xs text-zinc-500 mb-1">Model Pick</div>
                              <div className="text-base font-bold text-white">
                                {getShortName(betTeam)} {formatSpread(betSpread)}
                              </div>
                              <div className="text-xs text-zinc-400">
                                {betOdds > 0 ? '+' : ''}{betOdds}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-zinc-500 mb-1">To Win ${stake}</div>
                              <div className="text-lg font-bold text-emerald-400">
                                +${payout.toFixed(0)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Stake + Log Button */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-500 text-sm">$</span>
                              <input
                                type="number"
                                value={stake}
                                onChange={(e) => setStake(rec.event_id, Math.max(1, parseInt(e.target.value) || 100))}
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                                min="1"
                                step="10"
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => placeBet(rec)}
                            disabled={placingBet === rec.event_id}
                            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
                          >
                            {placingBet === rec.event_id ? 'Logging...' : 'Log Bet'}
                          </button>
                        </div>

                        {/* Market vs Model */}
                        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-zinc-800/50 text-xs">
                          <span>
                            <span className="text-zinc-500">Market: </span>
                            <span className="text-zinc-300">{formatSpread(rec.market_spread_home)}</span>
                          </span>
                          <span>
                            <span className="text-zinc-500">Model: </span>
                            <span className="text-blue-400">{formatSpread(rec.model_spread_home)}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Bet History */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-gradient-to-b from-amber-400 to-orange-500 rounded-full" />
              <h2 className="text-lg font-bold text-white">Bet History</h2>
              <span className="text-xs text-zinc-500">{bets.length} bets</span>
            </div>

            <div className="space-y-3">
              {bets.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-8 text-center text-zinc-500">
                  No bets logged yet. Log your first bet from the picks.
                </div>
              ) : (
                bets.map((bet) => {
                  const teamName = bet.side === 'home'
                    ? bet.events?.home_team?.name || 'Home'
                    : bet.events?.away_team?.name || 'Away';
                  const spread = bet.side === 'home'
                    ? bet.market_spread_home
                    : -bet.market_spread_home;
                  const payout = calculatePayout(bet.stake_amount, bet.spread_price_american);
                  const isSettled = bet.result !== 'pending';

                  return (
                    <div
                      key={bet.id}
                      className={`bg-zinc-900/50 border rounded-xl overflow-hidden transition-all ${
                        bet.result === 'win'
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : bet.result === 'loss'
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-zinc-800/50'
                      }`}
                    >
                      <div className="p-4">
                        {/* Header with date and result */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1">
                              <img src={getTeamLogo(teamName)} alt="" className="w-full h-full object-contain" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white">
                                {getShortName(teamName)} {formatSpread(spread)}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {bet.events?.commence_time
                                  ? new Date(bet.events.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : '-'
                                }
                                <span className="mx-1.5 text-zinc-700">•</span>
                                <span className="text-zinc-400">{bet.spread_price_american > 0 ? '+' : ''}{bet.spread_price_american}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            {isSettled ? (
                              <>
                                <span className={`text-xs font-bold ${
                                  bet.result === 'win' ? 'text-emerald-400' :
                                  bet.result === 'loss' ? 'text-red-400' : 'text-zinc-500'
                                }`}>
                                  {bet.result.toUpperCase()}
                                </span>
                                <div className={`text-lg font-bold ${
                                  bet.profit_loss !== null && bet.profit_loss >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}>
                                  {bet.profit_loss !== null
                                    ? `${bet.profit_loss >= 0 ? '+' : ''}$${bet.profit_loss.toFixed(0)}`
                                    : '-'
                                  }
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="text-xs font-medium text-zinc-500">PENDING</span>
                                <div className="text-lg font-bold text-zinc-400">
                                  To Win +${payout.toFixed(0)}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Bet Details */}
                        <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                          <div className="flex items-center gap-4 text-xs">
                            <div>
                              <span className="text-zinc-500">Stake: </span>
                              <span className="text-white">${bet.stake_amount}</span>
                            </div>
                            <div>
                              <span className="text-zinc-500">Edge: </span>
                              <span className="text-blue-400">+{Math.abs(bet.edge_points).toFixed(1)}</span>
                            </div>
                            {bet.clv_points !== null && (
                              <div>
                                <span className="text-zinc-500">CLV: </span>
                                <span className={bet.clv_points >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                  {bet.clv_points >= 0 ? '+' : ''}{bet.clv_points.toFixed(1)}
                                </span>
                              </div>
                            )}
                          </div>
                          {isSettled && bet.closing_spread_home !== null && (
                            <div className="text-xs text-zinc-500">
                              Close: {formatSpread(bet.closing_spread_home)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* Pending Bets Section (if any) */}
        {pendingBets.length > 0 && (
          <section className="mt-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-gradient-to-b from-purple-400 to-pink-500 rounded-full" />
              <h2 className="text-lg font-bold text-white">Pending Bets</h2>
              <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 text-xs font-medium rounded-full">
                {pendingBets.length} active
              </span>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingBets.map((bet) => {
                const teamName = bet.side === 'home'
                  ? bet.events?.home_team?.name || 'Home'
                  : bet.events?.away_team?.name || 'Away';
                const spread = bet.side === 'home'
                  ? bet.market_spread_home
                  : -bet.market_spread_home;
                const payout = calculatePayout(bet.stake_amount, bet.spread_price_american);

                return (
                  <div
                    key={bet.id}
                    className="bg-zinc-900/50 border border-purple-500/20 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1">
                        <img src={getTeamLogo(teamName)} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">
                          {getShortName(teamName)} {formatSpread(spread)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {bet.spread_price_american > 0 ? '+' : ''}{bet.spread_price_american}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs mt-3 pt-3 border-t border-zinc-800">
                      <span className="text-zinc-500">Risk ${bet.stake_amount}</span>
                      <span className="text-purple-400 font-medium">To Win +${payout.toFixed(0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span>Paper Trading Mode</span>
            </div>
            <div>Model: Market-Anchored v1 • $100 base stake</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
