'use client';

import { useState, useEffect } from 'react';

interface EdgeBucket {
  range: string;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
}

interface StatsSection {
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  roi: number;
  profitUnits: number;
  edgeBuckets: EdgeBucket[];
}

interface StrategyStats {
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winRate: number;
  roi: number;
  backtest: { winRate: number; roi: number };
}

interface CFBData {
  sport: 'cfb';
  qualifying: StatsSection;
  all: StatsSection;
  backtest: { winRate: number; roi: number; totalBets: number };
  vsBacktest: 'above' | 'below' | 'equal';
  vsBacktestSignificant: boolean;
  vsBreakevenPValue: number;
  sampleSizeAdequate: boolean;
  lastUpdated: string;
}

interface CBBData {
  sport: 'cbb';
  qualifying: StatsSection;
  all: StatsSection;
  strategies: {
    favorites: StrategyStats;
    underdogs: StrategyStats;
  };
  backtest: { winRate: number; roi: number; totalBets: number };
  vsBacktest: 'above' | 'below' | 'equal';
  vsBreakevenPValue: number;
  sampleSizeAdequate: boolean;
  lastUpdated: string;
}

interface ReportsData {
  cfb: CFBData | null;
  cbb: CBBData | null;
  generatedAt: string;
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function formatROI(value: number): string {
  const pct = (value * 100).toFixed(1);
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

function StatCard({
  label,
  value,
  subtext,
  positive,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  positive?: boolean | null;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-4">
      <div className="text-sm text-zinc-400 mb-1">{label}</div>
      <div
        className={`text-2xl font-bold ${
          positive === true
            ? 'text-emerald-400'
            : positive === false
            ? 'text-red-400'
            : 'text-white'
        }`}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-xs text-zinc-500 mt-1">{subtext}</div>
      )}
    </div>
  );
}

function EdgeBucketTable({ buckets, title }: { buckets: EdgeBucket[]; title: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-zinc-300 mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-700">
              <th className="pb-2">Edge Range</th>
              <th className="pb-2">Record</th>
              <th className="pb-2">Win%</th>
              <th className="pb-2">ROI</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const total = bucket.wins + bucket.losses;
              if (total === 0) return null;
              const isPositive = bucket.roi > 0;

              return (
                <tr key={bucket.range} className="border-b border-zinc-800">
                  <td className="py-2 text-white">{bucket.range} pts</td>
                  <td className="py-2 text-zinc-300">
                    {bucket.wins}-{bucket.losses}
                    {bucket.pushes > 0 && <span className="text-zinc-500">-{bucket.pushes}</span>}
                  </td>
                  <td className="py-2 text-zinc-300">{formatPercent(bucket.winRate)}</td>
                  <td className={`py-2 font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatROI(bucket.roi)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CFBReport({ data }: { data: CFBData | null }) {
  if (!data) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h2 className="text-xl font-bold text-white mb-4">CFB Model</h2>
        <div className="text-zinc-400">No CFB data available.</div>
      </div>
    );
  }

  const { qualifying, all, backtest, vsBacktest, sampleSizeAdequate } = data;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">CFB Model (T-60 Ensemble)</h2>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${sampleSizeAdequate ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-xs text-zinc-400">
            {sampleSizeAdequate ? 'Sample size adequate' : `Need ${50 - qualifying.total} more bets`}
          </span>
        </div>
      </div>

      {/* Qualifying Bets Section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Qualifying Bets</span>
          <span className="text-xs text-zinc-500">(2.5-5 pt edge)</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Record"
            value={`${qualifying.wins}-${qualifying.losses}${qualifying.pushes > 0 ? `-${qualifying.pushes}` : ''}`}
          />
          <StatCard
            label="Win Rate"
            value={formatPercent(qualifying.winRate)}
            subtext={`Backtest: ${formatPercent(backtest.winRate)}`}
            positive={qualifying.winRate > 0.524}
          />
          <StatCard
            label="ROI"
            value={formatROI(qualifying.roi)}
            subtext={`Backtest: ${formatROI(backtest.roi)}`}
            positive={qualifying.roi > 0}
          />
          <StatCard
            label="Profit"
            value={`${qualifying.profitUnits >= 0 ? '+' : ''}${qualifying.profitUnits.toFixed(1)}u`}
            positive={qualifying.profitUnits > 0}
          />
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            vsBacktest === 'above'
              ? 'bg-emerald-500/20 text-emerald-400'
              : vsBacktest === 'below'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-zinc-700 text-zinc-300'
          }`}>
            {vsBacktest === 'above' ? 'Above' : vsBacktest === 'below' ? 'Below' : 'Equal'} Backtest
          </span>
        </div>

        <EdgeBucketTable buckets={qualifying.edgeBuckets} title="Edge Bucket Performance" />
      </div>

      {/* All Predictions Section */}
      <div className="border-t border-zinc-800 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-bold text-zinc-400 uppercase tracking-wider">All Predictions</span>
          <span className="text-xs text-zinc-500">(for model analysis)</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total" value={all.total} />
          <StatCard
            label="Record"
            value={`${all.wins}-${all.losses}${all.pushes > 0 ? `-${all.pushes}` : ''}`}
          />
          <StatCard
            label="Win Rate"
            value={formatPercent(all.winRate)}
            positive={all.winRate > 0.524}
          />
          <StatCard
            label="ROI"
            value={formatROI(all.roi)}
            positive={all.roi > 0}
          />
        </div>

        <EdgeBucketTable buckets={all.edgeBuckets} title="All Edge Buckets (Analysis)" />
      </div>
    </div>
  );
}

function CBBReport({ data }: { data: CBBData | null }) {
  if (!data) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
        <h2 className="text-xl font-bold text-white mb-4">CBB Model</h2>
        <div className="text-zinc-400">No CBB data available.</div>
      </div>
    );
  }

  const { qualifying, all, strategies, backtest, vsBacktest, sampleSizeAdequate } = data;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">CBB Model (Conf-Aware Rating)</h2>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${sampleSizeAdequate ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-xs text-zinc-400">
            {sampleSizeAdequate ? 'Sample size adequate' : `Need ${100 - qualifying.total} more bets`}
          </span>
        </div>
      </div>

      {/* Qualifying Bets Section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Qualifying Bets</span>
          <span className="text-xs text-zinc-500">(FAV/DOG strategy)</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Record"
            value={`${qualifying.wins}-${qualifying.losses}${qualifying.pushes > 0 ? `-${qualifying.pushes}` : ''}`}
          />
          <StatCard
            label="Win Rate"
            value={formatPercent(qualifying.winRate)}
            subtext={`Backtest: ${formatPercent(backtest.winRate)}`}
            positive={qualifying.winRate > 0.524}
          />
          <StatCard
            label="ROI"
            value={formatROI(qualifying.roi)}
            subtext={`Backtest: ${formatROI(backtest.roi)}`}
            positive={qualifying.roi > 0}
          />
          <StatCard
            label="Profit"
            value={`${qualifying.profitUnits >= 0 ? '+' : ''}${qualifying.profitUnits.toFixed(1)}u`}
            positive={qualifying.profitUnits > 0}
          />
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            vsBacktest === 'above'
              ? 'bg-emerald-500/20 text-emerald-400'
              : vsBacktest === 'below'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-zinc-700 text-zinc-300'
          }`}>
            {vsBacktest === 'above' ? 'Above' : vsBacktest === 'below' ? 'Below' : 'Equal'} Backtest
          </span>
        </div>

        {/* Strategy Breakdown */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">FAV</span>
              <span className="text-white font-medium">Favorites</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-zinc-500">Record</div>
                <div className="text-white font-medium">{strategies.favorites.wins}-{strategies.favorites.losses}</div>
              </div>
              <div>
                <div className="text-zinc-500">Win%</div>
                <div className={`font-medium ${strategies.favorites.winRate > 0.524 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                  {formatPercent(strategies.favorites.winRate)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">ROI</div>
                <div className={`font-medium ${strategies.favorites.roi > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatROI(strategies.favorites.roi)}
                </div>
              </div>
            </div>
            <div className="text-xs text-zinc-500 mt-2">
              Backtest: {formatPercent(strategies.favorites.backtest.winRate)} / {formatROI(strategies.favorites.backtest.roi)}
            </div>
          </div>

          <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">DOG</span>
              <span className="text-white font-medium">Underdogs</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-zinc-500">Record</div>
                <div className="text-white font-medium">{strategies.underdogs.wins}-{strategies.underdogs.losses}</div>
              </div>
              <div>
                <div className="text-zinc-500">Win%</div>
                <div className={`font-medium ${strategies.underdogs.winRate > 0.524 ? 'text-amber-400' : 'text-zinc-300'}`}>
                  {formatPercent(strategies.underdogs.winRate)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">ROI</div>
                <div className={`font-medium ${strategies.underdogs.roi > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  {formatROI(strategies.underdogs.roi)}
                </div>
              </div>
            </div>
            <div className="text-xs text-zinc-500 mt-2">
              Backtest: {formatPercent(strategies.underdogs.backtest.winRate)} / {formatROI(strategies.underdogs.backtest.roi)}
            </div>
          </div>
        </div>

        <EdgeBucketTable buckets={qualifying.edgeBuckets} title="Edge Bucket Performance" />
      </div>

      {/* All Predictions Section */}
      <div className="border-t border-zinc-800 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-bold text-zinc-400 uppercase tracking-wider">All Predictions</span>
          <span className="text-xs text-zinc-500">(for model analysis)</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total" value={all.total} />
          <StatCard
            label="Record"
            value={`${all.wins}-${all.losses}${all.pushes > 0 ? `-${all.pushes}` : ''}`}
          />
          <StatCard
            label="Win Rate"
            value={formatPercent(all.winRate)}
            positive={all.winRate > 0.524}
          />
          <StatCard
            label="ROI"
            value={formatROI(all.roi)}
            positive={all.roi > 0}
          />
        </div>

        <EdgeBucketTable buckets={all.edgeBuckets} title="All Edge Buckets (Analysis)" />
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async () => {
    try {
      const res = await fetch('/api/reports');
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch reports');
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  return (
    <div className="min-h-screen bg-[#050505]">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Model Performance
            </h1>
            <p className="text-zinc-400 mt-1">
              Real-time stats from graded predictions
            </p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              fetchReports();
            }}
            disabled={loading}
            className="px-4 py-2 bg-zinc-800 text-white rounded-lg font-medium hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
                Refreshing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </>
            )}
          </button>
        </div>

        {data?.generatedAt && (
          <div className="mb-6 text-sm text-zinc-500">
            Last updated: {new Date(data.generatedAt).toLocaleString()}
          </div>
        )}

        {loading && !data ? (
          <div className="text-center py-12 text-zinc-400">
            <div className="w-10 h-10 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
            Loading reports...
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-400 mb-4">{error}</div>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                fetchReports();
              }}
              className="text-zinc-400 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <CFBReport data={data?.cfb || null} />
            <CBBReport data={data?.cbb || null} />
          </div>
        )}

        {/* Methodology */}
        <div className="mt-8 bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-lg font-bold text-white mb-3">
            Methodology
          </h2>
          <div className="text-sm text-zinc-400 space-y-2">
            <p>
              <strong className="text-zinc-300">Win Rate:</strong> Wins / (Wins + Losses). Pushes excluded. Breakeven at -110 juice is 52.4%.
            </p>
            <p>
              <strong className="text-zinc-300">ROI:</strong> (Wins x 0.91 - Losses) / Total Bets. Accounts for -110 standard juice.
            </p>
            <p>
              <strong className="text-zinc-300">Qualifying Bets:</strong> CFB = 2.5-5 pt edge. CBB = FAV/DOG strategy criteria.
            </p>
            <p>
              <strong className="text-zinc-300">All Predictions:</strong> Every graded prediction for model analysis, regardless of bet criteria.
            </p>
            <p>
              <strong className="text-zinc-300">Sample Size:</strong> CFB needs 50+ bets, CBB needs 100+ bets for reliable conclusions.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
