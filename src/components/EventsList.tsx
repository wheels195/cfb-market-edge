'use client';

import Link from 'next/link';
import { EventWithTeams } from '@/types/database';
import { useMemo } from 'react';

interface EventsListProps {
  events: EventWithTeams[];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatTimeUntil(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'Started';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `in ${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }
  return `in ${minutes}m`;
}

function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function EventsList({ events }: EventsListProps) {
  // Group events by local date
  const eventsByDate = useMemo(() => {
    return events.reduce((acc, event) => {
      const localDate = new Date(event.commence_time);
      const dateKey = getLocalDateKey(localDate);
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(event);
      return acc;
    }, {} as Record<string, EventWithTeams[]>);
  }, [events]);

  return (
    <div className="space-y-6">
      {Object.entries(eventsByDate).map(([dateKey, dayEvents]) => {
        const sampleDate = new Date(dayEvents[0].commence_time);
        return (
          <div key={dateKey}>
            <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              {formatDate(sampleDate)}
            </h2>
            <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {dayEvents.map((event, idx) => (
                <EventRow
                  key={event.id}
                  event={event}
                  showBorder={idx < dayEvents.length - 1}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface EventRowProps {
  event: EventWithTeams;
  showBorder: boolean;
}

function EventRow({ event, showBorder }: EventRowProps) {
  const commenceTime = new Date(event.commence_time);
  const timeStr = formatTime(commenceTime);
  const timeUntil = formatTimeUntil(commenceTime);

  return (
    <Link
      href={`/events/${event.id}`}
      className={`block hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
        showBorder ? 'border-b border-zinc-100 dark:border-zinc-800' : ''
      }`}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-16 text-center">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {timeStr}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-500">
              {timeUntil}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {event.away_team_name}
            </div>
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              @ {event.home_team_name}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <StatusBadge status={event.status} />
          <svg
            className="w-5 h-5 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    final: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    postponed: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.scheduled}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
}
