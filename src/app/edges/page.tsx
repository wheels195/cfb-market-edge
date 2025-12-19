import { getEdgesWithDetails } from '@/lib/db/queries-edges';
import { EdgesFeed } from '@/components/EdgesFeed';
import { EdgesFilters } from '@/components/EdgesFilters';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

interface PageProps {
  searchParams: Promise<{
    book?: string;
    market?: string;
    minEdge?: string;
    hours?: string;
  }>;
}

export default async function EdgesPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const filter = {
    sportsbookKey: params.book,
    marketType: params.market as 'spread' | 'total' | undefined,
    minEdge: params.minEdge ? parseFloat(params.minEdge) : undefined,
    hoursAhead: params.hours ? parseInt(params.hours, 10) : 72,
  };

  let edges: Awaited<ReturnType<typeof getEdgesWithDetails>> = [];
  let error: string | null = null;

  try {
    edges = await getEdgesWithDetails(filter);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load edges';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Edges Feed
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Top edges for upcoming games based on model projections vs market lines
        </p>
        <div className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Data sources: Elo ratings, SP+, PPA metrics, weather, returning production, injuries, and line movement.
          <span className="text-green-500 dark:text-green-400 ml-1">
            Sharp money detection active.
          </span>
        </div>
      </div>

      <EdgesFilters currentFilter={filter} />

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">
            Error loading edges: {error}
          </p>
        </div>
      ) : edges.length === 0 ? (
        <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            No edges found matching your filters.
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-2">
            Try adjusting the filters or run the model and edge materialization jobs.
          </p>
        </div>
      ) : (
        <EdgesFeed edges={edges} />
      )}
    </div>
  );
}
