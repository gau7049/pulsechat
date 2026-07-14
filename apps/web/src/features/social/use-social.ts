import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BlockedUserDto,
  CloseFriendDto,
  FriendDto,
  FriendRequestDto,
  InviteDto,
  Page,
  PublicProfileDto,
  SearchResultDto,
  SuggestionDto,
} from '@pulsechat/shared';
import { del, get, patch, post } from '../../lib/api';

/**
 * Server state for the social graph. Every mutation invalidates the query
 * families it can affect; socket-driven invalidation joins in M3.
 */

const keys = {
  search: (q: string) => ['social', 'search', q] as const,
  requests: (direction: 'incoming' | 'outgoing') => ['social', 'requests', direction] as const,
  friends: ['social', 'friends'] as const,
  suggestions: ['social', 'suggestions'] as const,
  blocked: ['social', 'blocked'] as const,
  closeFriends: ['social', 'close-friends'] as const,
  profile: (username: string) => ['social', 'profile', username.toLowerCase()] as const,
  invite: ['social', 'invite'] as const,
};

function useInvalidateSocial() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['social'] });
}

export function useUserSearch(q: string) {
  const query = q.trim();
  return useInfiniteQuery({
    queryKey: keys.search(query),
    enabled: query.length > 0,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<SearchResultDto>>(
        `/search/users?q=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useFriendRequests(direction: 'incoming' | 'outgoing') {
  return useInfiniteQuery({
    queryKey: keys.requests(direction),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<FriendRequestDto>>(
        `/friend-requests?direction=${direction}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useFriends() {
  return useInfiniteQuery({
    queryKey: keys.friends,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<FriendDto>>(
        `/friends${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: keys.suggestions,
    queryFn: () => get<{ items: SuggestionDto[] }>('/friends/suggestions'),
  });
}

export function useBlockedUsers() {
  return useQuery({
    queryKey: keys.blocked,
    queryFn: () => get<{ items: BlockedUserDto[] }>('/blocks'),
  });
}

export function usePublicProfile(username: string) {
  return useQuery({
    queryKey: keys.profile(username),
    queryFn: () => get<PublicProfileDto>(`/users/${encodeURIComponent(username)}`),
    retry: false,
  });
}

export function useMyInvite() {
  return useMutation({ mutationFn: () => post<InviteDto>('/invites') });
}

export function useSendFriendRequest() {
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (toUserId: string) => post<{ id: string }>('/friend-requests', { toUserId }),
    onSuccess: invalidate,
  });
}

export function useRespondToRequest() {
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (input: { requestId: string; action: 'accept' | 'reject' | 'cancel' }) =>
      patch<{ ok: true }>(`/friend-requests/${input.requestId}`, { action: input.action }),
    onSuccess: invalidate,
  });
}

export function useRemoveFriend() {
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (userId: string) => del<{ ok: true }>(`/friends/${userId}`),
    onSuccess: invalidate,
  });
}

export function useBlockUser() {
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (userId: string) => post<{ ok: true }>('/blocks', { userId }),
    onSuccess: invalidate,
  });
}

export function useUnblockUser() {
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (userId: string) => del<{ ok: true }>(`/blocks/${userId}`),
    onSuccess: invalidate,
  });
}

// ── Close friends (§24.12) ───────────────────────────────────────────────────

export function useCloseFriends() {
  return useQuery({
    queryKey: keys.closeFriends,
    queryFn: () => get<{ items: CloseFriendDto[] }>('/close-friends'),
  });
}

export function useAddCloseFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => post<{ ok: true }>(`/close-friends/${userId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.closeFriends }),
  });
}

export function useRemoveCloseFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => del<{ ok: true }>(`/close-friends/${userId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.closeFriends }),
  });
}
