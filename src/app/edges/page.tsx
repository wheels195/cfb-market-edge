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

// Strip mascot from team name for compact display
function getShortName(fullName: string): string {
  // Common patterns: "Texas A&M Aggies" -> "Texas A&M"
  const parts = fullName.split(' ');
  // Check if last word is a mascot (starts with capital, not part of school name)
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

  // Remove mascot words from end
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

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function formatSpread(spread: number): string {
  return spread > 0 ? `+${spread}` : `${spread}`;
}

export default function EdgesPage() {
  const [games, setGames] = useState<GameEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/paper-bets/recommendations')
      .then(res => res.json())
      .then(data => {
        setGames(data.recommendations || []);
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
            <h1 className="text-lg font-semibold text-white">CFB Edges</h1>
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
        {Object.entries(gamesByDate).map(([date, dateGames]) => (
          <div key={date} className="mb-6">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
              {date}
            </h2>

            <div className="bg-[#111] rounded-lg border border-zinc-800 overflow-hidden">
              {dateGames.map((game, idx) => {
                const awaySpread = -game.market_spread_home;
                const homeSpread = game.market_spread_home;
                const gameTime = new Date(game.commence_time).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={game.event_id}
                    className={`${idx > 0 ? 'border-t border-zinc-800' : ''}`}
                  >
                    {/* Game Card */}
                    <div className="p-3">
                      {/* Away Team Row */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-7 h-7 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(game.away_team)}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          </div>
                          {game.away_rank && (
                            <span className="text-xs text-zinc-500 font-medium">{game.away_rank}</span>
                          )}
                          <span className={`text-sm truncate ${game.side === 'away' ? 'text-white font-medium' : 'text-zinc-400'}`}>
                            {getShortName(game.away_team)}
                          </span>
                        </div>
                        {/* Away Spread */}
                        <div className={`text-right ml-2 px-2 py-1 rounded ${game.side === 'away' ? 'bg-emerald-500/20' : ''}`}>
                          <div className={`text-sm font-medium ${game.side === 'away' ? 'text-emerald-400' : 'text-zinc-300'}`}>
                            {formatSpread(awaySpread)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {formatPrice(game.spread_price_away)}
                          </div>
                        </div>
                      </div>

                      {/* Home Team Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-7 h-7 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(game.home_team)}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          </div>
                          {game.home_rank && (
                            <span className="text-xs text-zinc-500 font-medium">{game.home_rank}</span>
                          )}
                          <span className={`text-sm truncate ${game.side === 'home' ? 'text-white font-medium' : 'text-zinc-400'}`}>
                            {getShortName(game.home_team)}
                          </span>
                        </div>
                        {/* Home Spread */}
                        <div className={`text-right ml-2 px-2 py-1 rounded ${game.side === 'home' ? 'bg-emerald-500/20' : ''}`}>
                          <div className={`text-sm font-medium ${game.side === 'home' ? 'text-emerald-400' : 'text-zinc-300'}`}>
                            {formatSpread(homeSpread)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {formatPrice(game.spread_price_home)}
                          </div>
                        </div>
                      </div>

                      {/* Footer: Time, Edge, Model */}
                      <div className="mt-3 pt-2 border-t border-zinc-800/50 flex items-center justify-between">
                        <span className="text-xs text-zinc-600">{gameTime}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500">
                            Model: {formatSpread(game.model_spread_home)}
                          </span>
                          <span className={`text-sm font-bold ${game.abs_edge >= 7 ? 'text-emerald-400' : 'text-white'}`}>
                            +{game.abs_edge.toFixed(1)}
                          </span>
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
