'use client';

import { useState, useEffect, useMemo } from 'react';
import { getCbbTeamLogo } from '@/lib/cbb-team-logos';

interface CbbGame {
  id: string;
  start_date: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  home_team: {
    id: string;
    name: string;
    elo: number;
    games_played: number;
  };
  away_team: {
    id: string;
    name: string;
    elo: number;
    games_played: number;
  };
  market_spread: number | null;
  model_spread: number | null;
  edge_points: number | null;
  spread_size: number | null;
  recommended_side: 'home' | 'away' | null;
  is_underdog_bet: boolean;
  qualifies_for_bet: boolean;
  qualification_reason: string | null;
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
}

interface ApiResponse {
  games: CbbGame[];
  season: number;
  stats: {
    total_bets: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_units: number;
    roi: number;
  };
}

function formatSpread(spread: number | null): string {
  if (spread === null) return '-';
  const rounded = Math.round(spread * 2) / 2;
  if (rounded > 0) return `+${rounded}`;
  if (rounded === 0) return 'PK';
  return `${rounded}`;
}

function formatGameTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0 && diff > -10800000) return 'Live'; // Within 3 hours of start

  // Show full date and time
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dateOnly = date.toDateString();
  if (dateOnly === today.toDateString()) return 'Today';
  if (dateOnly === tomorrow.toDateString()) return 'Tomorrow';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function getShortName(name: string): string {
  const suffixes = [
    'Wildcats', 'Bulldogs', 'Tigers', 'Bears', 'Blue Devils', 'Tar Heels',
    'Cardinals', 'Jayhawks', 'Crimson Tide', 'Volunteers', 'Spartans',
    'Wolverines', 'Buckeyes', 'Boilermakers', 'Fighting Illini', 'Hoosiers',
    'Hawkeyes', 'Golden Gophers', 'Badgers', 'Cyclones', 'Longhorns',
    'Aggies', 'Red Raiders', 'Cowboys', 'Sooners', 'Mountaineers',
    'Cougars', 'Ducks', 'Beavers', 'Huskies', 'Bruins', 'Trojans',
    'Sun Devils', 'Buffaloes', 'Utes', 'Golden Eagles', 'Eagles',
    'Orange', 'Seminoles', 'Yellow Jackets', 'Demon Deacons', 'Panthers',
    'Cavaliers', 'Hokies', 'Wolfpack', 'Owls', 'Flames', 'Shockers',
    'Flyers', 'Friars', 'Musketeers', 'Bluejays', 'Red Storm', 'Hoyas',
  ];

  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      return name.replace(suffix, '').trim();
    }
  }
  return name;
}

function TeamLogo({ name, className = "w-8 h-8" }: { name: string; className?: string }) {
  const [imgError, setImgError] = useState(false);
  const logoUrl = getCbbTeamLogo(name);

  if (imgError) {
    return (
      <div className={`${className} rounded-lg bg-zinc-700 flex items-center justify-center`}>
        <span className="text-[8px] font-bold text-zinc-400">
          {name.slice(0, 2).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={name}
      className={`${className} object-contain`}
      onError={() => setImgError(true)}
    />
  );
}

export default function CbbPage() {
  const [games, setGames] = useState<CbbGame[]>([]);
  const [stats, setStats] = useState<ApiResponse['stats'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'upcoming' | 'completed' | 'bets'>('upcoming');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cbb/games?filter=${filter}&limit=100`)
      .then(res => res.json())
      .then((data: ApiResponse) => {
        setGames(data.games || []);
        setStats(data.stats);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching games:', err);
        setLoading(false);
      });
  }, [filter]);

  const qualifyingBets = useMemo(() =>
    games.filter(g => g.qualifies_for_bet),
    [games]
  );

  const topEdges = useMemo(() =>
    games
      .filter(g => g.edge_points !== null && g.edge_points >= 2.5 && g.status === 'upcoming')
      .sort((a, b) => (b.edge_points || 0) - (a.edge_points || 0))
      .slice(0, 6),
    [games]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-zinc-800 border-t-orange-500 rounded-full animate-spin" />
          <span className="text-zinc-600 text-sm tracking-wide">Loading CBB games...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-950/40 via-[#050505] to-[#050505]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-orange-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                  <path strokeLinecap="round" strokeWidth={2} d="M12 2C12 2 8 6 8 12s4 10 4 10M12 2c0 0 4 4 4 10s-4 10-4 10" />
                  <path strokeWidth={2} d="M2 12h20" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">College Basketball</h1>
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Elo Model • 2025-26 Season</p>
              </div>
            </div>
            <p className="text-zinc-400 text-sm max-w-xl">
              Bet underdogs with 10+ pt spreads when model shows 2.5-5 pt edge. Both teams must have 5+ games.
            </p>
          </div>

          {/* Stats Card */}
          {stats && stats.total_bets > 0 && (
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-4 mb-6">
              <h2 className="text-xs font-semibold text-zinc-500 mb-3 uppercase tracking-wider">Season Performance</h2>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-2xl font-bold text-white">{stats.total_bets}</div>
                  <div className="text-xs text-zinc-500">Bets</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {stats.wins}-{stats.losses}
                  </div>
                  <div className="text-xs text-zinc-500">Record</div>
                </div>
                <div>
                  <div className={`text-2xl font-bold ${stats.win_rate >= 0.52 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(stats.win_rate * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-zinc-500">Win Rate</div>
                </div>
                <div>
                  <div className={`text-2xl font-bold ${stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.roi >= 0 ? '+' : ''}{(stats.roi * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-zinc-500">ROI</div>
                </div>
              </div>
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex gap-2">
            {(['upcoming', 'bets', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-white'
                }`}
              >
                {f === 'upcoming' ? 'Upcoming' : f === 'bets' ? `Qualifying Bets${qualifyingBets.length > 0 ? ` (${qualifyingBets.length})` : ''}` : 'Results'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* Top Edges Section (only on upcoming) */}
        {filter === 'upcoming' && topEdges.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-gradient-to-b from-orange-400 to-orange-600 rounded-full" />
              <h2 className="text-lg font-bold text-white">Top Edges</h2>
              <span className="px-2 py-0.5 bg-orange-500/10 text-orange-400 text-xs font-medium rounded-full">
                {topEdges.length} plays
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {topEdges.map((game, idx) => (
                <div
                  key={game.id}
                  className="group relative bg-gradient-to-br from-zinc-900 to-zinc-900/50 border border-zinc-800/50 rounded-2xl p-4 hover:border-orange-500/30 transition-all duration-300"
                >
                  {/* Edge badge */}
                  <div className="absolute -top-2 -right-2 px-3 py-1 bg-gradient-to-r from-orange-500 to-orange-400 text-black text-xs font-bold rounded-full shadow-lg shadow-orange-500/30">
                    +{game.edge_points?.toFixed(1)} edge
                  </div>

                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex -space-x-3">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 p-1.5 ring-2 ring-zinc-900 z-10">
                        <TeamLogo name={game.away_team.name} className="w-full h-full" />
                      </div>
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 p-1.5 ring-2 ring-zinc-900">
                        <TeamLogo name={game.home_team.name} className="w-full h-full" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {getShortName(game.away_team.name)} @ {getShortName(game.home_team.name)}
                      </div>
                      <div className="text-xs text-zinc-500">{formatGameTime(game.start_date)}</div>
                    </div>
                  </div>

                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                      <div className={`flex items-center justify-between px-2 py-1.5 rounded ${
                        game.recommended_side === 'away' ? 'bg-orange-500/20 border border-orange-500/40' : 'bg-zinc-700/50'
                      }`}>
                        <span className="text-zinc-200">{getShortName(game.away_team.name)}</span>
                        <span className={`font-mono ${game.recommended_side === 'away' ? 'text-orange-300 font-bold' : 'text-zinc-400'}`}>
                          {formatSpread(-(game.market_spread || 0))}
                        </span>
                      </div>
                      <div className={`flex items-center justify-between px-2 py-1.5 rounded ${
                        game.recommended_side === 'home' ? 'bg-orange-500/20 border border-orange-500/40' : 'bg-zinc-700/50'
                      }`}>
                        <span className="text-zinc-200">{getShortName(game.home_team.name)}</span>
                        <span className={`font-mono ${game.recommended_side === 'home' ? 'text-orange-300 font-bold' : 'text-zinc-400'}`}>
                          {formatSpread(game.market_spread || 0)}
                        </span>
                      </div>
                    </div>
                    {/* Model prediction */}
                    {game.model_spread !== null && (
                      <div className="flex items-center justify-between mb-2 text-xs border-t border-zinc-700/50 pt-2">
                        <span className="text-zinc-500">Model:</span>
                        <span className="text-blue-400 font-medium">
                          {game.model_spread <= 0
                            ? `${getShortName(game.home_team.name)} ${formatSpread(game.model_spread)}`
                            : `${getShortName(game.away_team.name)} ${formatSpread(-game.model_spread)}`
                          }
                        </span>
                      </div>
                    )}
                    {game.qualifies_for_bet && (
                      <div className="text-sm font-bold text-orange-400">
                        BET: {game.recommended_side === 'home' ? game.home_team.name : game.away_team.name} {formatSpread(game.recommended_side === 'home' ? (game.market_spread || 0) : -(game.market_spread || 0))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Games List */}
        {games.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            No games found for this filter.
          </div>
        ) : (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-2 h-8 rounded-full ${
                filter === 'upcoming' ? 'bg-gradient-to-b from-blue-400 to-indigo-500' :
                filter === 'bets' ? 'bg-gradient-to-b from-orange-400 to-orange-600' :
                'bg-gradient-to-b from-amber-400 to-orange-500'
              }`} />
              <h2 className="text-lg font-bold text-white">
                {filter === 'upcoming' ? 'Upcoming Games' : filter === 'bets' ? 'Qualifying Bets' : 'Recent Results'}
              </h2>
              <span className="text-xs text-zinc-500">{games.length} games</span>
            </div>

            <div className="space-y-6">
              {/* Group games by date */}
              {(() => {
                const gamesByDate: Record<string, CbbGame[]> = {};
                for (const game of games) {
                  const dateKey = new Date(game.start_date).toDateString();
                  if (!gamesByDate[dateKey]) gamesByDate[dateKey] = [];
                  gamesByDate[dateKey].push(game);
                }
                return Object.entries(gamesByDate).map(([dateKey, dateGames]) => (
                  <div key={dateKey}>
                    {/* Date Header */}
                    <div className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 border-b border-zinc-800 pb-2">
                      {formatDateHeader(dateGames[0].start_date)}
                    </div>
                    <div className="space-y-3">
                      {dateGames.map((game) => {
                        const hasEdge = game.edge_points !== null && game.edge_points >= 2.5;
                        const strongEdge = game.edge_points !== null && game.edge_points >= 2.5 && game.qualifies_for_bet;

                        return (
                          <div
                            key={game.id}
                    className={`rounded-xl p-4 transition-all ${
                      game.bet_result === 'win'
                        ? 'bg-emerald-500/5 border-2 border-emerald-500/30'
                        : game.bet_result === 'loss'
                        ? 'bg-red-500/5 border-2 border-red-500/30'
                        : strongEdge
                        ? 'bg-gradient-to-br from-orange-950/50 to-orange-900/20 border-2 border-orange-500/40'
                        : hasEdge
                        ? 'bg-zinc-900/50 border border-orange-500/20'
                        : 'bg-zinc-800/30 border border-zinc-700/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-2">
                          <div className="w-10 h-10 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900 z-10">
                            <TeamLogo name={game.away_team.name} className="w-full h-full" />
                          </div>
                          <div className="w-10 h-10 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900">
                            <TeamLogo name={game.home_team.name} className="w-full h-full" />
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">
                            {getShortName(game.away_team.name)} @ {getShortName(game.home_team.name)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {formatGameTime(game.start_date)}
                            <span className="mx-2">•</span>
                            <span className="text-zinc-600">
                              {game.away_team.elo.toFixed(0)} vs {game.home_team.elo.toFixed(0)} Elo
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Score or Badge */}
                      {game.status === 'completed' ? (
                        <div className="text-right">
                          <div className="text-lg font-bold text-white tabular-nums">
                            {game.away_score} - {game.home_score}
                          </div>
                          {game.bet_result && (
                            <span className={`text-xs font-bold ${
                              game.bet_result === 'win' ? 'text-emerald-400' :
                              game.bet_result === 'loss' ? 'text-red-400' : 'text-zinc-500'
                            }`}>
                              {game.bet_result.toUpperCase()}
                            </span>
                          )}
                        </div>
                      ) : hasEdge ? (
                        <div className={`px-3 py-1.5 rounded-lg ${
                          strongEdge
                            ? 'bg-orange-500 text-black font-bold'
                            : 'bg-orange-500/20 text-orange-400 font-semibold'
                        }`}>
                          <span className="text-xs">+{game.edge_points?.toFixed(1)} EDGE</span>
                        </div>
                      ) : (
                        <div className="px-3 py-1.5 bg-zinc-700/50 rounded-lg">
                          <span className="text-xs text-zinc-400">NO EDGE</span>
                        </div>
                      )}
                    </div>

                    {/* Spread Info */}
                    {game.market_spread !== null && (
                      <div className="pt-3 border-t border-zinc-700/50">
                        <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                          <div className={`flex items-center justify-between px-2 py-1.5 rounded ${
                            game.recommended_side === 'away' && hasEdge
                              ? 'bg-orange-500/20 border border-orange-500/40'
                              : 'bg-zinc-800/50'
                          }`}>
                            <span className="text-zinc-300">{getShortName(game.away_team.name)}</span>
                            <span className={`font-mono ${
                              game.recommended_side === 'away' && hasEdge ? 'text-orange-400 font-bold' : 'text-zinc-400'
                            }`}>
                              {formatSpread(-(game.market_spread || 0))}
                            </span>
                          </div>
                          <div className={`flex items-center justify-between px-2 py-1.5 rounded ${
                            game.recommended_side === 'home' && hasEdge
                              ? 'bg-orange-500/20 border border-orange-500/40'
                              : 'bg-zinc-800/50'
                          }`}>
                            <span className="text-zinc-300">{getShortName(game.home_team.name)}</span>
                            <span className={`font-mono ${
                              game.recommended_side === 'home' && hasEdge ? 'text-orange-400 font-bold' : 'text-zinc-400'
                            }`}>
                              {formatSpread(game.market_spread || 0)}
                            </span>
                          </div>
                        </div>

                        {/* Model prediction */}
                        {game.model_spread !== null && (
                          <div className="flex items-center justify-between mb-2 text-xs">
                            <span className="text-zinc-500">Model:</span>
                            <span className="text-blue-400 font-medium">
                              {game.model_spread <= 0
                                ? `${getShortName(game.home_team.name)} ${formatSpread(game.model_spread)}`
                                : `${getShortName(game.away_team.name)} ${formatSpread(-game.model_spread)}`
                              }
                            </span>
                          </div>
                        )}

                        {/* Bet recommendation */}
                        {game.qualifies_for_bet && game.status !== 'completed' && (
                          <div className="flex items-center justify-between text-xs mt-2">
                            <span className="text-zinc-500">Underdog • {Math.abs(game.market_spread || 0).toFixed(0)}pt spread</span>
                            <div className="font-bold px-3 py-1 rounded bg-orange-500 text-black">
                              BET: {game.recommended_side === 'home' ? getShortName(game.home_team.name) : getShortName(game.away_team.name)} {formatSpread(game.recommended_side === 'home' ? (game.market_spread || 0) : -(game.market_spread || 0))}
                            </div>
                          </div>
                        )}

                        {/* Disqualification reason */}
                        {!game.qualifies_for_bet && game.qualification_reason && hasEdge && (
                          <div className="text-xs text-zinc-500 mt-2">
                            {game.qualification_reason}
                          </div>
                        )}
                      </div>
                    )}

                    {game.market_spread === null && (
                      <div className="text-xs text-zinc-600 pt-3 border-t border-zinc-700/50 text-center">
                        Odds not available yet
                      </div>
                    )}
                  </div>
                );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </section>
        )}

        {/* Strategy Info */}
        <div className="mt-12 bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-zinc-400 mb-4 uppercase tracking-wider">Strategy Details</h3>
          <div className="grid md:grid-cols-2 gap-6 text-sm text-zinc-400">
            <div>
              <h4 className="text-white font-medium mb-2">Bet Criteria</h4>
              <ul className="space-y-1">
                <li>• Only bet <span className="text-orange-400">underdogs</span> with spreads of 10+ points</li>
                <li>• Model edge must be between 2.5-5 points</li>
                <li>• Both teams must have played 5+ games</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-medium mb-2">Backtest Results</h4>
              <ul className="space-y-1">
                <li>• <span className="text-emerald-400 font-bold">59.4%</span> win rate on 138 bets (2022-2024)</li>
                <li>• <span className="text-emerald-400 font-bold">+13.5%</span> ROI after -110 juice</li>
                <li>• Holdout test: Train +8.8% → Test +19.8%</li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
              <span>CBB 2025-26 Season</span>
            </div>
            <div>Model: Elo Underdog Strategy • Data from CBBD API</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
