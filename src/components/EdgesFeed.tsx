'use client';

import { useState } from 'react';
import { EdgeWithDetails } from '@/types/database';
import { format, formatDistanceToNow } from 'date-fns';
import { getTeamLogo } from '@/lib/team-logos';

interface EdgesFeedProps {
  edges: EdgeWithDetails[];
}

// Group edges by event
interface GameGroup {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbrev: string | null;
  awayAbbrev: string | null;
  commenceTime: Date;
  spreadEdges: EdgeWithDetails[];
  totalEdges: EdgeWithDetails[];
  bestSpreadEdge: EdgeWithDetails | null;
  bestTotalEdge: EdgeWithDetails | null;
  hasQualifying: boolean;
}

function groupEdgesByGame(edges: EdgeWithDetails[]): GameGroup[] {
  const groups = new Map<string, GameGroup>();

  for (const edge of edges) {
    const eventId = edge.event.id;

    if (!groups.has(eventId)) {
      groups.set(eventId, {
        eventId,
        homeTeam: edge.event.home_team_name,
        awayTeam: edge.event.away_team_name,
        homeAbbrev: edge.event.home_team_abbrev || null,
        awayAbbrev: edge.event.away_team_abbrev || null,
        commenceTime: new Date(edge.event.commence_time),
        spreadEdges: [],
        totalEdges: [],
        bestSpreadEdge: null,
        bestTotalEdge: null,
        hasQualifying: false,
      });
    }

    const group = groups.get(eventId)!;
    const explain = edge.explain as { qualifies?: boolean } | null;

    if (explain?.qualifies) {
      group.hasQualifying = true;
    }

    if (edge.market_type === 'spread') {
      group.spreadEdges.push(edge);
    } else {
      group.totalEdges.push(edge);
    }
  }

  // Find best edge for each market type
  for (const group of groups.values()) {
    const sortEdges = (edges: EdgeWithDetails[]) => {
      return [...edges].sort((a, b) => {
        const aQ = (a.explain as { qualifies?: boolean })?.qualifies ? 1 : 0;
        const bQ = (b.explain as { qualifies?: boolean })?.qualifies ? 1 : 0;
        if (aQ !== bQ) return bQ - aQ;
        return Math.abs(b.edge_points) - Math.abs(a.edge_points);
      });
    };

    const sortedSpreads = sortEdges(group.spreadEdges);
    const sortedTotals = sortEdges(group.totalEdges);

    group.spreadEdges = sortedSpreads;
    group.totalEdges = sortedTotals;
    group.bestSpreadEdge = sortedSpreads[0] || null;
    group.bestTotalEdge = sortedTotals[0] || null;
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.hasQualifying !== b.hasQualifying) return a.hasQualifying ? -1 : 1;
    const aEdge = Math.max(
      Math.abs(a.bestSpreadEdge?.edge_points || 0),
      Math.abs(a.bestTotalEdge?.edge_points || 0)
    );
    const bEdge = Math.max(
      Math.abs(b.bestSpreadEdge?.edge_points || 0),
      Math.abs(b.bestTotalEdge?.edge_points || 0)
    );
    return bEdge - aEdge;
  });
}

export function EdgesFeed({ edges }: EdgesFeedProps) {
  const gameGroups = groupEdgesByGame(edges);
  const qualifyingGames = gameGroups.filter(g => g.hasQualifying);
  const otherGames = gameGroups.filter(g => !g.hasQualifying);

  return (
    <div className="space-y-8">
      {/* Qualifying Games */}
      {qualifyingGames.length > 0 && (
        <section>
          <div className="flex items-center gap-4 mb-5">
            <div className="flex items-center gap-3 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <h2 className="text-sm font-semibold text-emerald-400 tracking-wide">
                Top Rated
              </h2>
              <span className="text-emerald-400/60 text-sm">{qualifyingGames.length}</span>
            </div>
            <p className="text-sm text-zinc-500">Grade A/B bets with edges in profitable range</p>
          </div>
          <div className="space-y-4">
            {qualifyingGames.map(group => (
              <GameCard key={group.eventId} group={group} />
            ))}
          </div>
        </section>
      )}

      {/* Other Games */}
      {otherGames.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-sm font-medium text-zinc-500 px-4 py-2 bg-zinc-800/50 rounded-xl">
              Monitoring <span className="text-zinc-600 ml-1">{otherGames.length}</span>
            </h2>
          </div>
          <div className="space-y-4">
            {otherGames.map(group => (
              <GameCard key={group.eventId} group={group} />
            ))}
          </div>
        </section>
      )}

      {edges.length === 0 && (
        <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800/50 rounded-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800 flex items-center justify-center">
            <span className="text-2xl opacity-50">📭</span>
          </div>
          <p className="text-zinc-500 font-medium">No edges found</p>
        </div>
      )}
    </div>
  );
}

function TeamLogo({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  const logoUrl = getTeamLogo(name);

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-zinc-800 border-2 border-zinc-700 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-lg`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );
}

function GameCard({ group }: { group: GameGroup }) {
  const [expanded, setExpanded] = useState(false);
  const timeUntil = formatDistanceToNow(group.commenceTime, { addSuffix: false });

  return (
    <div className={`
      rounded-2xl border transition-all duration-200 overflow-hidden backdrop-blur-sm
      ${group.hasQualifying
        ? 'bg-gradient-to-br from-zinc-900 to-zinc-900/60 border-emerald-500/30 shadow-lg shadow-emerald-500/5'
        : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700'
      }
    `}>
      {/* Game Header with Logos */}
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          {/* Teams with Logos */}
          <div className="flex items-center gap-5">
            <div className="flex items-center -space-x-3">
              <TeamLogo name={group.awayTeam} size="md" />
              <TeamLogo name={group.homeTeam} size="md" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">
                {group.awayTeam}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-zinc-500">@</span>
                <span className="text-lg text-zinc-300">{group.homeTeam}</span>
              </div>
            </div>
          </div>

          {/* Time Badge */}
          <div className="text-right">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-800/80 border border-zinc-700/50 rounded-lg">
              <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium text-zinc-300">{timeUntil}</span>
            </div>
            <p className="text-xs text-zinc-600 mt-1.5">
              {format(group.commenceTime, 'EEE, MMM d · h:mm a')}
            </p>
          </div>
        </div>

        {/* Best Edges Row */}
        <div className="grid grid-cols-2 gap-4">
          <EdgeSummary
            label="Spread"
            edge={group.bestSpreadEdge}
            allEdges={group.spreadEdges}
            expanded={expanded}
          />
          <EdgeSummary
            label="Total"
            edge={group.bestTotalEdge}
            allEdges={group.totalEdges}
            expanded={expanded}
          />
        </div>
      </div>

      {/* Expand Toggle */}
      {(group.spreadEdges.length > 1 || group.totalEdges.length > 1) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-6 py-3 flex items-center justify-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 border-t border-zinc-800/50 transition-colors bg-zinc-900/30"
        >
          <span>
            {expanded ? 'Hide' : 'Compare'} {group.spreadEdges.length + group.totalEdges.length} books
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Expanded Book Comparison */}
      {expanded && (
        <div className="px-6 pb-5 border-t border-zinc-800/50 bg-zinc-900/20">
          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="space-y-2">
              {group.spreadEdges.map(edge => (
                <BookRow key={edge.id} edge={edge} />
              ))}
            </div>
            <div className="space-y-2">
              {group.totalEdges.map(edge => (
                <BookRow key={edge.id} edge={edge} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeSummary({
  label,
  edge,
  allEdges,
  expanded
}: {
  label: string;
  edge: EdgeWithDetails | null;
  allEdges: EdgeWithDetails[];
  expanded: boolean;
}) {
  if (!edge) {
    return (
      <div className="p-4 rounded-xl bg-zinc-800/30 border border-zinc-800">
        <p className="text-xs text-zinc-600 uppercase tracking-wider font-medium">{label}</p>
        <p className="text-sm text-zinc-600 mt-2">No data</p>
      </div>
    );
  }

  const explain = edge.explain as {
    qualifies?: boolean;
    winProbability?: number;
    expectedValue?: number;
    confidenceTier?: string;
    adjustmentBreakdown?: {
      weather: number;
      pace: number;
      total: number;
    };
    sanityGate?: {
      passed: boolean;
      adjustmentPoints: number;
    };
  } | null;

  const isTotal = edge.market_type === 'total';
  const adjustmentTotal = explain?.adjustmentBreakdown?.total ?? 0;
  const isTotalBaselineOnly = isTotal && Math.abs(adjustmentTotal) < 0.5;

  const qualifies = explain?.qualifies ?? false;
  const winProb = explain?.winProbability;
  const bookName = edge.sportsbook?.name || 'Unknown';
  const bookCount = allEdges.length;

  const grade = getBetGrade(edge.edge_points, winProb, qualifies);

  const isSpread = edge.market_type === 'spread';
  const marketLineDisplay = isSpread
    ? formatSpreadLine(edge.market_spread_home)
    : edge.market_total_points?.toString() ?? 'N/A';
  const modelLineDisplay = isSpread
    ? formatSpreadLine(edge.model_spread_home)
    : edge.model_total_points?.toString() ?? 'N/A';

  let actionText = '';

  if (isSpread) {
    const homeSpread = edge.market_spread_home || 0;
    const awaySpread = -homeSpread;

    if (edge.edge_points > 0) {
      const spreadStr = homeSpread > 0 ? `+${homeSpread}` : homeSpread === 0 ? 'PK' : `${homeSpread}`;
      actionText = `${edge.event?.home_team_name || 'Home'} ${spreadStr}`;
    } else {
      const spreadStr = awaySpread > 0 ? `+${awaySpread}` : awaySpread === 0 ? 'PK' : `${awaySpread}`;
      actionText = `${edge.event?.away_team_name || 'Away'} ${spreadStr}`;
    }
  } else {
    const total = edge.market_total_points || 0;
    if (edge.edge_points > 0) {
      actionText = `UNDER ${total}`;
    } else {
      actionText = `OVER ${total}`;
    }
  }

  return (
    <div className={`p-4 rounded-xl border transition-colors ${grade.bgClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">{label}</p>
          {isTotalBaselineOnly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-medium">
              BASE
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${grade.bgClass} ${grade.colorClass}`}>
          <span>{grade.grade}</span>
        </div>
      </div>

      {/* The Bet */}
      <div className="mb-4">
        <p className={`text-lg font-bold ${grade.colorClass}`}>
          {actionText}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-zinc-500">{bookName}</span>
          {edge.market_price_american && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
              edge.market_price_american > 0
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-zinc-700 text-zinc-300'
            }`}>
              {edge.market_price_american > 0 ? '+' : ''}{edge.market_price_american}
            </span>
          )}
        </div>
      </div>

      {/* Model Comparison */}
      <div className="bg-zinc-800/50 rounded-lg p-3 mb-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-zinc-600 uppercase">Market</p>
            <p className="text-sm font-medium text-zinc-400">{marketLineDisplay}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-600 uppercase">Model</p>
            <p className="text-sm font-bold text-white">{modelLineDisplay}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-600 uppercase">Edge</p>
            <p className={`text-sm font-bold ${grade.colorClass}`}>
              {Math.abs(edge.edge_points).toFixed(1)}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-600">{grade.label}</span>
        {bookCount > 1 && !expanded && (
          <span className="text-zinc-600">+{bookCount - 1} books</span>
        )}
      </div>
    </div>
  );
}

function BookRow({ edge }: { edge: EdgeWithDetails }) {
  const explain = edge.explain as {
    qualifies?: boolean;
    lineMovement?: {
      sharpSignal: string;
      alignsWithBet: boolean;
    } | null;
  } | null;

  const qualifies = explain?.qualifies ?? false;
  const bookName = edge.sportsbook?.name || 'Unknown';
  const bookKey = edge.sportsbook?.key || '';
  const isSharp = ['pinnacle', 'lowvig'].includes(bookKey);
  const lineMovement = explain?.lineMovement;
  const hasSharpSignal = lineMovement && lineMovement.sharpSignal !== 'neutral';

  return (
    <div className={`
      flex items-center justify-between py-2.5 px-3 rounded-lg text-sm
      ${qualifies ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-zinc-800/30'}
    `}>
      <div className="flex items-center gap-2">
        <span className="text-zinc-300 font-medium">{bookName}</span>
        {isSharp && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
            SHARP
          </span>
        )}
        {hasSharpSignal && (
          <span className={`text-[10px] ${lineMovement.alignsWithBet ? 'text-emerald-400' : 'text-amber-400'}`}>
            {lineMovement.alignsWithBet ? '✓' : '⚠'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-zinc-500 text-xs font-mono">
          {edge.market_type === 'spread'
            ? formatSpread(edge.market_spread_home || 0)
            : edge.market_total_points
          }
        </span>
        <span className={`font-bold tabular-nums ${
          qualifies ? 'text-emerald-400' : 'text-zinc-300'
        }`}>
          {edge.edge_points > 0 ? '+' : ''}{edge.edge_points.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function formatSpread(points: number): string {
  if (points === 0) return 'PK';
  if (points > 0) return `+${points}`;
  return points.toString();
}

function formatSpreadLine(points: number | null | undefined): string {
  if (points === null || points === undefined) return 'N/A';
  if (points === 0) return 'PK';
  if (points > 0) return `+${points}`;
  return points.toString();
}

interface BetGrade {
  grade: 'A' | 'B' | 'C' | 'D';
  label: string;
  reason: string;
  colorClass: string;
  bgClass: string;
}

function getBetGrade(edgePoints: number, winProb?: number, qualifies?: boolean): BetGrade {
  const absEdge = Math.abs(edgePoints);

  if (qualifies && absEdge >= 2.5 && absEdge <= 5 && (winProb ?? 0) >= 54) {
    return {
      grade: 'A',
      label: 'Strong',
      reason: `${absEdge.toFixed(1)} pt edge in optimal range`,
      colorClass: 'text-emerald-400',
      bgClass: 'bg-emerald-500/15 border-emerald-500/30',
    };
  }

  if (absEdge >= 2 && absEdge <= 6 && (winProb ?? 0) >= 52) {
    return {
      grade: 'B',
      label: 'Good',
      reason: `${absEdge.toFixed(1)} pt edge`,
      colorClass: 'text-blue-400',
      bgClass: 'bg-blue-500/15 border-blue-500/30',
    };
  }

  if (absEdge >= 1.5 && absEdge <= 8) {
    return {
      grade: 'C',
      label: 'Marginal',
      reason: `${absEdge.toFixed(1)} pt edge`,
      colorClass: 'text-amber-400',
      bgClass: 'bg-amber-500/15 border-amber-500/30',
    };
  }

  return {
    grade: 'D',
    label: 'Monitor',
    reason: absEdge < 1.5 ? 'Edge too small' : 'Edge too large',
    colorClass: 'text-zinc-400',
    bgClass: 'bg-zinc-800/50 border-zinc-700/50',
  };
}
