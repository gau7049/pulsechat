import { useState } from 'react';
import type { ReportAction, ReportAdminDto, ReportStatus } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useAdminReports, useReportAction } from './use-admin';

const STATUS_TABS: { label: string; value: ReportStatus | undefined }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'Actioned', value: 'actioned' },
  { label: 'All', value: undefined },
];

function previewText(report: ReportAdminDto): string {
  if (!report.preview) return 'Content no longer exists';
  if (report.preview.kind === 'post') return report.preview.caption ?? '(no caption)';
  if (report.preview.kind === 'message') return `Message in a conversation (content not visible)`;
  return `Profile: ${report.preview.user.displayName}`;
}

function ReportRow({ report }: { report: ReportAdminDto }) {
  const { toast } = useToast();
  const action = useReportAction();

  function run(next: ReportAction) {
    action.mutate(
      { id: report.id, action: next },
      {
        onError: (err) =>
          toast(err instanceof Error ? err.message : 'Action failed', { kind: 'error' }),
        onSuccess: () =>
          toast(`Report ${next === 'dismiss' ? 'dismissed' : next + 'ed'}`, { kind: 'success' }),
      },
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar name={report.reporter.displayName} src={report.reporter.avatarUrl} size="sm" />
          <span className="text-sm text-fg-muted">
            <strong className="text-fg">{report.reporter.displayName}</strong> reported a{' '}
            <strong>{report.targetType}</strong>
          </span>
        </div>
        <span className="text-xs text-fg-muted">{new Date(report.createdAt).toLocaleString()}</span>
      </div>
      <p className="text-sm text-fg">
        <span className="font-medium">Reason:</span> {report.reason}
      </p>
      <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-fg-muted">
        {previewText(report)}
      </p>
      {report.status === 'open' && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={action.isPending}
            onClick={() => run('warn')}
          >
            Warn
          </Button>
          {report.targetType !== 'profile' && (
            <Button
              size="sm"
              variant="danger"
              loading={action.isPending}
              onClick={() => run('remove')}
            >
              Remove content
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            loading={action.isPending}
            onClick={() => run('suspend')}
          >
            Suspend user
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={action.isPending}
            onClick={() => run('dismiss')}
          >
            Dismiss
          </Button>
        </div>
      )}
      {report.status !== 'open' && (
        <span className="self-start rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-fg-muted">
          {report.status}
        </span>
      )}
    </li>
  );
}

/** Admin moderation queue (Requirement Scope §18, Technical Spec §13). */
export function ReportsQueue() {
  const [status, setStatus] = useState<ReportStatus | undefined>('open');
  const query = useAdminReports(status);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div>
      <nav className="mb-4 flex gap-1 rounded-xl bg-surface-sunken p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              status === tab.value
                ? 'bg-surface-raised text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {query.isLoading && (
        <div aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}
      {query.isError && (
        <EmptyState
          icon="⚠️"
          title="Could not load reports"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState icon="✅" title="No reports here" />
      )}
      <ul className="flex flex-col gap-3">
        {items.map((report) => (
          <ReportRow key={report.id} report={report} />
        ))}
      </ul>
      {query.hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="ghost"
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
