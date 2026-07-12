import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, CreatePostBody, Page, PostDto } from '@pulsechat/shared';
import { del, get, post as httpPost } from '../../lib/api';

/**
 * Server state for posts & feed (Requirement Scope §13). Mutations invalidate
 * the whole `['posts']` family — posts are much lower-frequency than chat, so
 * the simpler refetch-on-write pattern already used for `['social']` fits
 * better here than message-style cache surgery.
 */

const keys = {
  post: (id: string) => ['posts', 'detail', id] as const,
  comments: (postId: string) => ['posts', 'comments', postId] as const,
  userPosts: (username: string) => ['posts', 'user', username.toLowerCase()] as const,
  liked: ['posts', 'liked'] as const,
  saved: ['posts', 'saved'] as const,
  hashtag: (tag: string) => ['posts', 'hashtag', tag.toLowerCase()] as const,
  explore: ['posts', 'explore'] as const,
};

function useInvalidatePosts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['posts'] });
}

function infinitePosts(queryKey: readonly unknown[], path: string) {
  return {
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      get<Page<PostDto>>(`${path}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last: Page<PostDto>) => last.nextCursor,
  };
}

export function useExploreFeed() {
  return useInfiniteQuery(infinitePosts(keys.explore, '/feed/explore'));
}

export function useHashtagPosts(tag: string) {
  return useInfiniteQuery(infinitePosts(keys.hashtag(tag), `/hashtags/${encodeURIComponent(tag)}`));
}

export function useUserPosts(username: string) {
  return useInfiniteQuery(
    infinitePosts(keys.userPosts(username), `/users/${encodeURIComponent(username)}/posts`),
  );
}

export function useLikedPosts() {
  return useInfiniteQuery(infinitePosts(keys.liked, '/posts/liked'));
}

export function useSavedPosts() {
  return useInfiniteQuery(infinitePosts(keys.saved, '/posts/saved'));
}

export function usePost(postId: string) {
  return useQuery({
    queryKey: keys.post(postId),
    queryFn: () => get<{ post: PostDto }>(`/posts/${postId}`),
  });
}

export function useComments(postId: string) {
  return useInfiniteQuery({
    queryKey: keys.comments(postId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<CommentDto>>(
        `/posts/${postId}/comments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useCreatePost() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (body: CreatePostBody) => httpPost<{ post: PostDto }>('/posts', body),
    onSuccess: invalidate,
  });
}

export function useDeletePost() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (postId: string) => del<{ ok: true }>(`/posts/${postId}`),
    onSuccess: invalidate,
  });
}

export function useToggleLike() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (postId: string) => httpPost<{ liked: boolean }>(`/posts/${postId}/like`),
    onSuccess: invalidate,
  });
}

export function useToggleSave() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (postId: string) => httpPost<{ saved: boolean }>(`/posts/${postId}/save`),
    onSuccess: invalidate,
  });
}

export function useCreateComment(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (body: string) =>
      httpPost<{ comment: CommentDto }>(`/posts/${postId}/comments`, { body }),
    onSuccess: invalidate,
  });
}
