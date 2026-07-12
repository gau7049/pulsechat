import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../components/ui/button';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useAdminSummary, useAdminTimeseries } from './use-admin';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-fg">{value ?? '—'}</p>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-lg">
      <p className="text-fg-muted">{label}</p>
      <p className="font-semibold text-fg">{payload[0]?.value}</p>
    </div>
  );
}

/** Admin analytics dashboard (Requirement Scope §18.1, Technical Spec §13). */
export function AnalyticsDashboard() {
  const [metric, setMetric] = useState<'signups' | 'sessions'>('sessions');
  const [range, setRange] = useState<Range>(30);
  const summary = useAdminSummary();
  const timeseries = useAdminTimeseries(metric, range);
  const points = timeseries.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total users" value={summary.data?.totalUsers} />
        <StatTile label="Active now" value={summary.data?.activeNow} />
        <StatTile label="Daily active" value={summary.data?.dau} />
        <StatTile label="Weekly active" value={summary.data?.wau} />
      </div>

      <div className="rounded-2xl border border-border bg-surface-raised p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg">
            {metric === 'sessions' ? 'Sessions' : 'Signups'} over time
          </h3>
          <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
            {(['sessions', 'signups'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  metric === m
                    ? 'bg-surface-raised text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {m === 'sessions' ? 'Sessions' : 'Signups'}
              </button>
            ))}
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  range === r
                    ? 'bg-surface-raised text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        {timeseries.isLoading && (
          <div aria-hidden>
            <SkeletonRow />
          </div>
        )}
        {timeseries.isError && (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-fg-muted">
            <p>Could not load this chart.</p>
            <Button variant="secondary" size="sm" onClick={() => void timeseries.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {!timeseries.isLoading && !timeseries.isError && points.length === 0 && (
          <p className="py-12 text-center text-sm text-fg-muted">No data in this range yet.</p>
        )}
        {points.length > 0 && (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--color-border)' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'var(--color-fg-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
