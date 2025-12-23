'use client';

import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';

interface EdgeBucket {
  wins: number;
  losses: number;
}

interface Report {
  id: string;
  report_date: string;
  sport: string;
  total_bets: number;
  wins: number;
  losses: number;
  pushes: number;
  win_rate: number | null;
  roi: number | null;
  profit_units: number;
  backtest_win_rate: number | null;
  vs_backtest: string;
  vs_backtest_significant: boolean;
  vs_breakeven_pvalue: number | null;
  edge_buckets: Record<string, EdgeBucket>;
  favorites_record?: string;
  favorites_roi?: number | null;
  underdogs_record?: string;
  underdogs_roi?: number | null;
  sample_size_adequate: boolean;
  recommendation: string;
  report_text: string;
  created_at: string;
}

interface ReportsData {
  reports: Report[];
  latest: {
    cfb: Report | null;
    cbb: Report | null;
  };
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
    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
      <div className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">{label}</div>
      <div
        className={`text-2xl font-bold ${
          positive === true
            ? 'text-emerald-600 dark:text-emerald-400'
            : positive === false
            ? 'text-red-600 dark:text-red-400'
            : 'text-zinc-900 dark:text-zinc-100'
        }`}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{subtext}</div>
      )}
    </div>
  );
}

function SportReport({ report, title }: { report: Report | null; title: string }) {
  if (!report) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
          {title}
        </h2>
        <div className="text-zinc-500 dark:text-zinc-400">
          No reports generated yet. Reports are generated weekly.
        </div>
      </div>
    );
  }

  const winRate = report.win_rate !== null ? (report.win_rate * 100).toFixed(1) : 'N/A';
  const roi = report.roi !== null ? (report.roi * 100).toFixed(1) : 'N/A';
  const roiPositive = report.roi !== null ? report.roi > 0 : null;
  const winRatePositive =
    report.win_rate !== null ? report.win_rate > 0.524 : null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {new Date(report.report_date).toLocaleDateString()}
        </span>
      </div>

      {/* Key Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Record"
          value={`${report.wins}-${report.losses}${report.pushes > 0 ? `-${report.pushes}` : ''}`}
        />
        <StatCard
          label="Win Rate"
          value={`${winRate}%`}
          subtext="Breakeven: 52.4%"
          positive={winRatePositive}
        />
        <StatCard
          label="ROI"
          value={`${Number(roi) >= 0 ? '+' : ''}${roi}%`}
          positive={roiPositive}
        />
        <StatCard
          label="Profit"
          value={`${report.profit_units >= 0 ? '+' : ''}${report.profit_units.toFixed(1)}u`}
          positive={report.profit_units > 0}
        />
      </div>

      {/* Backtest Comparison */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
          vs Backtest ({((report.backtest_win_rate || 0) * 100).toFixed(1)}%)
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 rounded text-sm font-medium ${
              report.vs_backtest === 'above'
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : report.vs_backtest === 'below'
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {report.vs_backtest === 'above'
              ? 'Above'
              : report.vs_backtest === 'below'
              ? 'Below'
              : 'Equal'}
          </span>
          {report.vs_backtest_significant && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              (Statistically Significant)
            </span>
          )}
        </div>
      </div>

      {/* CBB Strategy Breakdown */}
      {report.sport === 'cbb' && (report.favorites_record || report.underdogs_record) && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
            Strategy Breakdown
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {report.favorites_record && (
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">
                <div className="text-sm text-zinc-500 dark:text-zinc-400">Favorites</div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {report.favorites_record}
                </div>
                {report.favorites_roi != null && (
                  <div
                    className={`text-sm ${
                      report.favorites_roi > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {report.favorites_roi > 0 ? '+' : ''}{(report.favorites_roi * 100).toFixed(1)}% ROI
                  </div>
                )}
              </div>
            )}
            {report.underdogs_record && (
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">
                <div className="text-sm text-zinc-500 dark:text-zinc-400">Underdogs</div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {report.underdogs_record}
                </div>
                {report.underdogs_roi != null && (
                  <div
                    className={`text-sm ${
                      report.underdogs_roi > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {report.underdogs_roi > 0 ? '+' : ''}{(report.underdogs_roi * 100).toFixed(1)}% ROI
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edge Buckets */}
      {report.edge_buckets && Object.keys(report.edge_buckets).length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
            Edge Bucket Performance
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2">Edge Range</th>
                  <th className="pb-2">Record</th>
                  <th className="pb-2">Win%</th>
                  <th className="pb-2">ROI</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.edge_buckets)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([bucket, stats]) => {
                    const total = stats.wins + stats.losses;
                    const wr = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : 'N/A';
                    const bucketRoi =
                      total > 0
                        ? (((stats.wins * 0.91 - stats.losses) / total) * 100).toFixed(1)
                        : 'N/A';
                    const isPositive =
                      total > 0 && stats.wins * 0.91 - stats.losses > 0;

                    return (
                      <tr
                        key={bucket}
                        className="border-b border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-2 text-zinc-900 dark:text-zinc-100">
                          {bucket} pts
                        </td>
                        <td className="py-2 text-zinc-700 dark:text-zinc-300">
                          {stats.wins}-{stats.losses}
                        </td>
                        <td className="py-2 text-zinc-700 dark:text-zinc-300">{wr}%</td>
                        <td
                          className={`py-2 ${
                            isPositive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {bucketRoi !== 'N/A' && Number(bucketRoi) >= 0 ? '+' : ''}
                          {bucketRoi}%
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sample Size & Recommendation */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-2 h-2 rounded-full ${
              report.sample_size_adequate
                ? 'bg-emerald-500'
                : 'bg-amber-500'
            }`}
          />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {report.sample_size_adequate
              ? 'Sample Size Adequate'
              : 'Insufficient Sample Size'}
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {report.recommendation}
        </p>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

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

  const generateReports = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/cron/generate-report');
      const json = await res.json();

      if (res.ok) {
        // Refresh data after generation
        await fetchReports();
      } else {
        setError(json.error || 'Failed to generate reports');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Navigation />

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              Model Performance Reports
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-1">
              Weekly analysis comparing live results to backtest expectations
            </p>
          </div>
          <button
            onClick={generateReports}
            disabled={generating}
            className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? 'Generating...' : 'Generate Report'}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            Loading reports...
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-600 dark:text-red-400 mb-4">{error}</div>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                fetchReports();
              }}
              className="text-zinc-600 dark:text-zinc-400 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <SportReport
              report={data?.latest.cfb || null}
              title="CFB Model Performance"
            />
            <SportReport
              report={data?.latest.cbb || null}
              title="CBB Model Performance"
            />
          </div>
        )}

        {/* Historical Reports */}
        {data && data.reports.length > 2 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
              Historical Reports
            </h2>
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Sport</th>
                    <th className="px-4 py-3">Record</th>
                    <th className="px-4 py-3">Win%</th>
                    <th className="px-4 py-3">ROI</th>
                    <th className="px-4 py-3">vs Backtest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.slice(2).map((report) => (
                    <tr
                      key={report.id}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                        {new Date(report.report_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {report.sport.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                        {report.wins}-{report.losses}
                      </td>
                      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                        {report.win_rate !== null
                          ? `${(report.win_rate * 100).toFixed(1)}%`
                          : 'N/A'}
                      </td>
                      <td
                        className={`px-4 py-3 ${
                          report.roi !== null && report.roi > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {report.roi !== null
                          ? `${report.roi > 0 ? '+' : ''}${(report.roi * 100).toFixed(1)}%`
                          : 'N/A'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 text-xs rounded ${
                            report.vs_backtest === 'above'
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {report.vs_backtest}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Methodology */}
        <div className="mt-8 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-3">
            Report Methodology
          </h2>
          <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-2">
            <p>
              <strong>Win Rate:</strong> Wins / (Wins + Losses). Pushes excluded. Breakeven
              at -110 juice is 52.4%.
            </p>
            <p>
              <strong>ROI:</strong> (Wins × 0.91 − Losses) / Total Bets. Accounts for -110
              standard juice.
            </p>
            <p>
              <strong>Statistical Significance:</strong> Binomial test comparing observed
              win rate to expected rate. p &lt; 0.05 marked as significant.
            </p>
            <p>
              <strong>Sample Size:</strong> CFB needs 50+ bets, CBB needs 100+ bets for
              reliable conclusions.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
