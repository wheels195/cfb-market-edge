'use client';

import { useState, useEffect } from 'react';
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

function TeamLogo({ name, className = "w-full h-full" }: { name: string; className?: string }) {
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

function formatGameTime(dateStr: string): string {
  const date = new Date(dateStr);
  // Format in CST (America/Chicago)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  }) + ' CST';
}

function getGameStatus(game: CbbGame): { label: string; color: string } {
  if (game.status === 'completed') {
    return { label: 'Final', color: 'text-zinc-500' };
  }

  const now = new Date();
  const gameTime = new Date(game.start_date);

  if (gameTime <= now) {
    return { label: 'Live', color: 'text-red-500' };
  }

  // Show actual time in CST
  return {
    label: formatGameTime(game.start_date),
    color: 'text-zinc-400'
  };
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

  // Group games by date
  const gamesByDate = games.reduce((acc, game) => {
    const date = new Date(game.start_date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(game);
    return acc;
  }, {} as Record<string, CbbGame[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="bg-[#0f0f0f] border-b border-zinc-800/50 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <span className="text-xl font-bold text-white tracking-tight">
                CBB Edge
              </span>
              <nav className="hidden sm:flex items-center gap-4 text-sm">
                <span className="font-medium text-zinc-400">Elo Model</span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-500">Underdogs 10+ pts</span>
              </nav>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="hidden sm:inline">2025-26 Season</span>
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="border-b border-zinc-800/50 bg-[#0a0a0a] sticky top-14 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 py-3">
            {(['upcoming', 'bets', 'completed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  filter === f
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                {f === 'upcoming' ? 'Upcoming' : f === 'bets' ? 'Qualifying Bets' : 'Results'}
              </button>
            ))}
            <div className="ml-auto text-sm text-zinc-600">
              {games.length} games
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Season Stats */}
        {stats && stats.total_bets > 0 && (
          <div className="mb-8 p-4 bg-gradient-to-r from-zinc-900/80 to-zinc-900/40 rounded-xl border border-zinc-800/50">
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">Record:</span>
                <span className="text-white font-bold">{stats.wins}-{stats.losses}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">Win Rate:</span>
                <span className={`font-bold ${stats.win_rate >= 0.52 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(stats.win_rate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">ROI:</span>
                <span className={`font-bold ${stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.roi >= 0 ? '+' : ''}{(stats.roi * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mb-8 p-4 bg-gradient-to-r from-zinc-900/80 to-zinc-900/40 rounded-xl border border-zinc-800/50">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500" />
              <span className="text-zinc-400">Market = Sportsbook line</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500" />
              <span className="text-zinc-400">Model = Elo projection</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-semibold">+2.5</span>
              <span className="text-zinc-400">= Edge in points</span>
            </div>
          </div>
        </div>

        {Object.entries(gamesByDate).map(([date, dateGames]) => (
          <div key={date} className="mb-10">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-3">
              <span>{date}</span>
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-zinc-600 font-normal normal-case">{dateGames.length} games</span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dateGames.map((game) => {
                const status = getGameStatus(game);
                const isCompleted = game.status === 'completed';
                const absEdge = game.edge_points;
                const hasEdge = !isCompleted && absEdge !== null && absEdge >= 2.5;
                const strongEdge = !isCompleted && game.qualifies_for_bet;

                return (
                  <div
                    key={game.id}
                    className={`rounded-xl border overflow-hidden transition-all hover:border-zinc-600 ${
                      isCompleted
                        ? game.bet_result === 'win'
                          ? 'bg-emerald-950/30 border-emerald-500/40 ring-1 ring-emerald-500/30'
                          : game.bet_result === 'loss'
                          ? 'bg-red-950/20 border-red-500/30'
                          : 'bg-[#111] border-zinc-800/50'
                        : strongEdge
                        ? 'bg-gradient-to-br from-emerald-950/40 to-[#111] border-2 border-emerald-500/50'
                        : hasEdge
                        ? 'bg-[#111] border-emerald-500/30'
                        : 'bg-zinc-900/50 border-zinc-700/40'
                    }`}
                  >
                    {/* Game Header */}
                    <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/50">
                      <span className={`text-xs font-medium ${status.color}`}>
                        {status.label}
                      </span>
                      {isCompleted && game.bet_result && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          game.bet_result === 'win'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : game.bet_result === 'loss'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-zinc-700 text-zinc-400'
                        }`}>
                          {game.bet_result.toUpperCase()}
                        </span>
                      )}
                      {!isCompleted && absEdge !== null && absEdge >= 2.5 && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          strongEdge
                            ? 'bg-emerald-500 text-black'
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          +{absEdge.toFixed(1)} EDGE
                        </span>
                      )}
                      {!isCompleted && (absEdge === null || absEdge < 2.5) && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
                          NO EDGE
                        </span>
                      )}
                    </div>

                    {/* Teams & Score */}
                    <div className="p-4">
                      {/* Away Team Row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1 flex-shrink-0">
                            <TeamLogo name={game.away_team.name} />
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-white truncate block">
                              {getShortName(game.away_team.name)}
                            </span>
                            <span className="text-xs text-zinc-600">Away</span>
                          </div>
                        </div>
                        {isCompleted && game.away_score !== null && (
                          <span className={`text-2xl font-bold tabular-nums ${
                            game.away_score > (game.home_score || 0) ? 'text-white' : 'text-zinc-500'
                          }`}>
                            {game.away_score}
                          </span>
                        )}
                      </div>

                      {/* Home Team Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1 flex-shrink-0">
                            <TeamLogo name={game.home_team.name} />
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-white truncate block">
                              {getShortName(game.home_team.name)}
                            </span>
                            <span className="text-xs text-zinc-600">Home</span>
                          </div>
                        </div>
                        {isCompleted && game.home_score !== null && (
                          <span className={`text-2xl font-bold tabular-nums ${
                            game.home_score > (game.away_score || 0) ? 'text-white' : 'text-zinc-500'
                          }`}>
                            {game.home_score}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Sportsbook-style Lines */}
                    <div className="border-t border-zinc-800/50 bg-zinc-900/30 p-3">
                      {game.market_spread !== null ? (
                        <>
                          {/* Two team lines */}
                          <div className="space-y-2 mb-3">
                            {/* Away team line */}
                            <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                              game.recommended_side === 'away' && hasEdge
                                ? isCompleted
                                  ? game.bet_result === 'win' ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-red-500/10 border border-red-500/30'
                                  : 'bg-blue-500/15 border border-blue-500/40'
                                : 'bg-zinc-800/50'
                            }`}>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded bg-zinc-700/50 p-0.5">
                                  <TeamLogo name={game.away_team.name} />
                                </div>
                                <span className="text-sm text-zinc-200">{getShortName(game.away_team.name)}</span>
                              </div>
                              <span className={`font-mono text-sm ${
                                game.recommended_side === 'away' && hasEdge
                                  ? isCompleted
                                    ? game.bet_result === 'win' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'
                                    : 'text-blue-400 font-bold'
                                  : 'text-zinc-400'
                              }`}>
                                {formatSpread(-(game.market_spread || 0))} (-110)
                              </span>
                            </div>
                            {/* Home team line */}
                            <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                              game.recommended_side === 'home' && hasEdge
                                ? isCompleted
                                  ? game.bet_result === 'win' ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-red-500/10 border border-red-500/30'
                                  : 'bg-blue-500/15 border border-blue-500/40'
                                : 'bg-zinc-800/50'
                            }`}>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded bg-zinc-700/50 p-0.5">
                                  <TeamLogo name={game.home_team.name} />
                                </div>
                                <span className="text-sm text-zinc-200">{getShortName(game.home_team.name)}</span>
                              </div>
                              <span className={`font-mono text-sm ${
                                game.recommended_side === 'home' && hasEdge
                                  ? isCompleted
                                    ? game.bet_result === 'win' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'
                                    : 'text-blue-400 font-bold'
                                  : 'text-zinc-400'
                              }`}>
                                {formatSpread(game.market_spread || 0)} (-110)
                              </span>
                            </div>
                          </div>

                          {/* Model and Bet */}
                          <div className="pt-2 border-t border-zinc-800/50">
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
                            {strongEdge && !isCompleted ? (
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500 text-xs">via DK</span>
                                <div className="font-bold text-sm px-3 py-1 rounded bg-emerald-500 text-black">
                                  BET: {game.recommended_side === 'home'
                                    ? `${getShortName(game.home_team.name)} ${formatSpread(game.market_spread)}`
                                    : `${getShortName(game.away_team.name)} ${formatSpread(-(game.market_spread || 0))}`
                                  }
                                </div>
                              </div>
                            ) : hasEdge && !isCompleted ? (
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500 text-xs">
                                  {game.qualification_reason || 'Watch - criteria not met'}
                                </span>
                              </div>
                            ) : !isCompleted ? (
                              <div className="text-center">
                                <span className="text-xs text-zinc-500">Model agrees with market</span>
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-zinc-600 text-center py-2">
                          No odds available
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {games.length === 0 && (
          <div className="text-center py-20">
            <div className="text-zinc-600 text-lg">No games found</div>
            <p className="text-zinc-700 text-sm mt-2">Try a different filter</p>
          </div>
        )}

        {/* Strategy Info Footer */}
        <div className="mt-12 bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-zinc-400 mb-4 uppercase tracking-wider">Strategy Details</h3>
          <div className="grid md:grid-cols-2 gap-6 text-sm text-zinc-400">
            <div>
              <h4 className="text-white font-medium mb-2">Bet Criteria</h4>
              <ul className="space-y-1">
                <li>• Only bet <span className="text-emerald-400">underdogs</span> with spreads of 10+ points</li>
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
    </div>
  );
}
