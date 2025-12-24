'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { getTeamLogo } from '@/lib/team-logos';
import { getCbbTeamLogo } from '@/lib/cbb-team-logos';

interface CfbGame {
  event_id: string;
  home_team: string;
  away_team: string;
  home_rank: number | null;
  away_rank: number | null;
  commence_time: string;
  status: 'scheduled' | 'in_progress' | 'final';
  market_spread_home: number | null;
  model_spread_home: number | null;
  abs_edge: number | null;
  side: 'home' | 'away' | null;
  spread_price_home: number | null;
  spread_price_away: number | null;
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
  recommended_bet: string | null;
}

interface CbbGame {
  id: string;
  start_date: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  home_team: { name: string };
  away_team: { name: string };
  market_spread: number | null;
  model_spread: number | null;
  edge_points: number | null;
  recommended_side: 'home' | 'away' | null;
  qualifies_for_bet: boolean;
  is_underdog_bet: boolean;
  home_score: number | null;
  away_score: number | null;
  bet_result: 'win' | 'loss' | 'push' | null;
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
    'Chanticleers', 'RedHawks', 'Chippewas', 'Bobcats', 'Rockets', 'Hilltoppers', 'Dukes',
    'Flyers', 'Musketeers', 'Friars', 'Red Storm', 'Hoyas', 'Shockers'];

  for (const suffix of suffixes) {
    if (fullName.endsWith(suffix)) {
      return fullName.replace(suffix, '').trim();
    }
  }
  return fullName;
}

function formatSpread(spread: number): string {
  const rounded = Math.round(spread * 2) / 2;
  if (rounded > 0) return `+${rounded}`;
  if (rounded === 0) return 'PK';
  return `${rounded}`;
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

export default function HomePage() {
  const [cfbGames, setCfbGames] = useState<CfbGame[]>([]);
  const [cbbGames, setCbbGames] = useState<CbbGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/games?filter=upcoming').then(res => res.json()),
      fetch('/api/cbb/games?filter=upcoming&limit=50').then(res => res.json()),
    ])
      .then(([cfbData, cbbData]) => {
        setCfbGames(cfbData.games || []);
        setCbbGames(cbbData.games || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Top CFB edges (qualifying: 2.5-5 pts)
  const topCfbEdges = useMemo(() =>
    cfbGames
      .filter(g => g.abs_edge !== null && g.abs_edge >= 2.5 && g.abs_edge <= 5)
      .sort((a, b) => (b.abs_edge || 0) - (a.abs_edge || 0))
      .slice(0, 5),
    [cfbGames]
  );

  // Top CBB edges (qualifying bets)
  const topCbbEdges = useMemo(() =>
    cbbGames
      .filter(g => g.qualifies_for_bet && g.edge_points !== null)
      .sort((a, b) => (b.edge_points || 0) - (a.edge_points || 0))
      .slice(0, 5),
    [cbbGames]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-zinc-800 border-t-emerald-500 rounded-full animate-spin" />
          <span className="text-zinc-600 text-sm tracking-wide font-mono">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900/50 via-[#050505] to-[#050505]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
          {/* Nav */}
          <nav className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <span className="font-mono text-3xl font-bold text-white tracking-tight">
                Whodl Bets
              </span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
                Quant Betting
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/games" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                CFB
              </Link>
              <Link href="/cbb" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                CBB
              </Link>
              <Link href="/model" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                Our Model
              </Link>
              <Link href="/reports" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                Reports
              </Link>
            </div>
          </nav>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 font-mono">CFB Model</div>
              <div className="text-xl font-bold text-white font-mono">T-60</div>
              <div className="text-xs text-emerald-400">+20.6% ROI</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 font-mono">CBB Model</div>
              <div className="text-xl font-bold text-white font-mono">Conf-Aware</div>
              <div className="text-xs text-emerald-400">+6.8% ROI</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 font-mono">CFB Edges</div>
              <div className="text-xl font-bold text-emerald-400 font-mono">{topCfbEdges.length}</div>
              <div className="text-xs text-zinc-500">Qualifying bets</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 font-mono">CBB Edges</div>
              <div className="text-xl font-bold text-emerald-400 font-mono">{topCbbEdges.length}</div>
              <div className="text-xs text-zinc-500">Qualifying bets</div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* Top Edges - CFB */}
        {topCfbEdges.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-emerald-400 to-emerald-600 rounded-full" />
                <h2 className="text-lg font-bold text-white">CFB Top Edges</h2>
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-full font-mono">
                  {topCfbEdges.length} bets
                </span>
              </div>
              <Link href="/games" className="text-sm text-zinc-500 hover:text-white transition-colors">
                View all →
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topCfbEdges.map((game) => (
                <div
                  key={game.event_id}
                  className="rounded-xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-950/40 to-[#111] overflow-hidden"
                >
                  {/* Header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/50">
                    <span className="text-xs font-medium text-zinc-400">
                      {formatGameTime(game.commence_time)}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500 text-black">
                      +{game.abs_edge?.toFixed(1)} EDGE
                    </span>
                  </div>

                  {/* Teams */}
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1">
                        <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div>
                        {game.away_rank && <span className="text-xs font-medium text-amber-500">#{game.away_rank} </span>}
                        <span className="font-semibold text-white">{getShortName(game.away_team)}</span>
                        <span className="text-xs text-zinc-600 ml-2">Away</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1">
                        <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div>
                        {game.home_rank && <span className="text-xs font-medium text-amber-500">#{game.home_rank} </span>}
                        <span className="font-semibold text-white">{getShortName(game.home_team)}</span>
                        <span className="text-xs text-zinc-600 ml-2">Home</span>
                      </div>
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="border-t border-zinc-800/50 bg-zinc-900/30 p-3">
                    <div className="space-y-2 mb-3">
                      <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                        game.side === 'away' ? 'bg-blue-500/15 border border-blue-500/40' : 'bg-zinc-800/50'
                      }`}>
                        <span className="text-sm text-zinc-200">{getShortName(game.away_team)}</span>
                        <span className={`font-mono text-sm ${game.side === 'away' ? 'text-blue-400 font-bold' : 'text-zinc-400'}`}>
                          {formatSpread(-(game.market_spread_home || 0))} (-110)
                        </span>
                      </div>
                      <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                        game.side === 'home' ? 'bg-blue-500/15 border border-blue-500/40' : 'bg-zinc-800/50'
                      }`}>
                        <span className="text-sm text-zinc-200">{getShortName(game.home_team)}</span>
                        <span className={`font-mono text-sm ${game.side === 'home' ? 'text-blue-400 font-bold' : 'text-zinc-400'}`}>
                          {formatSpread(game.market_spread_home || 0)} (-110)
                        </span>
                      </div>
                    </div>
                    {game.recommended_bet && (
                      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50">
                        <span className="text-zinc-500 text-xs">via DK</span>
                        <div className="font-bold text-sm px-3 py-1 rounded bg-emerald-500 text-black">
                          BET: {game.recommended_bet}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Top Edges - CBB */}
        {topCbbEdges.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-amber-400 to-orange-500 rounded-full" />
                <h2 className="text-lg font-bold text-white">CBB Top Edges</h2>
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-full font-mono">
                  {topCbbEdges.length} bets
                </span>
              </div>
              <Link href="/cbb" className="text-sm text-zinc-500 hover:text-white transition-colors">
                View all →
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topCbbEdges.map((game) => (
                <div
                  key={game.id}
                  className={`rounded-xl border-2 overflow-hidden ${
                    game.is_underdog_bet
                      ? 'border-amber-400 bg-gradient-to-br from-amber-950/50 to-[#111]'
                      : 'border-emerald-400 bg-gradient-to-br from-emerald-950/50 to-[#111]'
                  }`}
                >
                  {/* Header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-400">
                        {formatGameTime(game.start_date)}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        game.is_underdog_bet ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {game.is_underdog_bet ? 'DOG' : 'FAV'}
                      </span>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      game.is_underdog_bet ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'
                    }`}>
                      +{game.edge_points?.toFixed(1)} EDGE
                    </span>
                  </div>

                  {/* Teams */}
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1">
                        <img src={getCbbTeamLogo(game.away_team.name)} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div>
                        <span className="font-semibold text-white">{getShortName(game.away_team.name)}</span>
                        <span className="text-xs text-zinc-600 ml-2">Away</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800/50 p-1">
                        <img src={getCbbTeamLogo(game.home_team.name)} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div>
                        <span className="font-semibold text-white">{getShortName(game.home_team.name)}</span>
                        <span className="text-xs text-zinc-600 ml-2">Home</span>
                      </div>
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="border-t border-zinc-800/50 bg-zinc-900/30 p-3">
                    <div className="space-y-2 mb-3">
                      <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                        game.recommended_side === 'away' ? 'bg-blue-500/15 border border-blue-500/40' : 'bg-zinc-800/50'
                      }`}>
                        <span className="text-sm text-zinc-200">{getShortName(game.away_team.name)}</span>
                        <span className={`font-mono text-sm ${game.recommended_side === 'away' ? 'text-blue-400 font-bold' : 'text-zinc-400'}`}>
                          {formatSpread(-(game.market_spread || 0))} (-110)
                        </span>
                      </div>
                      <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                        game.recommended_side === 'home' ? 'bg-blue-500/15 border border-blue-500/40' : 'bg-zinc-800/50'
                      }`}>
                        <span className="text-sm text-zinc-200">{getShortName(game.home_team.name)}</span>
                        <span className={`font-mono text-sm ${game.recommended_side === 'home' ? 'text-blue-400 font-bold' : 'text-zinc-400'}`}>
                          {formatSpread(game.market_spread || 0)} (-110)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50">
                      <span className="text-zinc-500 text-xs">via DK</span>
                      <div className={`font-bold text-sm px-3 py-1 rounded ${
                        game.is_underdog_bet ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'
                      }`}>
                        BET: {game.recommended_side === 'home'
                          ? `${getShortName(game.home_team.name)} ${formatSpread(game.market_spread || 0)}`
                          : `${getShortName(game.away_team.name)} ${formatSpread(-(game.market_spread || 0))}`
                        }
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Upcoming Games Grid */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-indigo-500 rounded-full" />
            <h2 className="text-lg font-bold text-white">Upcoming Games</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* CFB Upcoming */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">College Football</h3>
                <Link href="/games" className="text-xs text-zinc-500 hover:text-white">View all →</Link>
              </div>
              <div className="space-y-3">
                {cfbGames.slice(0, 5).map((game) => {
                  const hasEdge = game.abs_edge !== null && game.abs_edge >= 2.5 && game.abs_edge <= 5;
                  return (
                    <div
                      key={game.event_id}
                      className={`rounded-xl p-4 border ${
                        hasEdge
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-zinc-900/50 border-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-zinc-800/50 p-0.5">
                            <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                          </div>
                          <span className="text-sm text-white">{getShortName(game.away_team)}</span>
                          <span className="text-zinc-600">@</span>
                          <div className="w-6 h-6 rounded bg-zinc-800/50 p-0.5">
                            <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                          </div>
                          <span className="text-sm text-white">{getShortName(game.home_team)}</span>
                        </div>
                        <span className="text-xs text-zinc-500">{formatGameTime(game.commence_time)}</span>
                      </div>
                      {hasEdge && game.recommended_bet && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/50">
                          <span className="text-xs text-emerald-400 font-medium">+{game.abs_edge?.toFixed(1)} edge</span>
                          <span className="text-xs font-bold text-emerald-400">{game.recommended_bet}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CBB Upcoming */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">College Basketball</h3>
                <Link href="/cbb" className="text-xs text-zinc-500 hover:text-white">View all →</Link>
              </div>
              <div className="space-y-3">
                {cbbGames.slice(0, 5).map((game) => {
                  const hasEdge = game.qualifies_for_bet;
                  return (
                    <div
                      key={game.id}
                      className={`rounded-xl p-4 border ${
                        hasEdge
                          ? game.is_underdog_bet
                            ? 'bg-amber-950/20 border-amber-500/30'
                            : 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-zinc-900/50 border-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-zinc-800/50 p-0.5">
                            <img src={getCbbTeamLogo(game.away_team.name)} alt="" className="w-full h-full object-contain" />
                          </div>
                          <span className="text-sm text-white">{getShortName(game.away_team.name)}</span>
                          <span className="text-zinc-600">@</span>
                          <div className="w-6 h-6 rounded bg-zinc-800/50 p-0.5">
                            <img src={getCbbTeamLogo(game.home_team.name)} alt="" className="w-full h-full object-contain" />
                          </div>
                          <span className="text-sm text-white">{getShortName(game.home_team.name)}</span>
                        </div>
                        <span className="text-xs text-zinc-500">{formatGameTime(game.start_date)}</span>
                      </div>
                      {hasEdge && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/50">
                          <span className={`text-xs font-medium ${game.is_underdog_bet ? 'text-amber-400' : 'text-emerald-400'}`}>
                            +{game.edge_points?.toFixed(1)} edge
                          </span>
                          <span className={`text-xs font-bold ${game.is_underdog_bet ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {game.recommended_side === 'home'
                              ? `${getShortName(game.home_team.name)} ${formatSpread(game.market_spread || 0)}`
                              : `${getShortName(game.away_team.name)} ${formatSpread(-(game.market_spread || 0))}`
                            }
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-zinc-400">Whodl Bets</span>
              <span>•</span>
              <span>Quantitative Sports Betting</span>
            </div>
            <div className="font-mono text-xs">Updated every 15 min</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
