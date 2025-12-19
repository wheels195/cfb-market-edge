'use client';

import Link from 'next/link';
import { EdgeWithDetails } from '@/types/database';
import { format, formatDistanceToNow } from 'date-fns';

interface EdgesFeedProps {
  edges: EdgeWithDetails[];
}

export function EdgesFeed({ edges }: EdgesFeedProps) {
  return (
    <div className="space-y-4">
      {edges.map((edge) => (
        <EdgeCard key={edge.id} edge={edge} />
      ))}
    </div>
  );
}

function EdgeCard({ edge }: { edge: EdgeWithDetails }) {
  const event = edge.event;
  const commenceTime = new Date(event.commence_time);
  const timeStr = format(commenceTime, 'EEE, MMM d h:mm a');
  const timeUntil = formatDistanceToNow(commenceTime, { addSuffix: true });

  const bookName = edge.sportsbook?.name || 'Unknown';
  const absEdge = Math.abs(edge.edge_points);

  // Extract calibration data from explain field
  const explain = edge.explain as {
    winProbability?: number;
    expectedValue?: number;
    confidenceTier?: string;
    qualifies?: boolean;
    warnings?: string[];
    reason?: string;
    weather?: {
      severity: string;
      factors: string[];
      totalAdjustment?: number;
      spreadAdjustment?: number;
    } | null;
    lineMovement?: {
      opening: number | null;
      current: number | null;
      movement: number;
      tickCount: number;
      sharpSignal: string;
      sharpConfidence: string;
      sharpDescription: string;
      adjustment: number;
      alignsWithBet: boolean;
    } | null;
    injuries?: {
      adjustment: number;
      confidence: string;
      keyInjuries: string[];
    } | null;
    playerFactors?: {
      adjustment: number;
      confidence: string;
      factors: string[];
    } | null;
  } | null;

  const winProb = explain?.winProbability ?? null;
  const ev = explain?.expectedValue ?? null;
  const tier = explain?.confidenceTier ?? 'unknown';
  const qualifies = explain?.qualifies ?? false;
  const warnings = explain?.warnings ?? [];
  const weather = explain?.weather ?? null;
  const lineMovement = explain?.lineMovement ?? null;
  const injuries = explain?.injuries ?? null;
  const playerFactors = explain?.playerFactors ?? null;

  // Determine styling based on confidence tier
  let edgeColor = 'text-zinc-600 dark:text-zinc-400';
  let edgeBg = 'bg-zinc-100 dark:bg-zinc-800';
  let tierBadgeColor = 'bg-zinc-200 text-zinc-700';

  if (tier === 'very-high') {
    edgeColor = 'text-emerald-700 dark:text-emerald-400';
    edgeBg = 'bg-emerald-100 dark:bg-emerald-900/30';
    tierBadgeColor = 'bg-emerald-500 text-white';
  } else if (tier === 'high') {
    edgeColor = 'text-green-700 dark:text-green-400';
    edgeBg = 'bg-green-100 dark:bg-green-900/30';
    tierBadgeColor = 'bg-green-500 text-white';
  } else if (tier === 'medium') {
    edgeColor = 'text-blue-700 dark:text-blue-400';
    edgeBg = 'bg-blue-100 dark:bg-blue-900/30';
    tierBadgeColor = 'bg-blue-500 text-white';
  } else if (tier === 'low') {
    edgeColor = 'text-yellow-700 dark:text-yellow-400';
    edgeBg = 'bg-yellow-100 dark:bg-yellow-900/30';
    tierBadgeColor = 'bg-yellow-500 text-white';
  } else if (tier === 'skip') {
    edgeColor = 'text-red-700 dark:text-red-400';
    edgeBg = 'bg-red-100 dark:bg-red-900/30';
    tierBadgeColor = 'bg-red-500 text-white';
  }

  // Format market and model numbers
  const isSpread = edge.market_type === 'spread';
  const marketNumber = isSpread
    ? `${event.home_team_name} ${formatSpread(edge.market_spread_home || 0)}`
    : `O/U ${edge.market_total_points}`;
  const modelNumber = isSpread
    ? `${event.home_team_name} ${formatSpread(edge.model_spread_home || 0)}`
    : `${edge.model_total_points}`;

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-lg border overflow-hidden ${
      qualifies
        ? 'border-green-300 dark:border-green-700 ring-2 ring-green-100 dark:ring-green-900/50'
        : 'border-zinc-200 dark:border-zinc-800'
    }`}>
      {/* Qualifying Badge */}
      {qualifies && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-bold px-4 py-1.5 flex items-center gap-2">
          <span>BET SIGNAL</span>
          <span className="opacity-75">|</span>
          <span className="font-normal">Meets profitable criteria (60.2% historical win rate)</span>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <Link
          href={`/events/${event.id}`}
          className="hover:text-blue-600 dark:hover:text-blue-400"
        >
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {event.away_team_name} @ {event.home_team_name}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-500">
            {timeStr} ({timeUntil})
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${tierBadgeColor}`}>
            {tier === 'very-high' ? 'VERY HIGH' : tier.toUpperCase()}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${edgeBg} ${edgeColor}`}>
            {edge.market_type === 'spread' ? 'Spread' : 'Total'}
          </span>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {bookName}
          </span>
        </div>
      </div>

      {/* Body - All Required Fields */}
      <div className="p-4 space-y-4">
        {/* Market vs Model Numbers */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Market Number ({bookName})
            </div>
            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {marketNumber}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Model Number
            </div>
            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {modelNumber}
            </div>
          </div>
        </div>

        {/* Edge + Win Probability + EV */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Edge
            </div>
            <div className={`text-xl font-bold ${edgeColor}`}>
              {edge.edge_points > 0 ? '+' : ''}{edge.edge_points.toFixed(1)} pts
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Win Probability
            </div>
            <div className={`text-xl font-bold ${winProb && winProb >= 55 ? 'text-green-600 dark:text-green-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
              {winProb !== null ? `${winProb}%` : 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Expected Value
            </div>
            <div className={`text-xl font-bold ${ev && ev > 0 ? 'text-green-600 dark:text-green-400' : ev && ev < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
              {ev !== null ? `$${ev.toFixed(2)}` : 'N/A'}
            </div>
          </div>
        </div>

        {/* Favorable Bet - MUST BE EXPLICIT */}
        <div className={`${edgeBg} rounded-lg p-3`}>
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            Favorable Bet
          </div>
          <div className={`text-xl font-bold ${edgeColor}`}>
            {edge.recommended_bet_label} ({bookName})
          </div>
        </div>

        {/* Price */}
        {edge.market_price_american && (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            Price: {formatOdds(edge.market_price_american)}
          </div>
        )}

        {/* Line Movement - Sharp Money Indicator */}
        {lineMovement && lineMovement.opening !== null && (
          <div className={`rounded-lg p-3 ${
            lineMovement.alignsWithBet
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : lineMovement.sharpSignal !== 'neutral'
                ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                : 'bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className={`text-xs font-medium ${
                lineMovement.alignsWithBet
                  ? 'text-green-800 dark:text-green-200'
                  : lineMovement.sharpSignal !== 'neutral'
                    ? 'text-amber-800 dark:text-amber-200'
                    : 'text-zinc-600 dark:text-zinc-400'
              }`}>
                Line Movement
                {lineMovement.sharpSignal !== 'neutral' && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    lineMovement.alignsWithBet
                      ? 'bg-green-500 text-white'
                      : 'bg-amber-500 text-white'
                  }`}>
                    SHARP MONEY
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500">
                {lineMovement.tickCount} tick{lineMovement.tickCount !== 1 ? 's' : ''} tracked
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {lineMovement.opening}
              </span>
              <span className="text-zinc-400">→</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {lineMovement.current}
              </span>
              <span className={`font-semibold ${
                lineMovement.movement > 0 ? 'text-green-600' : lineMovement.movement < 0 ? 'text-red-600' : 'text-zinc-500'
              }`}>
                ({lineMovement.movement > 0 ? '+' : ''}{lineMovement.movement})
              </span>
            </div>
            {lineMovement.sharpSignal !== 'neutral' && (
              <div className={`mt-2 text-xs ${
                lineMovement.alignsWithBet ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'
              }`}>
                {lineMovement.sharpDescription}
              </div>
            )}
          </div>
        )}

        {/* Weather Alert */}
        {weather && weather.severity !== 'none' && (
          <div className={`rounded-lg p-3 ${
            weather.severity === 'severe'
              ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700'
              : 'bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800'
          }`}>
            <div className={`text-xs font-medium mb-1 ${
              weather.severity === 'severe'
                ? 'text-blue-800 dark:text-blue-200'
                : 'text-sky-800 dark:text-sky-200'
            }`}>
              Weather Impact ({weather.severity.toUpperCase()})
            </div>
            <ul className={`text-sm space-y-1 ${
              weather.severity === 'severe'
                ? 'text-blue-700 dark:text-blue-300'
                : 'text-sky-700 dark:text-sky-300'
            }`}>
              {weather.factors.map((factor, i) => (
                <li key={i}>{factor}</li>
              ))}
            </ul>
            {(weather.totalAdjustment || weather.spreadAdjustment) && (
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {weather.totalAdjustment && `Total adj: ${weather.totalAdjustment > 0 ? '+' : ''}${weather.totalAdjustment} pts`}
                {weather.totalAdjustment && weather.spreadAdjustment && ' | '}
                {weather.spreadAdjustment && `Spread adj: ${weather.spreadAdjustment > 0 ? '+' : ''}${weather.spreadAdjustment} pts`}
              </div>
            )}
          </div>
        )}

        {/* Key Injuries */}
        {injuries && injuries.keyInjuries.length > 0 && (
          <div className="rounded-lg p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <div className="text-xs font-medium text-red-800 dark:text-red-200 mb-1">
              Key Injuries (adj: {injuries.adjustment > 0 ? '+' : ''}{injuries.adjustment} pts)
            </div>
            <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
              {injuries.keyInjuries.map((injury, i) => (
                <li key={i}>{injury}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Player Factors */}
        {playerFactors && playerFactors.factors.length > 0 && (
          <div className="rounded-lg p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
            <div className="text-xs font-medium text-purple-800 dark:text-purple-200 mb-1">
              Player Factors (adj: {playerFactors.adjustment > 0 ? '+' : ''}{playerFactors.adjustment} pts)
            </div>
            <ul className="text-sm text-purple-700 dark:text-purple-300 space-y-1">
              {playerFactors.factors.map((factor, i) => (
                <li key={i}>{factor}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <div className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-1">
              Warnings
            </div>
            <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
              {warnings.map((warning, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-500">!</span>
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-zinc-400 dark:text-zinc-500">
          As of {format(new Date(edge.as_of), 'MMM d, h:mm a')}
        </div>
      </div>

      {/* Rank Badge */}
      {edge.rank_abs_edge && (
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Rank #{edge.rank_abs_edge} for {bookName} {edge.market_type}s
          </span>
        </div>
      )}
    </div>
  );
}

function formatSpread(points: number): string {
  if (points > 0) return `+${points}`;
  return points.toString();
}

function formatOdds(price: number): string {
  if (price > 0) return `+${price}`;
  return price.toString();
}
