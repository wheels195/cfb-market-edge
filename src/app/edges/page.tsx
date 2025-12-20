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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Games</h1>
        <p className="text-zinc-500 mb-8">Model projections vs market lines</p>

        <div className="space-y-4">
          {games.map((game) => {
            const betTeam = game.side === 'home' ? game.home_team : game.away_team;
            const betSpread = game.side === 'home'
              ? (game.market_spread_home > 0 ? `+${game.market_spread_home}` : game.market_spread_home)
              : (-game.market_spread_home > 0 ? `+${-game.market_spread_home}` : -game.market_spread_home);
            const odds = game.side === 'home' ? game.spread_price_home : game.spread_price_away;

            return (
              <div key={game.event_id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <TeamLogo name={game.away_team} />
                      <TeamLogo name={game.home_team} />
                    </div>
                    <div>
                      <div className="font-semibold text-white">{game.away_team} @ {game.home_team}</div>
                      <div className="text-xs text-zinc-500">
                        {new Date(game.commence_time).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-lg text-sm font-bold ${
                    game.abs_edge >= 10
                      ? 'bg-amber-500/20 text-amber-400'
                      : game.abs_edge >= 5
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {game.abs_edge.toFixed(1)} pts
                  </div>
                </div>

                {/* Market vs Model */}
                <div className="bg-zinc-800/50 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-zinc-500 uppercase mb-1">Market</div>
                      <div className="text-lg font-semibold text-zinc-300">
                        {game.home_team} {game.market_spread_home > 0 ? `+${game.market_spread_home}` : game.market_spread_home}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 uppercase mb-1">Model</div>
                      <div className="text-lg font-semibold text-white">
                        {game.home_team} {game.model_spread_home > 0 ? `+${game.model_spread_home.toFixed(1)}` : game.model_spread_home.toFixed(1)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* The Bet - Color coded */}
                <div className={`rounded-lg p-4 border ${
                  game.abs_edge >= 10
                    ? 'bg-amber-500/15 border-amber-500/40'
                    : game.abs_edge >= 5
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-zinc-800/50 border-zinc-700/50'
                }`}>
                  <div className={`text-xs uppercase mb-1 ${
                    game.abs_edge >= 10
                      ? 'text-amber-400'
                      : game.abs_edge >= 5
                        ? 'text-emerald-400'
                        : 'text-zinc-500'
                  }`}>
                    {game.abs_edge >= 10 ? 'Strong Bet' : game.abs_edge >= 5 ? 'Good Bet' : 'Marginal'}
                  </div>
                  <div className="text-xl font-bold text-white">
                    {betTeam} {betSpread} ({odds > 0 ? `+${odds}` : odds}) on DraftKings
                  </div>
                </div>
              </div>
            );
          })}

          {games.length === 0 && (
            <div className="text-center py-12 text-zinc-500">
              No games with edges found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamLogo({ name }: { name: string }) {
  const logoUrl = getTeamLogo(name);
  return (
    <div className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-zinc-700 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt={name} className="w-full h-full object-cover" />
    </div>
  );
}
