'use client';

import { useState, useEffect } from 'react';
import { getTeamLogo } from '@/lib/team-logos';

interface GameData {
  event_id: string;
  home_team: string;
  away_team: string;
  home_team_id: string;
  away_team_id: string;
  home_rank: number | null;
  away_rank: number | null;
  commence_time: string;
  status: 'scheduled' | 'in_progress' | 'final';
  // Live odds
  market_spread_home: number | null;
  model_spread_home: number | null;
  edge_points: number | null;
  abs_edge: number | null;
  side: 'home' | 'away' | null;
  spread_price_home: number | null;
  spread_price_away: number | null;
  // Closing/locked odds (for completed games)
  closing_spread_home: number | null;
  closing_model_spread: number | null;
  // Results
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
  // Explicit bet recommendation
  recommended_bet: string | null;
}

function getShortName(fullName: string): string {
  const abbreviations: Record<string, string> = {
    'Alabama Crimson Tide': 'Alabama',
    'Ohio State Buckeyes': 'Ohio State',
    'Notre Dame Fighting Irish': 'Notre Dame',
    'Texas Longhorns': 'Texas',
    'Georgia Bulldogs': 'Georgia',
    'Michigan Wolverines': 'Michigan',
    'Penn State Nittany Lions': 'Penn State',
    'Oregon Ducks': 'Oregon',
    'Tennessee Volunteers': 'Tennessee',
    'Texas A&M Aggies': 'Texas A&M',
    'Ole Miss Rebels': 'Ole Miss',
    'Miami Hurricanes': 'Miami',
    'Clemson Tigers': 'Clemson',
    'LSU Tigers': 'LSU',
    'USC Trojans': 'USC',
    'Florida State Seminoles': 'Florida State',
    'Oklahoma Sooners': 'Oklahoma',
    'Arizona State Sun Devils': 'Arizona State',
    'Iowa State Cyclones': 'Iowa State',
    'Boise State Broncos': 'Boise State',
    'SMU Mustangs': 'SMU',
    'South Carolina Gamecocks': 'South Carolina',
    'Army Black Knights': 'Army',
    'Navy Midshipmen': 'Navy',
  };

  if (abbreviations[fullName]) return abbreviations[fullName];

  // Fallback: remove common suffixes
  const suffixes = ['Crimson Tide', 'Buckeyes', 'Fighting Irish', 'Longhorns', 'Bulldogs',
    'Wolverines', 'Nittany Lions', 'Ducks', 'Volunteers', 'Aggies', 'Rebels', 'Hurricanes',
    'Tigers', 'Trojans', 'Seminoles', 'Sooners', 'Sun Devils', 'Cyclones', 'Broncos',
    'Mustangs', 'Gamecocks', 'Black Knights', 'Midshipmen', 'Golden Gophers', 'Hawkeyes',
    'Badgers', 'Cornhuskers', 'Hoosiers', 'Boilermakers', 'Scarlet Knights', 'Terrapins',
    'Spartans', 'Wildcats', 'Blue Devils', 'Tar Heels', 'Cavaliers', 'Hokies', 'Cardinals',
    'Yellow Jackets', 'Orange', 'Panthers', 'Eagles', 'Demon Deacons', 'Wolfpack', 'Cougars',
    'Beavers', 'Huskies', 'Utes', 'Buffaloes', 'Red Raiders', 'Bears', 'Horned Frogs',
    'Jayhawks', 'Mountaineers', 'Bearcats', 'Knights', 'Cougars', 'Bulls', 'Owls',
    'Green Wave', 'Thundering Herd', 'Mean Green', 'Roadrunners', 'Miners', 'Aggies',
    'Lobos', 'Aztecs', 'Falcons', 'Rainbow Warriors', 'Wolf Pack', 'Bulldogs', 'Rebels',
    'Ragin Cajuns', 'Jaguars', 'Blazers', 'Panthers', 'Pirates', 'Chanticleers'];

  for (const suffix of suffixes) {
    if (fullName.endsWith(suffix)) {
      return fullName.replace(suffix, '').trim();
    }
  }

  return fullName;
}

function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`;
  if (spread === 0) return 'PK';
  return `${spread}`;
}

function formatOdds(price: number | null): string {
  if (!price) return '-110';
  return price > 0 ? `+${price}` : `${price}`;
}

function getGameStatus(game: GameData): { label: string; color: string } {
  if (game.status === 'final' || (game.home_score !== null && game.away_score !== null)) {
    return { label: 'Final', color: 'text-zinc-500' };
  }

  const now = new Date();
  const gameTime = new Date(game.commence_time);

  if (gameTime <= now) {
    return { label: 'Live', color: 'text-red-500' };
  }

  // Calculate time until game
  const hoursUntil = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntil < 1) {
    const mins = Math.round(hoursUntil * 60);
    return { label: `${mins}m`, color: 'text-amber-500' };
  }
  if (hoursUntil < 24) {
    return { label: `${Math.round(hoursUntil)}h`, color: 'text-zinc-400' };
  }

  return {
    label: gameTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    color: 'text-zinc-500'
  };
}

export default function GamesPage() {
  const [games, setGames] = useState<GameData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'completed'>('all');

  useEffect(() => {
    fetch('/api/games')
      .then(res => res.json())
      .then(data => {
        setGames(data.games || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredGames = games.filter(game => {
    if (filter === 'upcoming') {
      return game.status === 'scheduled' && new Date(game.commence_time) > new Date();
    }
    if (filter === 'completed') {
      return game.status === 'final' || game.home_score !== null;
    }
    return true;
  });

  // Group games by date
  const gamesByDate = filteredGames.reduce((acc, game) => {
    const date = new Date(game.commence_time).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(game);
    return acc;
  }, {} as Record<string, GameData[]>);

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
              <h1 className="text-xl font-bold text-white tracking-tight">CFB Edge</h1>
              <nav className="hidden sm:flex items-center gap-1">
                <a href="/games" className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-md">
                  Games
                </a>
                <a href="/paper-trading" className="px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-white rounded-md">
                  Paper Trading
                </a>
                <a href="/edges" className="px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-white rounded-md">
                  Edges
                </a>
              </nav>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="hidden sm:inline">Bowl Season {new Date().getFullYear()}</span>
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="border-b border-zinc-800/50 bg-[#0a0a0a] sticky top-14 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 py-3">
            {(['all', 'upcoming', 'completed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  filter === f
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <div className="ml-auto text-sm text-zinc-600">
              {filteredGames.length} games
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Legend */}
        <div className="mb-8 p-4 bg-gradient-to-r from-zinc-900/80 to-zinc-900/40 rounded-xl border border-zinc-800/50">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500" />
              <span className="text-zinc-400">Market = Sportsbook line</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500" />
              <span className="text-zinc-400">Model = Our projection</span>
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
                const isCompleted = game.status === 'final' || game.home_score !== null;

                // Use data directly from API
                const displayMarketSpread = isCompleted
                  ? game.closing_spread_home
                  : game.market_spread_home;
                const displayModelSpread = game.model_spread_home;
                const absEdge = game.abs_edge;

                return (
                  <div
                    key={game.event_id}
                    className={`bg-[#111] rounded-xl border overflow-hidden transition-all hover:border-zinc-700 ${
                      isCompleted ? 'border-zinc-800/50' : 'border-zinc-800'
                    } ${game.bet_result === 'win' ? 'ring-2 ring-emerald-500/50' : ''} ${game.bet_result === 'loss' ? 'ring-1 ring-red-500/30' : ''}`}
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
                      {!isCompleted && absEdge !== null && absEdge >= 2 && (
                        <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                          +{absEdge.toFixed(1)} edge
                        </span>
                      )}
                    </div>

                    {/* Teams & Score */}
                    <div className="p-4">
                      {/* Away Team Row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1 flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(game.away_team)}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {game.away_rank && (
                                <span className="text-xs font-medium text-amber-500">#{game.away_rank}</span>
                              )}
                              <span className="font-semibold text-white truncate">
                                {getShortName(game.away_team)}
                              </span>
                            </div>
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
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(game.home_team)}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {game.home_rank && (
                                <span className="text-xs font-medium text-amber-500">#{game.home_rank}</span>
                              )}
                              <span className="font-semibold text-white truncate">
                                {getShortName(game.home_team)}
                              </span>
                            </div>
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

                    {/* Odds Comparison */}
                    <div className="border-t border-zinc-800/50 bg-zinc-900/30">
                      <div className="grid grid-cols-2 divide-x divide-zinc-800/50">
                        {/* Market/Closing Line */}
                        <div className="p-3 text-center">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
                            {isCompleted ? 'Closing Line' : 'Market Line'}
                          </div>
                          <div className="text-lg font-bold text-emerald-400">
                            {displayMarketSpread !== null
                              ? formatSpread(displayMarketSpread)
                              : '—'
                            }
                          </div>
                        </div>
                        {/* Model Projection */}
                        <div className="p-3 text-center">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
                            Model Says
                          </div>
                          <div className="text-lg font-bold text-blue-400">
                            {displayModelSpread !== null
                              ? formatSpread(displayModelSpread)
                              : '—'
                            }
                          </div>
                        </div>
                      </div>

                      {/* Model Bet Recommendation - Always show if we have a recommendation */}
                      {game.recommended_bet ? (
                        <div className={`px-4 py-3 border-t border-zinc-800/50 ${
                          isCompleted
                            ? game.bet_result === 'win'
                              ? 'bg-emerald-500/10'
                              : game.bet_result === 'loss'
                              ? 'bg-red-500/5'
                              : 'bg-zinc-900/50'
                            : 'bg-gradient-to-r from-emerald-500/15 to-emerald-500/5'
                        }`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">
                                {isCompleted ? 'Model Picked' : 'Model Pick'}
                              </div>
                              <div className={`text-sm font-bold ${
                                isCompleted
                                  ? game.bet_result === 'win'
                                    ? 'text-emerald-400'
                                    : game.bet_result === 'loss'
                                    ? 'text-red-400'
                                    : 'text-zinc-400'
                                  : 'text-white'
                              }`}>
                                {game.recommended_bet}
                              </div>
                            </div>
                            {absEdge !== null && (
                              <div className="text-right">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">
                                  Edge
                                </div>
                                <div className={`text-lg font-bold ${
                                  isCompleted ? 'text-zinc-500' : 'text-emerald-400'
                                }`}>
                                  +{absEdge.toFixed(1)}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 py-3 border-t border-zinc-800/50 bg-zinc-900/20">
                          <div className="text-xs text-zinc-600 text-center">
                            No edge detected
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filteredGames.length === 0 && (
          <div className="text-center py-20">
            <div className="text-zinc-600 text-lg">No games found</div>
            <p className="text-zinc-700 text-sm mt-2">Try a different filter</p>
          </div>
        )}
      </main>
    </div>
  );
}
