import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SERVER_EVENTS,
  type CreateStatusBody,
  type LiveActiveEntryDto,
  type LiveSessionDto,
  type StartLiveBody,
  type StatusDto,
  type StatusFeedEntryDto,
} from '@pulsechat/shared';
import { del, get, post } from '../../lib/api';
import { getSocket } from '../../lib/socket';

/**
 * Status/live rail data (Requirement Scope §11–12): both endpoints are
 * unpaginated (friend-count bounded, same trade-off as `useConversations`),
 * so a plain `useQuery` + live-socket invalidation is enough — no infinite
 * query machinery needed.
 */

const feedKey = ['status', 'feed'] as const;

export function useStatusFeed() {
  return useQuery({
    queryKey: feedKey,
    queryFn: () => get<{ items: StatusFeedEntryDto[] }>('/statuses/feed'),
    staleTime: 10_000,
  });
}

export function useCreateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStatusBody) => post<{ status: StatusDto }>('/statuses', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: feedKey }),
  });
}

export function useDeleteStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (statusId: string) => del<{ ok: true }>(`/statuses/${statusId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: feedKey }),
  });
}

export function useStartLive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StartLiveBody) => post<{ live: LiveSessionDto }>('/live/start', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: feedKey }),
  });
}

export function useEndLive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: true }>('/live/end'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: feedKey }),
  });
}

export function useLiveActive() {
  return useQuery({
    queryKey: ['status', 'live-active'],
    queryFn: () => get<{ items: LiveActiveEntryDto[] }>('/live/active'),
    staleTime: 10_000,
  });
}

/** Mounted once alongside the other socket bridges in the signed-in app shell. */
export function useStatusSocketBridge(userId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    if (!socket) return;

    const invalidate = () => void queryClient.invalidateQueries({ queryKey: feedKey });

    socket.on(SERVER_EVENTS.LIVE_STARTED, invalidate);
    socket.on(SERVER_EVENTS.LIVE_ENDED, invalidate);
    socket.on('connect', invalidate);

    return () => {
      socket.off(SERVER_EVENTS.LIVE_STARTED, invalidate);
      socket.off(SERVER_EVENTS.LIVE_ENDED, invalidate);
      socket.off('connect', invalidate);
    };
  }, [queryClient, userId]);
}
