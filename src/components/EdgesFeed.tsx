'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EdgeWithDetails } from '@/types/database';
import { format, formatDistanceToNow } from 'date-fns';

interface EdgesFeedProps {
  edges: EdgeWithDetails[];
}

export function EdgesFeed({ edges }: EdgesFeedProps) {
  // Separate qualifying and non-qualifying edges
  const qualifying = edges.filter(e => (e.explain as { qualifies?: boolean })?.qualifies);
  const other = edges.filter(e => !(e.explain as { qualifies?: boolean })?.qualifies);

  return (
    <div className="space-y-6">
      {/* Qualifying Bets Section */}
      {qualifying.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
              Qualifying Bets ({qualifying.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {qualifying.map((edge) => (
              <EdgeCard key={edge.id} edge={edge} />
            ))}
          </div>
        </div>
      )}

      {/* Other Edges */}
      {other.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
            Other Edges ({other.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {other.map((edge) => (
              <EdgeCard key={edge.id} edge={edge} />
            ))}
          </div>
        </div>
      )}

      {edges.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          No edges found
        </div>
      )}
    </div>
  );
}

function EdgeCard({ edge }: { edge: EdgeWithDetails }) {
  const [expanded, setExpanded] = useState(false);
  const event = edge.event;
  const commenceTime = new Date(event.commence_time);
  const timeUntil = formatDistanceToNow(commenceTime, { addSuffix: false });

  const bookName = edge.sportsbook?.name || 'Unknown';
  const bookKey = edge.sportsbook?.key || '';

  // Extract explain data
  const explain = edge.explain as {
    winProbability?: number;
    expectedValue?: number;
    confidenceTier?: string;
    qualifies?: boolean;
    warnings?: string[];
    weather?: { severity: string; factors: string[]; totalAdjustment?: number; spreadAdjustment?: number } | null;
    lineMovement?: { opening: number | null; current: number | null; movement: number; tickCount: number; sharpSignal: string; sharpDescription: string; alignsWithBet: boolean } | null;
    injuries?: { adjustment: number; keyInjuries: string[] } | null;
    playerFactors?: { adjustment: number; factors: string[] } | null;
    situational?: { netAdjustment: number; factors: Record<string, unknown> } | null;
    pace?: { adjustment: number; effectiveAdjustment: number } | null;
  } | null;

  const winProb = explain?.winProbability ?? null;
  const ev = explain?.expectedValue ?? null;
  const tier = explain?.confidenceTier ?? 'unknown';
  const qualifies = explain?.qualifies ?? false;
  const warnings = explain?.warnings ?? [];
  const lineMovement = explain?.lineMovement ?? null;
  const injuries = explain?.injuries ?? null;
  const weather = explain?.weather ?? null;
  const situational = explain?.situational ?? null;
  const pace = explain?.pace ?? null;

  // Has extra details to show?
  const hasDetails = (lineMovement && lineMovement.tickCount > 0) ||
                     (injuries && injuries.keyInjuries.length > 0) ||
                     (weather && weather.severity !== 'none') ||
                     situational || pace ||
                     warnings.length > 0;

  // Tier colors
  const tierConfig: Record<string, { bg: string; text: string; border: string }> = {
    'very-high': { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    'high': { bg: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/30' },
    'medium': { bg: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/30' },
    'low': { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    'skip': { bg: 'bg-zinc-500', text: 'text-zinc-400', border: 'border-zinc-500/30' },
  };
  const tierStyle = tierConfig[tier] || tierConfig.skip;

  // Sharp book indicator
  const isSharpBook = ['pinnacle', 'lowvig'].includes(bookKey);

  return (
    <div className={`
      relative rounded-lg overflow-hidden transition-all duration-200
      ${qualifies
        ? 'bg-gradient-to-br from-emerald-950/50 to-zinc-900 border border-emerald-500/40 shadow-lg shadow-emerald-500/10'
        : 'bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700'
      }
    `}>
      {/* Compact Header */}
      <div className="p-3 pb-2">
        {/* Top row: Teams + Time */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <Link
            href={`/events/${event.id}`}
            className="flex-1 min-w-0 group"
          >
            <div className="font-semibold text-zinc-100 text-sm truncate group-hover:text-blue-400 transition-colors">
              {event.away_team_abbrev || event.away_team_name?.split(' ').pop()} @ {event.home_team_abbrev || event.home_team_name?.split(' ').pop()}
            </div>
            <div className="text-[11px] text-zinc-500">
              {format(commenceTime, 'EEE h:mma')} · {timeUntil}
            </div>
          </Link>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${tierStyle.bg} text-white`}>
              {tier === 'very-high' ? 'A+' : tier === 'high' ? 'A' : tier === 'medium' ? 'B' : tier === 'low' ? 'C' : 'D'}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              edge.market_type === 'spread'
                ? 'bg-violet-500/20 text-violet-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}>
              {edge.market_type === 'spread' ? 'SPR' : 'TOT'}
            </span>
          </div>
        </div>

        {/* Main Content: Edge + Bet */}
        <div className="flex items-center gap-3 mb-2">
          {/* Edge Value */}
          <div className={`text-2xl font-black tracking-tight ${
            qualifies ? 'text-emerald-400' : tierStyle.text
          }`}>
            {edge.edge_points > 0 ? '+' : ''}{edge.edge_points.toFixed(1)}
          </div>

          {/* Recommended Bet */}
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-500 mb-0.5">Bet</div>
            <div className="font-semibold text-zinc-100 text-sm truncate">
              {edge.recommended_bet_label}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-4 text-xs">
          {/* Win Prob */}
          <div>
            <span className="text-zinc-500">Win </span>
            <span className={winProb && winProb >= 55 ? 'text-green-400 font-semibold' : 'text-zinc-300'}>
              {winProb !== null ? `${winProb}%` : '—'}
            </span>
          </div>

          {/* EV */}
          <div>
            <span className="text-zinc-500">EV </span>
            <span className={ev && ev > 0 ? 'text-green-400 font-semibold' : ev && ev < 0 ? 'text-red-400' : 'text-zinc-300'}>
              {ev !== null ? `${ev > 0 ? '+' : ''}$${ev.toFixed(0)}` : '—'}
            </span>
          </div>

          {/* Book */}
          <div className="ml-auto flex items-center gap-1">
            {isSharpBook && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">
                SHARP
              </span>
            )}
            <span className="text-zinc-400">{bookName}</span>
          </div>
        </div>

        {/* Line Movement Indicator (compact) */}
        {lineMovement && lineMovement.sharpSignal !== 'neutral' && (
          <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${
            lineMovement.alignsWithBet ? 'text-green-400' : 'text-amber-400'
          }`}>
            <span className="font-medium">
              {lineMovement.alignsWithBet ? '✓' : '⚠'} Sharp money {lineMovement.sharpSignal}
            </span>
            <span className="text-zinc-500">
              {lineMovement.opening} → {lineMovement.current}
            </span>
          </div>
        )}
      </div>

      {/* Expandable Details */}
      {hasDetails && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-1.5 flex items-center justify-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors border-t border-zinc-800"
          >
            <span>{expanded ? 'Hide' : 'Show'} details</span>
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {warnings.length > 0 && !expanded && (
              <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-medium">
                {warnings.length}
              </span>
            )}
          </button>

          {expanded && (
            <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 bg-zinc-950/50">
              {/* Market vs Model */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Market</div>
                  <div className="text-sm font-medium text-zinc-200">
                    {edge.market_type === 'spread'
                      ? formatSpread(edge.market_spread_home || 0)
                      : edge.market_total_points
                    }
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Model</div>
                  <div className="text-sm font-medium text-zinc-200">
                    {edge.market_type === 'spread'
                      ? formatSpread(edge.model_spread_home || 0)
                      : edge.model_total_points
                    }
                  </div>
                </div>
              </div>

              {/* Line Movement Details */}
              {lineMovement && lineMovement.tickCount > 0 && (
                <div className="py-2 border-t border-zinc-800/50">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Line Movement</div>
                  <div className="text-xs text-zinc-300">
                    <span className="font-mono">{lineMovement.opening} → {lineMovement.current}</span>
                    <span className="text-zinc-500 ml-2">({lineMovement.tickCount} updates)</span>
                  </div>
                  {lineMovement.sharpSignal !== 'neutral' && (
                    <div className={`text-xs mt-1 ${lineMovement.alignsWithBet ? 'text-green-400' : 'text-amber-400'}`}>
                      {lineMovement.sharpDescription}
                    </div>
                  )}
                </div>
              )}

              {/* Situational Factors */}
              {situational && situational.netAdjustment !== 0 && (
                <div className="py-2 border-t border-zinc-800/50">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Situational</div>
                  <div className="text-xs text-zinc-300">
                    Adjustment: <span className={situational.netAdjustment > 0 ? 'text-green-400' : 'text-red-400'}>
                      {situational.netAdjustment > 0 ? '+' : ''}{situational.netAdjustment.toFixed(1)} pts
                    </span>
                  </div>
                </div>
              )}

              {/* Pace */}
              {pace && pace.effectiveAdjustment !== 0 && (
                <div className="py-2 border-t border-zinc-800/50">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Pace</div>
                  <div className="text-xs text-zinc-300">
                    Total adjustment: <span className={pace.effectiveAdjustment > 0 ? 'text-green-400' : 'text-red-400'}>
                      {pace.effectiveAdjustment > 0 ? '+' : ''}{pace.effectiveAdjustment.toFixed(1)} pts
                    </span>
                  </div>
                </div>
              )}

              {/* Weather */}
              {weather && weather.severity !== 'none' && (
                <div className="py-2 border-t border-zinc-800/50">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
                    Weather <span className="text-blue-400">({weather.severity})</span>
                  </div>
                  <div className="text-xs text-zinc-300 space-y-0.5">
                    {weather.factors.slice(0, 2).map((f, i) => (
                      <div key={i}>{f}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Injuries */}
              {injuries && injuries.keyInjuries.length > 0 && (
                <div className="py-2 border-t border-zinc-800/50">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
                    Injuries <span className="text-red-400">({injuries.adjustment > 0 ? '+' : ''}{injuries.adjustment})</span>
                  </div>
                  <div className="text-xs text-zinc-300 space-y-0.5">
                    {injuries.keyInjuries.slice(0, 3).map((inj, i) => (
                      <div key={i} className="truncate">{inj}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="py-2 border-t border-zinc-800/50">
                  <div className="text-[10px] text-amber-400 uppercase tracking-wide mb-1">Warnings</div>
                  <div className="text-xs text-amber-300/80 space-y-0.5">
                    {warnings.map((w, i) => (
                      <div key={i}>{w}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamp */}
              <div className="pt-2 border-t border-zinc-800/50 text-[10px] text-zinc-600">
                Updated {format(new Date(edge.as_of), 'MMM d, h:mm a')}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatSpread(points: number): string {
  if (points > 0) return `+${points}`;
  return points.toString();
}
