'use client';

import { useState, useEffect, useMemo } from 'react';
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
  market_spread_home: number | null;
  model_spread_home: number | null;
  edge_points: number | null;
  abs_edge: number | null;
  side: 'home' | 'away' | null;
  spread_price_home: number | null;
  sportsbook: string | null;
  closing_spread_home: number | null;
  closing_model_spread: number | null;
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
  recommended_bet: string | null;
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

export default function HomePage() {
  const [games, setGames] = useState<GameData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/games?daysBack=14&daysAhead=14')
      .then(res => res.json())
      .then(data => {
        setGames(data.games || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const completed = games.filter(g => g.bet_result && g.recommended_bet);
    const wins = completed.filter(g => g.bet_result === 'win').length;
    const losses = completed.filter(g => g.bet_result === 'loss').length;
    const pushes = completed.filter(g => g.bet_result === 'push').length;
    const total = wins + losses;
    const winRate = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
    // Assuming -110 odds, calculate units
    const units = wins * 0.91 - losses;
    const roi = total > 0 ? ((units / total) * 100).toFixed(1) : '0.0';

    return { wins, losses, pushes, total, winRate, units: units.toFixed(2), roi };
  }, [games]);

  const completedGames = useMemo(() =>
    games.filter(g => g.status === 'final' || g.home_score !== null)
      .sort((a, b) => new Date(b.commence_time).getTime() - new Date(a.commence_time).getTime()),
    [games]
  );

  const upcomingGames = useMemo(() =>
    games.filter(g => g.status === 'scheduled' && g.home_score === null)
      .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()),
    [games]
  );

  const topEdges = useMemo(() =>
    upcomingGames
      .filter(g => g.abs_edge !== null && g.abs_edge >= 2)
      .sort((a, b) => (b.abs_edge || 0) - (a.abs_edge || 0))
      .slice(0, 5),
    [upcomingGames]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-zinc-800 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-zinc-600 text-sm tracking-wide">Loading games...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/40 via-[#050505] to-[#050505]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
          {/* Nav */}
          <nav className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">CFB Edge</h1>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Market Intelligence</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/games"
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
              >
                All Games
              </Link>
              <Link
                href="/edges"
                className="px-4 py-2 text-sm font-medium bg-zinc-800/50 text-white rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Edge Finder
              </Link>
            </div>
          </nav>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Record</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl md:text-3xl font-bold text-white">{stats.wins}-{stats.losses}</span>
                {stats.pushes > 0 && <span className="text-zinc-500">({stats.pushes}P)</span>}
              </div>
              <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-1000"
                  style={{ width: `${stats.winRate}%` }}
                />
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Win Rate</div>
              <div className="text-2xl md:text-3xl font-bold text-white">{stats.winRate}%</div>
              <div className="text-xs text-zinc-500 mt-1">
                {stats.total} bets tracked
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Units</div>
              <div className={`text-2xl md:text-3xl font-bold ${parseFloat(stats.units) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {parseFloat(stats.units) >= 0 ? '+' : ''}{stats.units}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                at -110 odds
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800/50 rounded-2xl p-4 md:p-6">
              <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">ROI</div>
              <div className={`text-2xl md:text-3xl font-bold ${parseFloat(stats.roi) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {parseFloat(stats.roi) >= 0 ? '+' : ''}{stats.roi}%
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                per bet
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* Top Edges Section */}
        {topEdges.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-emerald-400 to-emerald-600 rounded-full" />
                <h2 className="text-lg font-bold text-white">Top Edges</h2>
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-full">
                  {topEdges.length} plays
                </span>
              </div>
              <Link href="/edges" className="text-sm text-zinc-500 hover:text-white transition-colors">
                View all →
              </Link>
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {topEdges.map((game, idx) => (
                <div
                  key={game.event_id}
                  className="group relative bg-gradient-to-br from-zinc-900 to-zinc-900/50 border border-zinc-800/50 rounded-2xl p-4 hover:border-emerald-500/30 transition-all duration-300"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  {/* Edge badge */}
                  <div className="absolute -top-2 -right-2 px-3 py-1 bg-gradient-to-r from-emerald-500 to-emerald-400 text-black text-xs font-bold rounded-full shadow-lg shadow-emerald-500/30">
                    +{game.abs_edge?.toFixed(1)} edge
                  </div>

                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex -space-x-3">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 p-1.5 ring-2 ring-zinc-900 z-10">
                        <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 p-1.5 ring-2 ring-zinc-900">
                        <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        <TeamName name={game.away_team} rank={game.away_rank} /> @ <TeamName name={game.home_team} rank={game.home_rank} />
                      </div>
                      <div className="text-xs text-zinc-500">{formatGameTime(game.commence_time)}</div>
                    </div>
                  </div>

                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Model Pick</div>
                    <div className="text-sm font-bold text-emerald-400">{game.recommended_bet}</div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                      <span>Live ({game.sportsbook || 'Market'}): {getShortName(game.home_team)} {formatSpread(game.market_spread_home || 0)}</span>
                      <span>Model: {getShortName(game.home_team)} {formatSpread(game.model_spread_home || 0)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Two Column Layout */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Recent Results */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-gradient-to-b from-amber-400 to-orange-500 rounded-full" />
              <h2 className="text-lg font-bold text-white">Recent Results</h2>
            </div>

            <div className="space-y-3">
              {completedGames.slice(0, 8).map((game) => (
                <div
                  key={game.event_id}
                  className={`bg-zinc-900/50 border rounded-xl overflow-hidden transition-all ${
                    game.bet_result === 'win'
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : game.bet_result === 'loss'
                      ? 'border-red-500/20 bg-red-500/5'
                      : 'border-zinc-800/50'
                  }`}
                >
                  <div className="p-4">
                    {/* Teams & Score */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-2">
                          <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900 z-10">
                            <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                          </div>
                          <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900">
                            <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">
                            <TeamName name={game.away_team} rank={game.away_rank} /> @ <TeamName name={game.home_team} rank={game.home_rank} />
                          </div>
                          <div className="text-xs text-zinc-500">
                            {new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </div>
                        </div>
                      </div>
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
                    </div>

                    {/* Model Pick */}
                    {game.recommended_bet && (
                      <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                        <div className="flex items-center gap-4 text-xs">
                          <div>
                            <span className="text-zinc-500">Pick: </span>
                            <span className={`font-medium ${
                              game.bet_result === 'win' ? 'text-emerald-400' :
                              game.bet_result === 'loss' ? 'text-red-400' : 'text-white'
                            }`}>{game.recommended_bet}</span>
                          </div>
                          <div className="text-zinc-600">|</div>
                          <div>
                            <span className="text-zinc-500">Close: </span>
                            <span className="text-zinc-300">{getShortName(game.home_team)} {formatSpread(game.closing_spread_home || 0)}</span>
                          </div>
                          <div className="text-zinc-600">|</div>
                          <div>
                            <span className="text-zinc-500">Model: </span>
                            <span className="text-blue-400">{getShortName(game.home_team)} {formatSpread(game.model_spread_home || 0)}</span>
                          </div>
                        </div>
                        {game.abs_edge !== null && (
                          <div className="text-xs text-zinc-500">
                            +{game.abs_edge.toFixed(1)} edge
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {completedGames.length > 8 && (
              <Link
                href="/games"
                className="block mt-4 text-center text-sm text-zinc-500 hover:text-white transition-colors"
              >
                View {completedGames.length - 8} more results →
              </Link>
            )}
          </section>

          {/* Upcoming Games */}
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-indigo-500 rounded-full" />
              <h2 className="text-lg font-bold text-white">Upcoming Games</h2>
              <span className="text-xs text-zinc-500">{upcomingGames.length} games</span>
            </div>

            <div className="space-y-3">
              {upcomingGames.slice(0, 8).map((game) => (
                <div
                  key={game.event_id}
                  className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-2">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900 z-10">
                          <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 p-1 ring-2 ring-zinc-900">
                          <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">
                          <TeamName name={game.away_team} rank={game.away_rank} /> @ <TeamName name={game.home_team} rank={game.home_rank} />
                        </div>
                        <div className="text-xs text-zinc-500">{formatGameTime(game.commence_time)}</div>
                      </div>
                    </div>
                    {game.abs_edge !== null && game.abs_edge >= 2 && (
                      <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold rounded-lg">
                        +{game.abs_edge.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {game.recommended_bet ? (
                    <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                      <div className="flex items-center gap-4 text-xs">
                        <div>
                          <span className="text-zinc-500">Live ({game.sportsbook || 'Market'}): </span>
                          <span className="text-emerald-400 font-medium">{getShortName(game.home_team)} {formatSpread(game.market_spread_home || 0)}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Model: </span>
                          <span className="text-blue-400 font-medium">{getShortName(game.home_team)} {formatSpread(game.model_spread_home || 0)}</span>
                        </div>
                      </div>
                      <div className="text-xs font-medium text-white bg-zinc-800 px-2 py-1 rounded">
                        {game.recommended_bet}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-600 pt-3 border-t border-zinc-800/50">
                      No edge detected
                    </div>
                  )}
                </div>
              ))}
            </div>

            {upcomingGames.length > 8 && (
              <Link
                href="/games"
                className="block mt-4 text-center text-sm text-zinc-500 hover:text-white transition-colors"
              >
                View {upcomingGames.length - 8} more games →
              </Link>
            )}
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span>Bowl Season {new Date().getFullYear()}</span>
            </div>
            <div>Model: Market-Anchored v1 • Updated every 5 min</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
