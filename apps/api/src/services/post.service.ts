import type { PostAudience } from '@prisma/client';
import {
  LIMITS,
  computeRankingScore,
  type CommentDto,
  type CreatePostBody,
  type Page,
  type PostDto,
} from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { cache } from '../lib/cache.js';
import { logger } from '../lib/logger.js';
import * as postRepo from '../repositories/post.repository.js';
import type {
  AuthorSummary,
  CommentWithUser,
  PostWithHashtags,
  PostWithMeta,
} from '../repositories/post.repository.js';
import * as social from '../repositories/social.repository.js';
import * as users from '../repositories/user.repository.js';
import { notify } from './notification.service.js';
import { invalidateProfileCounts } from './social.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Posts & feed (Requirement Scope §13): post visibility follows the author's
 * profile visibility, hashtags are extracted from the caption and only
 * indexed for public authors, and hashtag/explore ranking is computed at
 * read time over a bounded recency window (Technical Spec §4 footnote).
 */

const HASHTAG_PATTERN = /#(\w{1,64})/g;

/**
 * §13.2/§13.7 hot-read caching (Technical Spec §1). Caches only the
 * viewer-independent recency *window* the ranking is computed over — never
 * the finished per-viewer page, which carries likedByMe/savedByMe and would
 * leak one viewer's state to another if cached. Bounded staleness (a like/
 * comment landing mid-TTL) is accepted, same trade-off as the ranking
 * formula itself being "computed at read time" rather than exact.
 */
const FEED_CACHE_TTL_SECONDS = 30;
const exploreWindowKey = 'explore:window';
const hashtagWindowKey = (tag: string) => `hashtag:${tag}:window`;

function invalidateFeedCache(hashtags: string[]): void {
  cache.del(exploreWindowKey);
  for (const tag of hashtags) cache.del(hashtagWindowKey(tag));
}

/**
 * A profile-visibility flip changes which window every hashtag/explore
 * cache entry should contain (§13.3: posts drop out of discovery the moment
 * their author goes non-public), but the *service* has no per-tag registry
 * to invalidate selectively — visibility changes are rare enough that
 * clearing the whole feed-cache namespace is the simple, safe answer rather
 * than tracking author→tag reverse indexes just for this.
 */
export function invalidateAllFeedCaches(): void {
  cache.del(exploreWindowKey);
  for (const key of cache.keys()) {
    if (key.startsWith('hashtag:')) cache.del(key);
  }
}

// ── Serialization ────────────────────────────────────────────────────────────

function toPostDtoFrom(post: PostWithHashtags, likedByMe: boolean, savedByMe: boolean): PostDto {
  return {
    id: post.id,
    author: toUserSummaryDto(post.author),
    mediaUrl: post.mediaUrl,
    caption: post.caption,
    audience: post.audience,
    isPublic: post.author.visibility === 'public' && post.audience === 'everyone',
    hashtags: post.hashtags.map((h) => h.tag),
    taggedUsers: post.tags.map((t) => toUserSummaryDto(t.taggedUser)),
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    viewCount: post.viewCount,
    likedByMe,
    savedByMe,
    createdAt: post.createdAt.toISOString(),
  };
}

function toPostDto(post: PostWithMeta): PostDto {
  return toPostDtoFrom(post, post.likes.length > 0, post.saves.length > 0);
}

function toCommentDto(comment: CommentWithUser): CommentDto {
  return {
    id: comment.id,
    postId: comment.postId,
    user: toUserSummaryDto(comment.user),
    body: comment.body,
    likeCount: comment.likeCount,
    likedByMe: comment.likes.length > 0,
    createdAt: comment.createdAt.toISOString(),
  };
}

/**
 * §24.7 — a post's audience defaults from the author's account-level
 * visibility. `only_me` has no account-level equivalent — it's a purely
 * per-post concept, never inferred. `private` and `friends` accounts are
 * already treated identically everywhere else (`assertProfileVisible` only
 * distinguishes public from not-public), so both default to `friends` here.
 */
function defaultAudienceFor(visibility: AuthorSummary['visibility']): PostAudience {
  return visibility === 'public' ? 'everyone' : 'friends';
}

function extractHashtags(caption: string): string[] {
  const tags = new Set<string>();
  for (const match of caption.matchAll(HASHTAG_PATTERN)) {
    tags.add(match[1]!.toLowerCase());
  }
  return [...tags];
}

// ── Visibility (mirrors social.service.ts's getPublicProfile gate) ──────────

/** Account-level profile gate — unaffected by any individual post's audience. */
async function assertProfileVisible(viewerId: string, author: AuthorSummary): Promise<void> {
  if (viewerId === author.id) return;
  const block = await social.findBlockBetween(viewerId, author.id);
  if (block) throw new AppError('NOT_FOUND', 'Post not found');
  if (author.visibility === 'public') return;
  if (!(await social.findFriendship(viewerId, author.id))) {
    throw new AppError('NOT_FOUND', 'Post not found');
  }
}

/**
 * Invisible posts read as not-found, same as a blocked/private profile
 * (§8, §13.3), further narrowed by the post's own audience (§24.7) — never
 * looser than the account-level gate, only ever stricter.
 */
async function assertCanView(
  viewerId: string,
  post: { author: AuthorSummary; audience: PostAudience },
): Promise<void> {
  await assertProfileVisible(viewerId, post.author);
  if (viewerId === post.author.id) return;
  if (post.audience === 'only_me') throw new AppError('NOT_FOUND', 'Post not found');
  if (post.audience === 'friends' && !(await social.findFriendship(viewerId, post.author.id))) {
    throw new AppError('NOT_FOUND', 'Post not found');
  }
}

/** §24.2 — silently drops any tagged id that isn't actually a friend (no tagging strangers). */
async function filterToFriends(authorId: string, candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const friendIds = new Set(await social.friendIds(authorId));
  return [...new Set(candidateIds)].filter((id) => friendIds.has(id));
}

// ── Posts ────────────────────────────────────────────────────────────────────

export async function createPost(authorId: string, body: CreatePostBody): Promise<PostDto> {
  const author = await users.findById(authorId);
  if (!author) throw new AppError('NOT_FOUND', 'User not found');
  // §13.1/§13.3: only public-profile authors get hashtag-indexed posts.
  const hashtags = author.visibility === 'public' ? extractHashtags(body.caption ?? '') : [];
  const audience = body.audience ?? defaultAudienceFor(author.visibility);
  const taggedUserIds = await filterToFriends(authorId, body.taggedUserIds ?? []);
  const created = await postRepo.create({
    authorId,
    mediaUrl: body.mediaUrl,
    caption: body.caption,
    audience,
    hashtags,
    taggedUserIds,
  });
  logger.info({ event: 'post.created', authorId, postId: created.id }, 'post created');
  const full = await postRepo.findById(created.id, authorId);
  invalidateFeedCache(hashtags);
  invalidateProfileCounts(authorId);
  // §24.2 — tagged friends are notified in the same flow a liked/commented post uses.
  const authorSummary = toUserSummaryDto(author);
  await Promise.all(
    taggedUserIds.map((taggedUserId) =>
      notify(taggedUserId, 'tag', {
        from: authorSummary,
        postId: created.id,
        postMediaUrl: created.mediaUrl,
      }),
    ),
  );
  return toPostDto(full!);
}

/** §24.2 self-removal — a tagged user can remove their own tag; the author cannot remove it for them. */
export async function removeMyTag(userId: string, postId: string): Promise<void> {
  const removed = await postRepo.deleteTag(postId, userId);
  if (!removed) throw new AppError('NOT_FOUND', 'You are not tagged in this post');
  logger.info({ event: 'post.tag_removed', userId, postId }, 'tag removed by tagged user');
}

export async function deletePost(userId: string, postId: string): Promise<void> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  if (post.authorId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the author can delete a post');
  }
  await postRepo.deleteById(postId);
  invalidateFeedCache(post.hashtags.map((h) => h.tag));
  invalidateProfileCounts(userId);
  logger.info({ event: 'post.deleted', userId, postId }, 'post deleted');
}

/** §18 admin content removal — skips the owner-only check, reached only from the moderation queue. */
export async function adminDeletePost(postId: string): Promise<{ authorId: string }> {
  // No real viewer for an admin action — per-viewer likedByMe/savedByMe are unused here.
  const post = await postRepo.findById(postId, '');
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await postRepo.deleteById(postId);
  invalidateFeedCache(post.hashtags.map((h) => h.tag));
  invalidateProfileCounts(post.authorId);
  logger.info({ event: 'post.admin_deleted', postId }, 'post removed by moderation');
  return { authorId: post.authorId };
}

export async function getPost(viewerId: string, postId: string): Promise<PostDto> {
  const post = await postRepo.findById(postId, viewerId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(viewerId, post);
  if (viewerId !== post.authorId) {
    await postRepo.incrementView(postId);
    post.viewCount += 1;
  }
  return toPostDto(post);
}

export async function listUserPosts(
  viewerId: string,
  username: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  const author = await users.findByUsername(username);
  if (!author || author.status !== 'active') throw new AppError('NOT_FOUND', 'User not found');
  await assertProfileVisible(viewerId, author);
  // §24.8: the grid itself is gated per-post by audience — a non-friend
  // visitor to a public profile only sees `everyone`-audience posts, even
  // though the profile-level check above already let them in.
  const isSelf = viewerId === author.id;
  const isFriend = isSelf ? true : Boolean(await social.findFriendship(viewerId, author.id));
  const audienceIn: PostAudience[] | undefined = isSelf
    ? undefined
    : isFriend
      ? ['everyone', 'friends']
      : ['everyone'];
  const rows = await postRepo.listByAuthor(author.id, viewerId, {
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
    audienceIn,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map(toPostDto),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}

// ── Likes, saves, comments (§13.5) ───────────────────────────────────────────

export async function toggleLike(userId: string, postId: string): Promise<{ liked: boolean }> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(userId, post);
  const liked = await postRepo.toggleLike(postId, userId);
  // A changed like count shifts the ranking score (§13.2) — drop the cached window.
  invalidateFeedCache(post.hashtags.map((h) => h.tag));
  if (liked && post.authorId !== userId) {
    const liker = await users.findById(userId);
    if (liker) {
      await notify(post.authorId, 'post_like', {
        from: toUserSummaryDto(liker),
        postId,
        postMediaUrl: post.mediaUrl,
      });
    }
  }
  return { liked };
}

/** Bookmark toggle — private, never notifies the author (§13.5). */
export async function toggleSave(userId: string, postId: string): Promise<{ saved: boolean }> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(userId, post);
  return { saved: await postRepo.toggleSave(postId, userId) };
}

export async function createComment(
  userId: string,
  postId: string,
  body: string,
): Promise<CommentDto> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(userId, post);
  const commenter = await users.findById(userId);
  if (!commenter) throw new AppError('NOT_FOUND', 'User not found');
  const comment = await postRepo.createComment(postId, userId, body);
  // A changed comment count shifts the ranking score (§13.2) — drop the cached window.
  invalidateFeedCache(post.hashtags.map((h) => h.tag));
  if (post.authorId !== userId) {
    await notify(post.authorId, 'post_comment', {
      from: toUserSummaryDto(commenter),
      postId,
      commentId: comment.id,
      postMediaUrl: post.mediaUrl,
    });
  }
  logger.info({ event: 'post.commented', userId, postId, commentId: comment.id }, 'comment added');
  return toCommentDto({ ...comment, user: commenter, likes: [] });
}

export async function listComments(
  viewerId: string,
  postId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<CommentDto>> {
  const post = await postRepo.findById(postId, viewerId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(viewerId, post);
  const rows = await postRepo.listComments(postId, viewerId, {
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map(toCommentDto),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}

/** §24.6 comment likes — toggle + transactional counter, mirrors post likes. */
export async function toggleCommentLike(
  userId: string,
  commentId: string,
): Promise<{ liked: boolean }> {
  const comment = await postRepo.findCommentWithPost(commentId);
  if (!comment) throw new AppError('NOT_FOUND', 'Comment not found');
  await assertCanView(userId, comment.post);
  const liked = await postRepo.toggleCommentLike(commentId, userId);
  if (liked && comment.userId !== userId) {
    const liker = await users.findById(userId);
    if (liker) {
      await notify(comment.userId, 'comment_like', {
        from: toUserSummaryDto(liker),
        postId: comment.postId,
        commentId,
        postMediaUrl: comment.post.mediaUrl,
      });
    }
  }
  return { liked };
}

/** "Posts I've Liked" (§13.5) — the viewer's own history, not re-checked for current visibility. */
export async function listLikedPosts(
  userId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  const rows = await postRepo.listLiked(userId, {
    cursorPostId: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map((row) => toPostDto(row.post)),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.postId } : {}),
  };
}

/** "Saved Posts" (§13.5). */
export async function listSavedPosts(
  userId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  const rows = await postRepo.listSaved(userId, {
    cursorPostId: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map((row) => toPostDto(row.post)),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.postId } : {}),
  };
}

// ── Hashtag page & explore feed (§13.2, §13.7) ───────────────────────────────

/**
 * Ranks a bounded recency window in memory, then paginates the ranked list
 * with a numeric offset carried as the opaque cursor — see plan notes on the
 * "computed at read time" trade-off.
 */
async function rankedPage(
  viewerId: string,
  window: PostWithHashtags[],
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  const now = new Date();
  const ranked = [...window].sort(
    (a, b) => computeRankingScore(b, now) - computeRankingScore(a, now),
  );

  const offset = pagination.cursor ? Number.parseInt(pagination.cursor, 10) : 0;
  if (!Number.isFinite(offset) || offset < 0) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  }
  const pageRows = ranked.slice(offset, offset + pagination.limit);
  const { liked, saved } = await postRepo.likedSavedSets(
    viewerId,
    pageRows.map((post) => post.id),
  );
  return {
    items: pageRows.map((post) => toPostDtoFrom(post, liked.has(post.id), saved.has(post.id))),
    ...(offset + pagination.limit < ranked.length
      ? { nextCursor: String(offset + pagination.limit) }
      : {}),
  };
}

export async function getHashtagPage(
  viewerId: string,
  tag: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) throw new AppError('VALIDATION_FAILED', 'Invalid hashtag');
  const cacheKey = hashtagWindowKey(normalized);
  let window = cache.get<PostWithHashtags[]>(cacheKey);
  if (!window) {
    window = await postRepo.findRecentForTag(normalized, LIMITS.FEED_RANKING_WINDOW);
    cache.set(cacheKey, window, FEED_CACHE_TTL_SECONDS);
  }
  return rankedPage(viewerId, window, pagination);
}

export async function getExploreFeed(
  viewerId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  let window = cache.get<PostWithHashtags[]>(exploreWindowKey);
  if (!window) {
    window = await postRepo.findRecentPublic(LIMITS.FEED_RANKING_WINDOW);
    cache.set(exploreWindowKey, window, FEED_CACHE_TTL_SECONDS);
  }
  return rankedPage(viewerId, window, pagination);
}
