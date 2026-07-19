import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { SkeletonRow } from '../../components/ui/skeleton';
import { deepLinkFor, describeNotification, thumbnailFor } from './notification-utils';
import { unreadCountFrom, useMarkAllRead, useNotifications } from './use-notifications';

/**
 * §24.5 notification center — a dedicated, chronological, deep-linkable
 * history. The bell dropdown (§12) stays the quick-glance surface; this page
 * is where "See all" lands. Both read the same `GET /notifications` feed.
 */
export function NotificationsPage() {
  const query = useNotifications();
  const markAllRead = useMarkAllRead();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  // §12 "marked read on view": the desktop sidebar links straight here, so the
  // page clears the badge just like opening the bell dropdown does.
  const unread = unreadCountFrom(query.data?.pages);
  const markAllReadMutate = markAllRead.mutate;
  useEffect(() => {
    if (unread > 0) markAllReadMutate();
  }, [unread, markAllReadMutate]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Notifications</h1>

      {query.isLoading && (
        <div aria-hidden className="flex flex-col gap-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}
      {query.isError && (
        <EmptyState
          icon="⚠️"
          title="Could not load notifications"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState icon="🔔" title="No notifications yet" />
      )}

      <ul className="flex flex-col gap-1">
        {items.map((n) => {
          const href = deepLinkFor(n);
          const thumbnail = thumbnailFor(n);
          const from = n.payload.from as
            { displayName?: string; avatarUrl?: string | null } | undefined;
          const row = (
            <span className="flex items-start gap-3">
              <Avatar name={from?.displayName ?? '?'} src={from?.avatarUrl} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-fg">{describeNotification(n)}</span>
                <span className="text-xs text-fg-muted">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </span>
              {thumbnail && (
                <img
                  src={thumbnail}
                  alt=""
                  loading="lazy"
                  className="size-11 shrink-0 rounded-lg object-cover"
                />
              )}
              {!n.readAt && (
                <span
                  aria-label="Unread"
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                />
              )}
            </span>
          );
          return (
            <li key={n.id} className={`rounded-xl ${n.readAt ? '' : 'bg-accent-soft/40'}`}>
              {href ? (
                <Link to={href} className="block rounded-xl px-3 py-3 hover:bg-surface-sunken">
                  {row}
                </Link>
              ) : (
                <span className="block px-3 py-3">{row}</span>
              )}
            </li>
          );
        })}
      </ul>

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}
    </main>
  );
}
