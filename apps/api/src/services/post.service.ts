import type { User } from '@prisma/client';
import {
  LIMITS,
  computeRankingScore,
  type CommentDto,
  type CreatePostBody,
  type Page,
  type PostDto,
} from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';
import * as postRepo from '../repositories/post.repository.js';
import type {
  CommentWithUser,
  PostWithHashtags,
  PostWithMeta,
} from '../repositories/post.repository.js';
import * as social from '../repositories/social.repository.js';
import * as users from '../repositories/user.repository.js';
import { notify } from './notification.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Posts & feed (Requirement Scope §13): post visibility follows the author's
 * profile visibility, hashtags are extracted from the caption and only
 * indexed for public authors, and hashtag/explore ranking is computed at
 * read time over a bounded recency window (Technical Spec §4 footnote).
 */

const HASHTAG_PATTERN = /#(\w{1,64})/g;

// ── Serialization ────────────────────────────────────────────────────────────

function toPostDtoFrom(post: PostWithHashtags, likedByMe: boolean, savedByMe: boolean): PostDto {
  return {
    id: post.id,
    author: toUserSummaryDto(post.author),
    mediaUrl: post.mediaUrl,
    caption: post.caption,
    hashtags: post.hashtags.map((h) => h.tag),
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
    createdAt: comment.createdAt.toISOString(),
  };
}

function extractHashtags(caption: string): string[] {
  const tags = new Set<string>();
  for (const match of caption.matchAll(HASHTAG_PATTERN)) {
    tags.add(match[1]!.toLowerCase());
  }
  return [...tags];
}

// ── Visibility (mirrors social.service.ts's getPublicProfile gate) ──────────

/** Invisible posts read as not-found, same as a blocked/private profile (§8, §13.3). */
async function assertCanView(viewerId: string, author: User): Promise<void> {
  if (viewerId === author.id) return;
  const block = await social.findBlockBetween(viewerId, author.id);
  if (block) throw new AppError('NOT_FOUND', 'Post not found');
  if (author.visibility === 'public') return;
  if (!(await social.findFriendship(viewerId, author.id))) {
    throw new AppError('NOT_FOUND', 'Post not found');
  }
}

// ── Posts ────────────────────────────────────────────────────────────────────

export async function createPost(authorId: string, body: CreatePostBody): Promise<PostDto> {
  const author = await users.findById(authorId);
  if (!author) throw new AppError('NOT_FOUND', 'User not found');
  // §13.1/§13.3: only public-profile authors get hashtag-indexed posts.
  const hashtags = author.visibility === 'public' ? extractHashtags(body.caption ?? '') : [];
  const created = await postRepo.create({
    authorId,
    mediaUrl: body.mediaUrl,
    caption: body.caption,
    hashtags,
  });
  logger.info({ event: 'post.created', authorId, postId: created.id }, 'post created');
  const full = await postRepo.findById(created.id, authorId);
  return toPostDto(full!);
}

export async function deletePost(userId: string, postId: string): Promise<void> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  if (post.authorId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the author can delete a post');
  }
  await postRepo.deleteById(postId);
  logger.info({ event: 'post.deleted', userId, postId }, 'post deleted');
}

export async function getPost(viewerId: string, postId: string): Promise<PostDto> {
  const post = await postRepo.findById(postId, viewerId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(viewerId, post.author);
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
  await assertCanView(viewerId, author);
  const rows = await postRepo.listByAuthor(author.id, viewerId, {
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
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
  await assertCanView(userId, post.author);
  const liked = await postRepo.toggleLike(postId, userId);
  if (liked && post.authorId !== userId) {
    const liker = await users.findById(userId);
    if (liker) await notify(post.authorId, 'post_like', { from: toUserSummaryDto(liker), postId });
  }
  return { liked };
}

/** Bookmark toggle — private, never notifies the author (§13.5). */
export async function toggleSave(userId: string, postId: string): Promise<{ saved: boolean }> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(userId, post.author);
  return { saved: await postRepo.toggleSave(postId, userId) };
}

export async function createComment(
  userId: string,
  postId: string,
  body: string,
): Promise<CommentDto> {
  const post = await postRepo.findById(postId, userId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(userId, post.author);
  const commenter = await users.findById(userId);
  if (!commenter) throw new AppError('NOT_FOUND', 'User not found');
  const comment = await postRepo.createComment(postId, userId, body);
  if (post.authorId !== userId) {
    await notify(post.authorId, 'post_comment', {
      from: toUserSummaryDto(commenter),
      postId,
      commentId: comment.id,
    });
  }
  logger.info({ event: 'post.commented', userId, postId, commentId: comment.id }, 'comment added');
  return toCommentDto({ ...comment, user: commenter });
}

export async function listComments(
  viewerId: string,
  postId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<CommentDto>> {
  const post = await postRepo.findById(postId, viewerId);
  if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  await assertCanView(viewerId, post.author);
  const rows = await postRepo.listComments(postId, {
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map(toCommentDto),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
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
  const window = await postRepo.findRecentForTag(normalized, LIMITS.FEED_RANKING_WINDOW);
  return rankedPage(viewerId, window, pagination);
}

export async function getExploreFeed(
  viewerId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<PostDto>> {
  const window = await postRepo.findRecentPublic(LIMITS.FEED_RANKING_WINDOW);
  return rankedPage(viewerId, window, pagination);
}
