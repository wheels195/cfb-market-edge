'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
  sportsbook: string | null;
  // Closing/locked odds (for completed games)
  closing_spread_home: number | null;
  closing_price_home: number | null;
  closing_price_away: number | null;
  closing_model_spread: number | null;
  // Results
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
  // Explicit bet recommendation
  recommended_bet: string | null;
}

interface ApiResponse {
  games: GameData[];
  stats: {
    total_bets: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_units: number;
    roi: number;
  };
  all_stats: {
    total: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_units: number;
    roi: number;
  };
  tracked_stats: {
    total_tracked: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_units: number;
    roi: number;
  };
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
  // Round to nearest 0.5 for cleaner display
  const rounded = Math.round(spread * 2) / 2;
  if (rounded > 0) return `+${rounded}`;
  if (rounded === 0) return 'PK';
  return `${rounded}`;
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
  const [stats, setStats] = useState<ApiResponse['stats'] | null>(null);
  const [allStats, setAllStats] = useState<ApiResponse['all_stats'] | null>(null);
  const [trackedStats, setTrackedStats] = useState<ApiResponse['tracked_stats'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'completed' | 'tracked'>('all');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/games?filter=${filter}`)
      .then(res => res.json())
      .then((data: ApiResponse) => {
        setGames(data.games || []);
        setStats(data.stats);
        setAllStats(data.all_stats);
        setTrackedStats(data.tracked_stats);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  // Games are already filtered by the API
  const filteredGames = games;

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
              <Link href="/" className="text-xl font-bold text-white tracking-tight hover:text-emerald-400 transition-colors">
                CFB Edge
              </Link>
              <nav className="hidden sm:flex items-center gap-4">
                <Link href="/games" className="text-sm font-medium text-white">
                  View All Games
                </Link>
                <Link href="/model" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                  Our Model
                </Link>
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
            {(['all', 'upcoming', 'completed', 'tracked'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  filter === f
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                {f === 'completed' ? 'Results' : f === 'tracked' ? 'Tracked' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <div className="ml-auto text-sm text-zinc-600">
              {filteredGames.length} games
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats - Show both total record AND qualifying bets record */}
        {(filter === 'completed' || filter === 'all' || filter === 'tracked') && (allStats || stats) ? (
          <div className="mb-8 space-y-4">
            {/* Total Record - ALL predictions */}
            {allStats && allStats.total > 0 && (
              <div className="p-4 bg-gradient-to-r from-blue-950/40 to-zinc-900/40 rounded-xl border border-blue-500/30">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-blue-400 text-sm font-semibold">All Predictions</span>
                  <span className="text-zinc-500 text-xs">Every game we tracked</span>
                </div>
                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Record:</span>
                    <span className="text-white font-bold text-lg">{allStats.wins}-{allStats.losses}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Win Rate:</span>
                    <span className={`font-bold ${allStats.win_rate >= 0.52 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(allStats.win_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">ROI:</span>
                    <span className={`font-bold ${allStats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {allStats.roi >= 0 ? '+' : ''}{(allStats.roi * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Qualifying Bets - Edge 2.5-5 */}
            {stats && stats.total_bets > 0 && (
              <div className="p-4 bg-gradient-to-r from-emerald-950/40 to-zinc-900/40 rounded-xl border border-emerald-500/30">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-emerald-400 text-sm font-semibold">Qualifying Bets (Edge 2.5-5 pts)</span>
                  <span className="text-zinc-500 text-xs">Production betting criteria</span>
                </div>
                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Record:</span>
                    <span className="text-white font-bold text-lg">{stats.wins}-{stats.losses}</span>
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
          </div>
        ) : null}

        {/* Legend - show different content for tracked view */}
        {filter === 'tracked' ? (
          <div className="mb-8 p-4 bg-gradient-to-r from-purple-950/30 to-zinc-900/40 rounded-xl border border-purple-500/20">
            <div className="text-sm text-zinc-400 space-y-2">
              <p><span className="text-purple-400 font-semibold">Tracked Predictions</span> shows all completed games where the model had 1.0+ point edge, even if below the 2.5 pt betting threshold.</p>
              <p>Use this to analyze model performance across different edge sizes for future refinement.</p>
              <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">TRACKED</span>
                  <span className="text-zinc-500">= Below 2.5 threshold (analysis only)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">WIN</span>
                  <span className="text-zinc-500">= Qualifying bet result</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
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
        )}

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

                const hasEdge = !isCompleted && absEdge !== null && absEdge >= 1.5;
                const strongEdge = !isCompleted && absEdge !== null && absEdge >= 2.5;
                // Tracked-only = games with edge < 2.5 (doesn't qualify for actual bet)
                // Show this distinction in both 'tracked' and 'completed' views
                const isTrackedOnly = (filter === 'tracked' || filter === 'completed') && isCompleted && absEdge !== null && absEdge < 2.5;

                return (
                  <div
                    key={game.event_id}
                    className={`rounded-xl border overflow-hidden transition-all hover:border-zinc-600 ${
                      isCompleted
                        ? isTrackedOnly
                          ? game.bet_result === 'win'
                            ? 'bg-purple-950/30 border-purple-500/40 ring-1 ring-purple-500/30'
                            : game.bet_result === 'loss'
                            ? 'bg-purple-950/10 border-purple-500/20'
                            : 'bg-[#111] border-zinc-800/50'
                          : game.bet_result === 'win'
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
                        <div className="flex items-center gap-1">
                          {isTrackedOnly && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                              TRACKED
                            </span>
                          )}
                          {/* Show edge size for tracked games */}
                          {isTrackedOnly && absEdge !== null && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              +{absEdge.toFixed(1)}
                            </span>
                          )}
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            isTrackedOnly
                              ? game.bet_result === 'win'
                                ? 'bg-purple-500/20 text-purple-300'
                                : 'bg-purple-500/10 text-purple-400'
                              : game.bet_result === 'win'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : game.bet_result === 'loss'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-zinc-700 text-zinc-400'
                          }`}>
                            {game.bet_result.toUpperCase()}
                          </span>
                        </div>
                      )}
                      {!isCompleted && absEdge !== null && absEdge >= 1.5 && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          absEdge >= 2.5
                            ? 'bg-emerald-500 text-black'
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          +{absEdge.toFixed(1)} EDGE
                        </span>
                      )}
                      {!isCompleted && (absEdge === null || absEdge < 1.5) && (
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

                    {/* Sportsbook-style Lines */}
                    <div className="border-t border-zinc-800/50 bg-zinc-900/30 p-3">
                      {displayMarketSpread !== null ? (
                        <>
                          {/* Two team lines */}
                          <div className="space-y-2 mb-3">
                            {/* Away team line */}
                            <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                              game.side === 'away'
                                ? isCompleted
                                  ? game.bet_result === 'win' ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-red-500/10 border border-red-500/30'
                                  : 'bg-blue-500/15 border border-blue-500/40'
                                : 'bg-zinc-800/50'
                            }`}>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded bg-zinc-700/50 p-0.5">
                                  <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                                </div>
                                <span className="text-sm text-zinc-200">{getShortName(game.away_team)}</span>
                              </div>
                              <span className={`font-mono text-sm ${
                                game.side === 'away'
                                  ? isCompleted
                                    ? game.bet_result === 'win' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'
                                    : 'text-blue-400 font-bold'
                                  : 'text-zinc-400'
                              }`}>
                                {formatSpread(-(displayMarketSpread || 0))} ({formatOdds(isCompleted ? game.closing_price_away : game.spread_price_away)})
                              </span>
                            </div>
                            {/* Home team line */}
                            <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                              game.side === 'home'
                                ? isCompleted
                                  ? game.bet_result === 'win' ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-red-500/10 border border-red-500/30'
                                  : 'bg-blue-500/15 border border-blue-500/40'
                                : 'bg-zinc-800/50'
                            }`}>
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded bg-zinc-700/50 p-0.5">
                                  <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                                </div>
                                <span className="text-sm text-zinc-200">{getShortName(game.home_team)}</span>
                              </div>
                              <span className={`font-mono text-sm ${
                                game.side === 'home'
                                  ? isCompleted
                                    ? game.bet_result === 'win' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'
                                    : 'text-blue-400 font-bold'
                                  : 'text-zinc-400'
                              }`}>
                                {formatSpread(displayMarketSpread || 0)} ({formatOdds(isCompleted ? game.closing_price_home : game.spread_price_home)})
                              </span>
                            </div>
                          </div>

                          {/* Pick and Edge */}
                          {isCompleted && game.recommended_bet ? (
                            <div className="pt-2 border-t border-zinc-800/50">
                              {/* Model prediction */}
                              {game.closing_model_spread !== null && (
                                <div className="flex items-center justify-between mb-2 text-xs">
                                  <span className="text-zinc-500">Model:</span>
                                  <span className="text-blue-400 font-medium">
                                    {game.closing_model_spread <= 0
                                      ? `${getShortName(game.home_team)} ${formatSpread(game.closing_model_spread)}`
                                      : `${getShortName(game.away_team)} ${formatSpread(-game.closing_model_spread)}`
                                    }
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Picked:</span>
                                  <span className={`ml-2 text-sm font-bold ${
                                    game.bet_result === 'win' ? 'text-emerald-400' : game.bet_result === 'loss' ? 'text-red-400' : 'text-zinc-400'
                                  }`}>
                                    {game.recommended_bet}
                                  </span>
                                </div>
                                {absEdge !== null && (
                                  <span className="text-sm text-zinc-500">+{absEdge.toFixed(1)} edge</span>
                                )}
                              </div>
                            </div>
                          ) : !isCompleted && hasEdge && game.recommended_bet ? (
                            <div className="pt-2 border-t border-zinc-800/50">
                              {/* Model prediction */}
                              {displayModelSpread !== null && (
                                <div className="flex items-center justify-between mb-2 text-xs">
                                  <span className="text-zinc-500">Model:</span>
                                  <span className="text-blue-400 font-medium">
                                    {displayModelSpread <= 0
                                      ? `${getShortName(game.home_team)} ${formatSpread(displayModelSpread)}`
                                      : `${getShortName(game.away_team)} ${formatSpread(-displayModelSpread)}`
                                    }
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-500 text-xs">via {game.sportsbook || 'DK'}</span>
                                <div className={`font-bold text-sm px-3 py-1 rounded ${
                                  strongEdge ? 'bg-emerald-500 text-black' : 'bg-emerald-500/20 text-emerald-400'
                                }`}>
                                  BET: {game.recommended_bet}
                                </div>
                              </div>
                            </div>
                          ) : !isCompleted && !hasEdge ? (
                            <div className="pt-2 border-t border-zinc-800/50 text-center">
                              <span className="text-xs text-zinc-500">Model agrees with market</span>
                            </div>
                          ) : null}
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
