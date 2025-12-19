'use client';

import { useState } from 'react';
import { EdgeWithDetails } from '@/types/database';
import { format, formatDistanceToNow } from 'date-fns';

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

  // Find best edge for each market type (highest absolute edge that qualifies, or just highest)
  for (const group of groups.values()) {
    // Sort by qualifying first, then by absolute edge
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

  // Sort groups: qualifying first, then by best edge
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
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <h2 className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Top Rated ({qualifyingGames.length})
              </h2>
            </div>
            <p className="text-xs text-zinc-500">Grade A/B bets with edges in profitable range</p>
          </div>
          <div className="space-y-3">
            {qualifyingGames.map(group => (
              <GameCard key={group.eventId} group={group} />
            ))}
          </div>
        </section>
      )}

      {/* Other Games */}
      {otherGames.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-4">
            Monitoring ({otherGames.length})
          </h2>
          <div className="space-y-3">
            {otherGames.map(group => (
              <GameCard key={group.eventId} group={group} />
            ))}
          </div>
        </section>
      )}

      {edges.length === 0 && (
        <div className="text-center py-16">
          <p className="text-zinc-400">No edges found</p>
        </div>
      )}
    </div>
  );
}

function GameCard({ group }: { group: GameGroup }) {
  const [expanded, setExpanded] = useState(false);
  const timeUntil = formatDistanceToNow(group.commenceTime, { addSuffix: false });

  // Use full team names
  const away = group.awayTeam;
  const home = group.homeTeam;

  return (
    <div className={`
      rounded-xl border transition-all duration-200
      ${group.hasQualifying
        ? 'bg-zinc-900 border-emerald-500/30'
        : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
      }
    `}>
      {/* Game Header */}
      <div className="px-5 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-xl font-semibold text-zinc-100">
              {away} <span className="text-zinc-500 font-normal">@</span> {home}
            </h3>
            <p className="text-base text-zinc-500 mt-1">
              {format(group.commenceTime, 'EEE, MMM d · h:mm a')} <span className="text-zinc-600">·</span> {timeUntil}
            </p>
          </div>
        </div>

        {/* Best Edges Row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Spread */}
          <EdgeSummary
            label="Spread"
            edge={group.bestSpreadEdge}
            allEdges={group.spreadEdges}
            expanded={expanded}
          />

          {/* Total */}
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
          className="w-full px-5 py-2.5 flex items-center justify-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 border-t border-zinc-800/50 transition-colors"
        >
          <span>
            {expanded ? 'Hide' : 'Compare'} {group.spreadEdges.length + group.totalEdges.length} books
          </span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
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
        <div className="px-5 pb-4 border-t border-zinc-800/50">
          <div className="grid grid-cols-2 gap-4 pt-4">
            {/* All Spread Books */}
            <div className="space-y-2">
              {group.spreadEdges.map(edge => (
                <BookRow key={edge.id} edge={edge} />
              ))}
            </div>

            {/* All Total Books */}
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
      <div className="p-4 rounded-lg bg-zinc-800/30 border border-zinc-800">
        <p className="text-xs text-zinc-600 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-zinc-600 mt-2">No data</p>
      </div>
    );
  }

  const explain = edge.explain as {
    qualifies?: boolean;
    winProbability?: number;
    expectedValue?: number;
    confidenceTier?: string;
  } | null;

  const qualifies = explain?.qualifies ?? false;
  const winProb = explain?.winProbability;
  const ev = explain?.expectedValue;
  const bookName = edge.sportsbook?.name || 'Unknown';
  const bookCount = allEdges.length;

  // Get bet grade
  const grade = getBetGrade(edge.edge_points, winProb, qualifies);

  // Determine the action and numbers
  const isSpread = edge.market_type === 'spread';
  const marketLineDisplay = isSpread
    ? formatSpreadLine(edge.market_spread_home)
    : edge.market_total_points?.toString() ?? 'N/A';
  const modelLineDisplay = isSpread
    ? formatSpreadLine(edge.model_spread_home)
    : edge.model_total_points?.toString() ?? 'N/A';

  // Clear action text with the actual line
  let actionText = '';
  let actionDetail = '';

  if (isSpread) {
    const homeSpread = edge.market_spread_home || 0;
    const awaySpread = -homeSpread;

    if (edge.edge_points > 0) {
      // Bet home team
      const spreadStr = homeSpread > 0 ? `+${homeSpread}` : homeSpread === 0 ? 'PK' : `${homeSpread}`;
      actionText = `Take ${edge.event?.home_team_name || 'Home'} ${spreadStr}`;
    } else {
      // Bet away team
      const spreadStr = awaySpread > 0 ? `+${awaySpread}` : awaySpread === 0 ? 'PK' : `${awaySpread}`;
      actionText = `Take ${edge.event?.away_team_name || 'Away'} ${spreadStr}`;
    }
    actionDetail = `on ${bookName}`;
  } else {
    const total = edge.market_total_points || 0;
    if (edge.edge_points > 0) {
      actionText = `Take UNDER ${total}`;
    } else {
      actionText = `Take OVER ${total}`;
    }
    actionDetail = `on ${bookName}`;
  }

  return (
    <div className={`
      p-4 rounded-lg border transition-colors
      ${grade.bgClass}
    `}>
      {/* Header with label and grade */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-500 uppercase tracking-widest">{label}</p>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-bold ${grade.bgClass} ${grade.colorClass}`}>
          <span>{grade.grade}</span>
          <span className="font-medium opacity-80">{grade.label}</span>
        </div>
      </div>

      {/* THE BET - Explicit action with the number */}
      <div className="mb-5">
        <p className={`text-xl font-bold ${grade.colorClass}`}>
          {actionText}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-base text-zinc-400">{bookName}</span>
          {edge.market_price_american && (
            <span className={`text-base font-semibold px-2.5 py-1 rounded ${
              edge.market_price_american > 0
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-zinc-700 text-zinc-300'
            }`}>
              {edge.market_price_american > 0 ? '+' : ''}{edge.market_price_american}
            </span>
          )}
        </div>
      </div>

      {/* Why - Model comparison */}
      <div className="bg-zinc-800/50 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-zinc-500">Market line</span>
          <span className="text-base font-medium text-zinc-300">{marketLineDisplay}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-zinc-500">Our model</span>
          <span className="text-base font-bold text-white">{modelLineDisplay}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-zinc-500">Edge</span>
          <span className={`text-base font-bold ${grade.colorClass}`}>
            {Math.abs(edge.edge_points).toFixed(1)} pts
          </span>
        </div>
        {edge.market_price_american && (
          <div className="flex justify-between items-center pt-2 border-t border-zinc-700/50">
            <span className="text-sm text-zinc-500">$100 bet wins</span>
            <span className="text-base font-medium text-amber-400">
              ${calculatePayout(edge.market_price_american)}
            </span>
          </div>
        )}
      </div>

      {/* Footer - Grade explanation */}
      <div className="flex items-start justify-between gap-2 text-sm">
        <span className="text-zinc-500">{grade.reason}</span>
        {bookCount > 1 && !expanded && (
          <span className="text-zinc-600 whitespace-nowrap">+{bookCount - 1} books</span>
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
      flex items-center justify-between py-2 px-3 rounded-lg text-sm
      ${qualifies ? 'bg-emerald-500/5' : 'bg-zinc-800/20'}
    `}>
      <div className="flex items-center gap-2">
        <span className="text-zinc-300">{bookName}</span>
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
        <span className="text-zinc-400 text-xs">
          {edge.market_type === 'spread'
            ? formatSpread(edge.market_spread_home || 0)
            : edge.market_total_points
          }
        </span>
        <span className={`font-medium tabular-nums ${
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

function calculatePayout(americanOdds: number): string {
  // Calculate profit on a $100 bet
  if (americanOdds > 0) {
    // Positive odds: +150 means win $150 on $100 bet
    return americanOdds.toFixed(0);
  } else {
    // Negative odds: -110 means bet $110 to win $100, so $100 bet wins $90.91
    const payout = (100 / Math.abs(americanOdds)) * 100;
    return payout.toFixed(0);
  }
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

  // Grade A: Sweet spot - historically profitable range with good win probability
  if (qualifies && absEdge >= 2.5 && absEdge <= 5 && (winProb ?? 0) >= 54) {
    return {
      grade: 'A',
      label: 'Strong',
      reason: `${absEdge.toFixed(1)} pt edge in optimal range, ${winProb}% win rate`,
      colorClass: 'text-emerald-400',
      bgClass: 'bg-emerald-500/20 border-emerald-500/30',
    };
  }

  // Grade B: Good edge, slightly outside optimal or lower win prob
  if (absEdge >= 2 && absEdge <= 6 && (winProb ?? 0) >= 52) {
    return {
      grade: 'B',
      label: 'Good',
      reason: absEdge > 5
        ? `Large ${absEdge.toFixed(1)} pt edge, verify line accuracy`
        : `${absEdge.toFixed(1)} pt edge, ${winProb ?? 'N/A'}% win rate`,
      colorClass: 'text-blue-400',
      bgClass: 'bg-blue-500/20 border-blue-500/30',
    };
  }

  // Grade C: Marginal - small edge or very large edge (model uncertainty)
  if (absEdge >= 1.5 && absEdge <= 8) {
    return {
      grade: 'C',
      label: 'Marginal',
      reason: absEdge < 2.5
        ? `Small ${absEdge.toFixed(1)} pt edge, thin margin`
        : `${absEdge.toFixed(1)} pt edge, high variance`,
      colorClass: 'text-amber-400',
      bgClass: 'bg-amber-500/20 border-amber-500/30',
    };
  }

  // Grade D: Monitor - edge too small or suspiciously large
  return {
    grade: 'D',
    label: 'Monitor',
    reason: absEdge < 1.5
      ? `${absEdge.toFixed(1)} pt edge too small for value`
      : `${absEdge.toFixed(1)} pt edge suspiciously large`,
    colorClass: 'text-zinc-400',
    bgClass: 'bg-zinc-700/50 border-zinc-600/30',
  };
}
