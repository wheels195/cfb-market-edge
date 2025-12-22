'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
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
  if (spread > 0) return `+${spread.toFixed(1)}`;
  if (spread === 0) return 'PK';
  return spread.toFixed(1);
}

function formatGameTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'Live';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getShortName(name: string): string {
  // CBB team names are usually just school names
  // Remove common suffixes
  const suffixes = [
    'Wildcats', 'Bulldogs', 'Tigers', 'Bears', 'Blue Devils', 'Tar Heels',
    'Cardinals', 'Jayhawks', 'Crimson Tide', 'Volunteers', 'Spartans',
    'Wolverines', 'Buckeyes', 'Boilermakers', 'Fighting Illini', 'Hoosiers',
    'Hawkeyes', 'Golden Gophers', 'Badgers', 'Cyclones', 'Longhorns',
    'Aggies', 'Red Raiders', 'Cowboys', 'Sooners', 'Mountaineers',
    'Cougars', 'Ducks', 'Beavers', 'Huskies', 'Bruins', 'Trojans',
    'Sun Devils', 'Buffaloes', 'Utes', 'Golden Eagles', 'Eagles',
  ];

  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      return name.replace(suffix, '').trim();
    }
  }
  return name;
}

function TeamLogo({ name }: { name: string }) {
  const [imgError, setImgError] = useState(false);
  const logoUrl = getCbbTeamLogo(name);

  if (imgError) {
    return (
      <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center">
        <span className="text-xs font-bold text-zinc-400">
          {name.slice(0, 2).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={logoUrl}
      alt={name}
      width={40}
      height={40}
      className="rounded-full bg-white"
      onError={() => setImgError(true)}
    />
  );
}

function GameCard({ game }: { game: CbbGame }) {
  const isQualifying = game.qualifies_for_bet;
  const hasResult = game.bet_result !== null;

  // Determine card styling based on status
  let borderColor = 'border-zinc-700';
  let badgeColor = 'bg-zinc-700 text-zinc-300';
  let badgeText = 'WATCH';

  if (isQualifying) {
    borderColor = 'border-emerald-500';
    badgeColor = 'bg-emerald-500 text-white';
    badgeText = 'BET';
  }

  if (hasResult) {
    if (game.bet_result === 'win') {
      borderColor = 'border-emerald-500';
      badgeColor = 'bg-emerald-500 text-white';
      badgeText = 'WIN';
    } else if (game.bet_result === 'loss') {
      borderColor = 'border-red-500';
      badgeColor = 'bg-red-500 text-white';
      badgeText = 'LOSS';
    } else {
      borderColor = 'border-yellow-500';
      badgeColor = 'bg-yellow-500 text-black';
      badgeText = 'PUSH';
    }
  }

  return (
    <div className={`bg-zinc-800 rounded-lg border-2 ${borderColor} p-4 transition-all hover:shadow-lg`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${badgeColor}`}>
          {badgeText}
        </span>
        {game.edge_points !== null && game.edge_points > 0 && (
          <span className={`text-sm font-mono ${isQualifying ? 'text-emerald-400' : 'text-zinc-400'}`}>
            +{game.edge_points.toFixed(1)} edge
          </span>
        )}
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between mb-4">
        {/* Away Team */}
        <div className="flex items-center gap-2">
          <TeamLogo name={game.away_team.name} />
          <div>
            <div className="font-semibold text-white">
              {getShortName(game.away_team.name)}
            </div>
            <div className="text-xs text-zinc-400">
              {game.away_team.elo.toFixed(0)} Elo
            </div>
          </div>
        </div>

        <div className="text-zinc-500 text-sm">@</div>

        {/* Home Team */}
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="font-semibold text-white">
              {getShortName(game.home_team.name)}
            </div>
            <div className="text-xs text-zinc-400">
              {game.home_team.elo.toFixed(0)} Elo
            </div>
          </div>
          <TeamLogo name={game.home_team.name} />
        </div>
      </div>

      {/* Score (if completed) */}
      {game.status === 'completed' && game.home_score !== null && (
        <div className="text-center mb-3">
          <span className="text-lg font-bold text-white">
            {game.away_score} - {game.home_score}
          </span>
          <span className="text-xs text-zinc-500 ml-2">FINAL</span>
        </div>
      )}

      {/* Spread Info */}
      <div className="border-t border-zinc-700 pt-3 space-y-1">
        {game.market_spread !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Market:</span>
            <span className="text-white font-mono">
              {game.market_spread > 0 ? game.away_team.name.split(' ')[0] : game.home_team.name.split(' ')[0]}{' '}
              {formatSpread(-Math.abs(game.market_spread))}
            </span>
          </div>
        )}
        {game.model_spread !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Model:</span>
            <span className="text-zinc-300 font-mono">
              {game.model_spread > 0 ? game.away_team.name.split(' ')[0] : game.home_team.name.split(' ')[0]}{' '}
              {formatSpread(-Math.abs(game.model_spread))}
            </span>
          </div>
        )}
      </div>

      {/* Bet Recommendation */}
      {isQualifying && game.qualification_reason && (
        <div className="mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded p-2">
          <div className="text-xs text-emerald-400 font-semibold">
            BET: {game.recommended_side === 'home' ? game.home_team.name : game.away_team.name}{' '}
            {formatSpread(game.recommended_side === 'home' ? game.market_spread : -(game.market_spread || 0))}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Underdog • {Math.abs(game.market_spread || 0).toFixed(0)}pt spread • {game.edge_points?.toFixed(1)}pt edge
          </div>
        </div>
      )}

      {/* Disqualification reason */}
      {!isQualifying && game.qualification_reason && (
        <div className="mt-2 text-xs text-zinc-500">
          {game.qualification_reason}
        </div>
      )}

      {/* Game Time */}
      <div className="mt-3 text-xs text-zinc-500 text-center">
        {formatGameTime(game.start_date)}
      </div>
    </div>
  );
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

  return (
    <div className="min-h-screen bg-zinc-900 text-white">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">College Basketball</h1>
          <p className="text-zinc-400">
            Elo model • Bet underdogs with 10+ pt spreads and 2.5-5 pt edge
          </p>
        </div>

        {/* Stats Card */}
        {stats && stats.total_bets > 0 && (
          <div className="bg-zinc-800 rounded-lg p-4 mb-6">
            <h2 className="text-sm font-semibold text-zinc-400 mb-3">SEASON PERFORMANCE</h2>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-2xl font-bold">{stats.total_bets}</div>
                <div className="text-xs text-zinc-500">Bets</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {stats.wins}-{stats.losses}
                </div>
                <div className="text-xs text-zinc-500">Record</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${stats.win_rate >= 0.52 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(stats.win_rate * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-zinc-500">Win Rate</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.roi >= 0 ? '+' : ''}{(stats.roi * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-zinc-500">ROI</div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {(['upcoming', 'bets', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-emerald-500 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {f === 'upcoming' ? 'Upcoming' : f === 'bets' ? 'Qualifying Bets' : 'Results'}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 text-zinc-500">
            Loading games...
          </div>
        )}

        {/* Games Grid */}
        {!loading && games.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            No games found for this filter.
          </div>
        )}

        {!loading && games.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map(game => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}

        {/* Strategy Info */}
        <div className="mt-8 bg-zinc-800/50 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-400 mb-2">STRATEGY INFO</h3>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• Only bet <strong className="text-zinc-300">underdogs</strong> with spreads of 10+ points</li>
            <li>• Model edge must be between 2.5-5 points</li>
            <li>• Both teams must have played 5+ games this season</li>
            <li>• Backtest: 59.4% win rate, +13.5% ROI on 138 bets</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
