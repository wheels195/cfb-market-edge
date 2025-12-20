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
      <header className="bg-[#111] border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-white">CFB Edges</h1>
              <p className="text-sm text-zinc-500 mt-0.5">Model-identified spread opportunities</p>
            </div>
            <a
              href="/paper-trading"
              className="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
            >
              Paper Trading &rarr;
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {Object.entries(gamesByDate).map(([date, dateGames]) => (
          <div key={date} className="mb-8">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
              {date}
            </h2>

            <div className="bg-[#111] rounded-lg border border-zinc-800 divide-y divide-zinc-800">
              {dateGames.map((game) => {
                const betTeam = game.side === 'home' ? game.home_team : game.away_team;
                const betSpread = game.side === 'home' ? game.market_spread_home : -game.market_spread_home;
                const betOdds = game.side === 'home' ? game.spread_price_home : game.spread_price_away;
                const gameTime = new Date(game.commence_time).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                });

                return (
                  <div key={game.event_id} className="p-4">
                    <div className="flex items-start justify-between">
                      {/* Left: Matchup */}
                      <div className="flex-1">
                        {/* Away Team */}
                        <div className="flex items-center gap-3 mb-1">
                          <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(game.away_team)}
                              alt={game.away_team}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-zinc-500 text-sm w-6 text-right">
                            {game.away_rank || ''}
                          </span>
                          <span className={`font-medium ${game.side === 'away' ? 'text-white' : 'text-zinc-400'}`}>
                            {game.away_team}
                          </span>
                          {game.side === 'away' && (
                            <span className="text-emerald-400 text-xs font-medium ml-1">BET</span>
                          )}
                        </div>

                        {/* AT divider */}
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wider ml-11 my-1">
                          at
                        </div>

                        {/* Home Team */}
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getTeamLogo(game.home_team)}
                              alt={game.home_team}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-zinc-500 text-sm w-6 text-right">
                            {game.home_rank || ''}
                          </span>
                          <span className={`font-medium ${game.side === 'home' ? 'text-white' : 'text-zinc-400'}`}>
                            {game.home_team}
                          </span>
                          {game.side === 'home' && (
                            <span className="text-emerald-400 text-xs font-medium ml-1">BET</span>
                          )}
                        </div>
                      </div>

                      {/* Right: Bet Details */}
                      <div className="text-right ml-6">
                        <div className="text-white font-semibold">
                          {betTeam} {betSpread > 0 ? '+' : ''}{betSpread}
                        </div>
                        <div className="text-zinc-500 text-sm">
                          {betOdds > 0 ? '+' : ''}{betOdds}
                        </div>
                        <div className={`text-lg font-bold mt-1 ${game.abs_edge >= 7 ? 'text-emerald-400' : 'text-white'}`}>
                          +{game.abs_edge.toFixed(1)}
                          <span className="text-xs text-zinc-500 font-normal ml-1">edge</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer: Time + Line Comparison */}
                    <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs">
                      <span className="text-zinc-600">{gameTime}</span>
                      <div className="flex gap-4">
                        <span>
                          <span className="text-zinc-600">Market:</span>
                          <span className="ml-1 text-zinc-400">
                            {game.home_team} {game.market_spread_home > 0 ? '+' : ''}{game.market_spread_home}
                          </span>
                        </span>
                        <span>
                          <span className="text-zinc-600">Model:</span>
                          <span className="ml-1 text-zinc-400">
                            {game.home_team} {game.model_spread_home > 0 ? '+' : ''}{game.model_spread_home.toFixed(1)}
                          </span>
                        </span>
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
