'use client';

import { useState, useEffect } from 'react';
import { getTeamLogo } from '@/lib/team-logos';

interface GameEdge {
  event_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  market_spread_home: number;
  model_spread_home: number;
  edge_points: number;
  abs_edge: number;
  side: 'home' | 'away';
  spread_price_home: number;
  spread_price_away: number;
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
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
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
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      {/* Header */}
      <div className="bg-[#1a1a1a] border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏈</span>
            <h1 className="text-lg font-bold uppercase tracking-wide">CFB Bowl Games</h1>
          </div>
          <a href="/paper-trading" className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#333] rounded text-sm font-medium transition-colors">
            Paper Trading →
          </a>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {Object.entries(gamesByDate).map(([date, dateGames]) => (
          <div key={date} className="mb-8">
            {/* Date Header */}
            <div className="text-zinc-500 text-sm font-medium mb-3 uppercase tracking-wider">
              {date}
            </div>

            {/* Games Table */}
            <div className="bg-[#1a1a1a] rounded-lg overflow-hidden border border-zinc-800">
              {/* Column Headers */}
              <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                <div className="col-span-5"></div>
                <div className="col-span-2 text-center">Spread</div>
                <div className="col-span-2 text-center">Model</div>
                <div className="col-span-3 text-center">Edge</div>
              </div>

              {dateGames.map((game) => {
                const awaySpread = -game.market_spread_home;
                const homeSpread = game.market_spread_home;
                const awayModelSpread = -game.model_spread_home;
                const homeModelSpread = game.model_spread_home;
                const gameTime = new Date(game.commence_time).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div key={game.event_id} className="border-b border-zinc-800/50 last:border-b-0">
                    {/* Away Team Row */}
                    <div className={`grid grid-cols-12 gap-2 px-4 py-3 items-center ${game.side === 'away' ? 'bg-emerald-500/5' : ''}`}>
                      <div className="col-span-5 flex items-center gap-3">
                        <TeamLogo name={game.away_team} />
                        <span className="font-medium">{game.away_team}</span>
                        {game.side === 'away' && (
                          <span className="ml-2 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded">
                            BET
                          </span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <BetCell
                          line={awaySpread}
                          odds={game.spread_price_away}
                          isRecommended={game.side === 'away'}
                        />
                      </div>
                      <div className="col-span-2 text-center text-zinc-500 text-sm">
                        {awayModelSpread > 0 ? `+${awayModelSpread.toFixed(1)}` : awayModelSpread.toFixed(1)}
                      </div>
                      <div className="col-span-3">
                        {game.side === 'away' && (
                          <EdgeBadge edge={game.abs_edge} />
                        )}
                      </div>
                    </div>

                    {/* Home Team Row */}
                    <div className={`grid grid-cols-12 gap-2 px-4 py-3 items-center ${game.side === 'home' ? 'bg-emerald-500/5' : ''}`}>
                      <div className="col-span-5 flex items-center gap-3">
                        <TeamLogo name={game.home_team} />
                        <span className="font-medium">{game.home_team}</span>
                        {game.side === 'home' && (
                          <span className="ml-2 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded">
                            BET
                          </span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <BetCell
                          line={homeSpread}
                          odds={game.spread_price_home}
                          isRecommended={game.side === 'home'}
                        />
                      </div>
                      <div className="col-span-2 text-center text-zinc-500 text-sm">
                        {homeModelSpread > 0 ? `+${homeModelSpread.toFixed(1)}` : homeModelSpread.toFixed(1)}
                      </div>
                      <div className="col-span-3">
                        {game.side === 'home' && (
                          <EdgeBadge edge={game.abs_edge} />
                        )}
                      </div>
                    </div>

                    {/* Game Time Footer */}
                    <div className="px-4 py-2 bg-[#141414] flex items-center justify-between text-xs text-zinc-600">
                      <span>{gameTime}</span>
                      <span>DraftKings</span>
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
      </div>
    </div>
  );
}

function TeamLogo({ name }: { name: string }) {
  const logoUrl = getTeamLogo(name);
  return (
    <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden flex-shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt={name} className="w-full h-full object-cover" />
    </div>
  );
}

function BetCell({ line, odds, isRecommended }: { line: number; odds: number; isRecommended: boolean }) {
  const lineDisplay = line > 0 ? `+${line}` : line === 0 ? 'PK' : line.toString();
  const oddsDisplay = odds > 0 ? `+${odds}` : odds.toString();

  return (
    <div className={`text-center py-2 px-3 rounded ${isRecommended ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-[#222] border border-zinc-700/50'}`}>
      <div className={`text-sm font-semibold ${isRecommended ? 'text-white' : 'text-zinc-300'}`}>
        {lineDisplay}
      </div>
      <div className={`text-xs font-medium ${isRecommended ? 'text-emerald-400' : 'text-emerald-500'}`}>
        {oddsDisplay}
      </div>
    </div>
  );
}

function EdgeBadge({ edge }: { edge: number }) {
  const tier = edge >= 10 ? 'strong' : edge >= 5 ? 'good' : 'marginal';
  const colors = {
    strong: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    good: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    marginal: 'bg-zinc-700 text-zinc-400 border-zinc-600',
  };

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border ${colors[tier]}`}>
      <span className="text-sm font-bold">+{edge.toFixed(1)}</span>
      <span className="text-xs opacity-75">pts</span>
    </div>
  );
}
