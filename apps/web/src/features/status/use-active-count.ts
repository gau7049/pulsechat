import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVER_EVENTS, type ActiveCountUpdatePayload } from '@pulsechat/shared';
import { get } from '../../lib/api';
import { getSocket } from '../../lib/socket';

/**
 * Active-users indicator (Requirement Scope §12.2). The server pushes a
 * scoped "refetch" ping rather than a computed number — mirrors the existing
 * `['social']` query-invalidation pattern, just over the socket.
 */
export function useActiveCount(scope: 'all' | 'friends') {
  const queryClient = useQueryClient();
  const queryKey = ['presence', 'active-count', scope] as const;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdate = (payload: ActiveCountUpdatePayload) => {
      if (payload.scope === scope) void queryClient.invalidateQueries({ queryKey });
    };
    socket.on(SERVER_EVENTS.ACTIVE_COUNT_UPDATE, onUpdate);
    return () => {
      socket.off(SERVER_EVENTS.ACTIVE_COUNT_UPDATE, onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from scope
  }, [queryClient, scope]);

  return useQuery({
    queryKey,
    queryFn: () => get<{ count: number }>(`/presence/active-count?scope=${scope}`),
    staleTime: 15_000,
  });
}
