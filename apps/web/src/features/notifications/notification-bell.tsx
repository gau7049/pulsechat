import { useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { SkeletonRow } from '../../components/ui/skeleton';
import { unreadCountFrom, useMarkAllRead, useNotifications } from './use-notifications';

function describe(n: NotificationDto): string {
  const from = (n.payload.from as { displayName?: string } | undefined)?.displayName ?? 'Someone';
  switch (n.type) {
    case 'friend_request':
      return `${from} sent you a friend request`;
    case 'friend_accept':
      return `${from} accepted your friend request`;
    case 'post_like':
      return `${from} liked your post`;
    case 'post_comment':
      return `${from} commented on your post`;
    case 'moderation_warning':
      return String(n.payload.reason ?? 'Your content was reviewed by moderation');
    default:
      return `${from} sent you a notification`;
  }
}

/** Bell menu (§12: "rendered from a bell menu, marked read on view"). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const query = useNotifications();
  const markAllRead = useMarkAllRead();
  const containerRef = useRef<HTMLDivElement>(null);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = unreadCountFrom(query.data?.pages);

  useEffect(() => {
    function onOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead.mutate();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        title="Notifications"
        className="relative rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
      >
        🔔
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-on-accent"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-2xl border border-border bg-surface-raised p-2 shadow-xl">
          <h2 className="px-2 py-1.5 text-sm font-semibold text-fg">Notifications</h2>
          {query.isLoading && (
            <div aria-hidden>
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}
          {query.isError && (
            <EmptyState
              icon="⚠️"
              title="Could not load notifications"
              action={
                <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              }
            />
          )}
          {!query.isLoading && !query.isError && items.length === 0 && (
            <EmptyState icon="🔔" title="No notifications yet" />
          )}
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li
                key={n.id}
                className={`flex items-start gap-2 rounded-xl px-2 py-2 text-sm ${
                  n.readAt ? 'text-fg-muted' : 'bg-accent-soft/40 text-fg'
                }`}
              >
                <Avatar
                  name={
                    (n.payload.from as { displayName?: string } | undefined)?.displayName ?? '?'
                  }
                  src={(n.payload.from as { avatarUrl?: string | null } | undefined)?.avatarUrl}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{describe(n)}</span>
                  <span className="text-[10px] text-fg-muted">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button
              type="button"
              className="w-full rounded-lg py-2 text-center text-xs font-medium text-accent hover:text-accent-strong"
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
