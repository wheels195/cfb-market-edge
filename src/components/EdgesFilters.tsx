'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

interface EdgesFiltersProps {
  currentFilter: {
    sportsbookKey?: string;
    marketType?: 'spread' | 'total';
    minEdge?: number;
    hoursAhead?: number;
  };
}

export function EdgesFilters({ currentFilter }: EdgesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`/edges?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex flex-wrap gap-4">
        {/* Sportsbook Filter */}
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            Sportsbook
          </label>
          <select
            value={currentFilter.sportsbookKey || ''}
            onChange={(e) => updateFilter('book', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="">All Books</option>
            <option value="draftkings">DraftKings</option>
            <option value="fanduel">FanDuel</option>
          </select>
        </div>

        {/* Market Type Filter */}
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            Market Type
          </label>
          <select
            value={currentFilter.marketType || ''}
            onChange={(e) => updateFilter('market', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="">All Markets</option>
            <option value="spread">Spreads</option>
            <option value="total">Totals</option>
          </select>
        </div>

        {/* Min Edge Filter */}
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            Minimum Edge (points)
          </label>
          <select
            value={currentFilter.minEdge?.toString() || ''}
            onChange={(e) => updateFilter('minEdge', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="">Any Edge</option>
            <option value="0.5">0.5+</option>
            <option value="1">1+</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
            <option value="5">5+</option>
          </select>
        </div>

        {/* Time Window Filter */}
        <div className="flex-1 min-w-[150px]">
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            Time Window
          </label>
          <select
            value={currentFilter.hoursAhead?.toString() || '72'}
            onChange={(e) => updateFilter('hours', e.target.value)}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="24">Next 24 hours</option>
            <option value="48">Next 48 hours</option>
            <option value="72">Next 72 hours</option>
            <option value="168">Next 7 days</option>
          </select>
        </div>
      </div>
    </div>
  );
}
