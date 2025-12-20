'use client';

import { useState, useEffect } from 'react';
import { getTeamLogo } from '@/lib/team-logos';

interface GameEdge {
  event_id: string;
  home_team: string;
  away_team: string;
  home_rank: number | null;
  away_rank: number | null;
  commence_time: string;
  market_spread_home: number;
  model_spread_home: number;
  edge_points: number;
  abs_edge: number;
  side: 'home' | 'away';
  spread_price_home: number;
  spread_price_away: number;
}

function getShortName(fullName: string): string {
  const parts = fullName.split(' ');
  const mascots = ['Crimson', 'Tide', 'Aggies', 'Tigers', 'Bulldogs', 'Rebels', 'Hurricanes',
    'Ducks', 'Dukes', 'Wave', 'Green', 'Volunteers', 'Longhorns', 'Cardinals', 'Rockets',
    'Cougars', 'Wildcats', 'Buckeyes', 'Wolverines', 'Nittany', 'Lions', 'Hoosiers',
    'Hawkeyes', 'Cornhuskers', 'Gophers', 'Golden', 'Badgers', 'Trojans', 'Bruins',
    'Bears', 'Devils', 'Sun', 'Horned', 'Frogs', 'Raiders', 'Red', 'Utes', 'Mountaineers',
    'Bearcats', 'Knights', 'Black', 'Mustangs', 'Panthers', 'Demon', 'Deacons', 'Cavaliers',
    'Hokies', 'Yellow', 'Jackets', 'Seminoles', 'Blue', 'Orange', 'Owls', 'Pirates',
    'Midshipmen', 'Mean', 'Bulls', 'Blazers', 'Roadrunners', 'Fighting', 'Irish',
    'Huskies', 'Minutemen', 'Hilltoppers', 'Chanticleers', 'Eagles', 'Mountaineers',
    'Bobcats', 'Chippewas', 'RedHawks', 'Lobos', 'Aztecs', 'Rainbow', 'Warriors', 'Wolf', 'Pack'];

  let shortName = fullName;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (mascots.includes(parts[i])) {
      shortName = parts.slice(0, i).join(' ');
    } else {
      break;
    }
  }
  return shortName || fullName;
}

function formatSpread(spread: number, forTeam: 'home' | 'away', homeSpread: number): string {
  const value = forTeam === 'home' ? homeSpread : -homeSpread;
  if (value > 0) return `+${value}`;
  if (value === 0) return 'PK';
  return `${value}`;
}

export default function EdgesPage() {
  const [games, setGames] = useState<GameEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/paper-bets/recommendations')
      .then(res => res.json())
      .then(data => {
        // Sort games by date chronologically
        const sorted = (data.recommendations || []).sort((a: GameEdge, b: GameEdge) =>
          new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()
        );
        setGames(sorted);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  // Group games by date
  const gamesByDate = games.reduce((acc, game) => {
    const date = new Date(game.commence_time).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(game);
    return acc;
  }, {} as Record<string, GameEdge[]>);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="bg-[#111] border-b border-zinc-800 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-3 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-white">Games</h1>
            <a
              href="/paper-trading"
              className="text-xs font-medium text-zinc-400 hover:text-white"
            >
              Paper Trading →
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-3 py-4">
        {/* Legend - How to Read */}
        <div className="mb-6 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">How to Read</h3>
          <div className="space-y-1 text-xs text-zinc-500">
            <p><span className="text-zinc-300">Market</span> = Current betting line from sportsbooks</p>
            <p><span className="text-zinc-300">Model</span> = What our Elo model thinks the line should be</p>
            <p><span className="text-emerald-400">Bet</span> = Recommended bet based on the difference</p>
            <p><span className="text-emerald-400">+X.X edge</span> = Points of value (bigger = better)</p>
          </div>
        </div>

        {Object.entries(gamesByDate).map(([date, dateGames]) => (
          <div key={date} className="mb-6">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
              {date}
            </h2>

            <div className="space-y-3">
              {dateGames.map((game) => {
                const gameTime = new Date(game.commence_time).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                // Determine the bet details
                const betTeam = game.side === 'home' ? game.home_team : game.away_team;
                const betTeamShort = getShortName(betTeam);
                const betSpread = game.side === 'home' ? game.market_spread_home : -game.market_spread_home;
                const betSpreadStr = betSpread > 0 ? `+${betSpread}` : betSpread === 0 ? 'PK' : `${betSpread}`;

                // Market spread description (from home team perspective)
                const marketFavorite = game.market_spread_home < 0 ? game.home_team : game.away_team;
                const marketFavoriteShort = getShortName(marketFavorite);
                const marketSpreadAbs = Math.abs(game.market_spread_home);

                // Model spread description (from home team perspective)
                const modelFavorite = game.model_spread_home < 0 ? game.home_team : game.away_team;
                const modelFavoriteShort = getShortName(modelFavorite);
                const modelSpreadAbs = Math.abs(game.model_spread_home);

                return (
                  <div
                    key={game.event_id}
                    className="bg-[#111] rounded-lg border border-zinc-800 overflow-hidden"
                  >
                    {/* Matchup Header */}
                    <div className="p-3 border-b border-zinc-800/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {/* Away Team */}
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-zinc-800 overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={getTeamLogo(game.away_team)} alt="" className="w-full h-full object-contain" />
                            </div>
                            <span className="text-sm text-zinc-300">
                              {game.away_rank && <span className="text-zinc-500 mr-1">{game.away_rank}</span>}
                              {getShortName(game.away_team)}
                            </span>
                          </div>

                          <span className="text-zinc-600 text-xs">@</span>

                          {/* Home Team */}
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-zinc-800 overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={getTeamLogo(game.home_team)} alt="" className="w-full h-full object-contain" />
                            </div>
                            <span className="text-sm text-zinc-300">
                              {game.home_rank && <span className="text-zinc-500 mr-1">{game.home_rank}</span>}
                              {getShortName(game.home_team)}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-zinc-600">{gameTime}</span>
                      </div>
                    </div>

                    {/* Analysis Section */}
                    <div className="p-3 space-y-2">
                      {/* Market Line */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500 uppercase tracking-wide">Market</span>
                        <span className="text-sm text-zinc-300">
                          {marketFavoriteShort} {marketSpreadAbs === 0 ? 'PK' : `-${marketSpreadAbs}`}
                        </span>
                      </div>

                      {/* Model Line */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500 uppercase tracking-wide">Model</span>
                        <span className="text-sm text-zinc-400">
                          {modelSpreadAbs < 0.5 ? 'Pick\'em' : `${modelFavoriteShort} -${modelSpreadAbs}`}
                        </span>
                      </div>

                      {/* Divider */}
                      <div className="border-t border-zinc-800/50 my-2" />

                      {/* THE BET - highlighted */}
                      <div className="flex items-center justify-between bg-emerald-500/10 -mx-3 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-emerald-400 uppercase tracking-wide">Bet</span>
                          <div className="w-5 h-5 rounded bg-zinc-800 overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={getTeamLogo(betTeam)} alt="" className="w-full h-full object-contain" />
                          </div>
                          <span className="text-sm font-semibold text-white">
                            {betTeamShort} {betSpreadStr}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-emerald-400">
                            +{game.abs_edge.toFixed(1)}
                          </span>
                          <span className="text-xs text-emerald-400/70 ml-1">edge</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {games.length === 0 && (
          <div className="text-center py-16 text-zinc-500">
            No games with edges found
          </div>
        )}
      </main>
    </div>
  );
}
