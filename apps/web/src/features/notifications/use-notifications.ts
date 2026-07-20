import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { SERVER_EVENTS, type NotificationDto, type Page } from '@pulsechat/shared';
import { del, get, post } from '../../lib/api';
import { getSocket } from '../../lib/socket';

const notificationsKey = ['notifications'] as const;

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationsKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<NotificationDto>>(
        `/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Unread count derived from the same cache the bell dropdown renders. */
export function unreadCountFrom(pages: Page<NotificationDto>[] | undefined): number {
  return pages?.flatMap((page) => page.items).filter((n) => !n.readAt).length ?? 0;
}

/**
 * Moves a notification to the top of the cached list, replacing any copy
 * already present elsewhere in it — the server may re-emit the same id for
 * a deduped repeat event (e.g. like → unlike → like), and blindly prepending
 * would otherwise leave two rows for the same notification in the cache.
 */
function prepend(queryClient: QueryClient, notification: NotificationDto): void {
  queryClient.setQueriesData<{ pages: Page<NotificationDto>[]; pageParams: unknown[] }>(
    { queryKey: notificationsKey },
    (data) => {
      if (!data) return data;
      const [first, ...rest] = data.pages;
      const withoutExisting = (first?.items ?? []).filter((n) => n.id !== notification.id);
      const remainingPages = rest.map((page) => ({
        ...page,
        items: page.items.filter((n) => n.id !== notification.id),
      }));
      return {
        ...data,
        pages: [{ ...first, items: [notification, ...withoutExisting] }, ...remainingPages],
      };
    },
  );
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: true }>('/notifications/read-all'),
    onSuccess: () => {
      queryClient.setQueriesData<{ pages: Page<NotificationDto>[]; pageParams: unknown[] }>(
        { queryKey: notificationsKey },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((n) => ({
                ...n,
                readAt: n.readAt ?? new Date().toISOString(),
              })),
            })),
          },
      );
    },
  });
}

/** §24.9 — distinguishes an installed/standalone launch from an open browser tab. */
function isInstalledStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's legacy (non-standard) flag — no `display-mode` media query support there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function usePushSubscription() {
  const subscribe = useMutation({
    mutationFn: (sub: PushSubscriptionJSON) =>
      post<{ ok: true }>(
        '/push/subscribe',
        { endpoint: sub.endpoint, keys: sub.keys, installedPwa: isInstalledStandalone() },
        { silent: true },
      ),
  });
  const unsubscribe = useMutation({
    mutationFn: (endpoint: string) =>
      del<{ ok: true }>(`/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
        silent: true,
      }),
  });
  return { subscribe, unsubscribe };
}

/** Bridges `notification:new` into the bell's cache — mounted once in AppShell. */
export function useNotificationSocketBridge(userId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    if (!socket) return;

    const onNew = (event: {
      id: string;
      type: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }) => {
      prepend(queryClient, {
        id: event.id,
        type: event.type,
        payload: event.payload,
        readAt: null,
        createdAt: event.createdAt,
      });
    };

    socket.on(SERVER_EVENTS.NOTIFICATION_NEW, onNew);
    return () => {
      socket.off(SERVER_EVENTS.NOTIFICATION_NEW, onNew);
    };
  }, [userId, queryClient]);
}
